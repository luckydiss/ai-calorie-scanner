from __future__ import annotations

import asyncio
import json
import logging
import time
import uuid
from base64 import b64encode
from contextlib import asynccontextmanager
from datetime import UTC, date, datetime, timedelta
from typing import Annotated, Any, Literal, Mapping
from urllib.parse import parse_qsl

import httpx
from fastapi import Depends, FastAPI, File, Form, Header, HTTPException, Request, Response, UploadFile, status
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import PlainTextResponse
from pydantic import BaseModel, Field

from .achievements import AchievementsResponse, evaluate_and_unlock_achievements
from .ai import AISettings, OpenRouterClient
from .config import Settings, get_settings
from .db import DBConnection, connect, init_db, transaction
from .metrics import MetricsStore
from .progression import LevelProgressOut, award_progress_for_meal, get_progression
from .rate_limit import InMemoryRateLimiter
from .telegram_auth import TelegramAuthError, verify_init_data


MEAL_TYPES = {"breakfast", "lunch", "dinner", "snack"}
GOAL_TYPES = {"lose", "maintain", "gain"}
SCAN_STATUSES = {"queued", "processing", "succeeded", "failed", "cancelled"}
MAX_SCAN_SIZE_BYTES = 8 * 1024 * 1024
RowData = Mapping[str, Any]
logger = logging.getLogger("calorie_food_api")


class AuthVerifyRequest(BaseModel):
    initData: str


class UserOut(BaseModel):
    id: str
    telegramUserId: str
    username: str | None = None
    firstName: str
    lastName: str | None = None


class AuthResponse(BaseModel):
    accessToken: str
    refreshToken: str
    user: UserOut


class LogoutRequest(BaseModel):
    refreshToken: str | None = None


class ProfileOut(LevelProgressOut):
    timezone: str
    language: str | None = None
    heightCm: int | None = None
    weightKg: float | None = None
    goalType: Literal["lose", "maintain", "gain"] | None = None


class ProfileUpdate(BaseModel):
    timezone: str | None = None
    language: str | None = None
    heightCm: int | None = None
    weightKg: float | None = None
    goalType: Literal["lose", "maintain", "gain"] | None = None


class DailyGoal(BaseModel):
    calories: int = Field(ge=0)
    proteinG: int = Field(ge=0)
    carbsG: int = Field(ge=0)
    fatG: int = Field(ge=0)


class MealItem(BaseModel):
    name: str
    grams: float | None = None
    calories: int = Field(ge=0)
    proteinG: float = Field(ge=0)
    carbsG: float = Field(ge=0)
    fatG: float = Field(ge=0)
    confidence: float | None = None


class MealCreate(BaseModel):
    title: str
    mealType: Literal["breakfast", "lunch", "dinner", "snack"]
    eatenAt: datetime
    items: list[MealItem] = Field(min_length=1)


class MealUpdate(BaseModel):
    title: str | None = None
    mealType: Literal["breakfast", "lunch", "dinner", "snack"] | None = None
    eatenAt: datetime | None = None
    items: list[MealItem] | None = Field(default=None, min_length=1)


class MealOut(BaseModel):
    id: str
    title: str
    mealType: str
    eatenAt: datetime
    source: str
    items: list[MealItem]


class DashboardResponse(BaseModel):
    date: date
    totals: DailyGoal
    goals: DailyGoal
    recentMeals: list[MealOut]


class ScanJobOut(BaseModel):
    id: str
    status: Literal["queued", "processing", "succeeded", "failed", "cancelled"]
    createdAt: datetime


class ScanResultOut(BaseModel):
    dishName: str
    calories: int
    proteinG: float
    carbsG: float
    fatG: float
    confidence: float
    alternatives: list[str]


class ScanStatusResponse(BaseModel):
    id: str
    status: Literal["queued", "processing", "succeeded", "failed", "cancelled"]
    errorCode: str | None = None
    result: ScanResultOut | None = None


class ScanConfirmRequest(BaseModel):
    title: str
    mealType: Literal["breakfast", "lunch", "dinner", "snack"]
    eatenAt: datetime
    items: list[MealItem] = Field(min_length=1)


class ScanRecalculateRequest(BaseModel):
    comment: str = Field(min_length=1, max_length=800)


def now_utc() -> datetime:
    return datetime.now(tz=UTC)


def dt_to_str(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def str_to_dt(value: str) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def extract_bearer_token(authorization: str | None) -> str:
    if not authorization or not authorization.lower().startswith("bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing bearer token")
    return authorization.split(" ", 1)[1].strip()


def parse_unsafe_telegram_init_data(init_data: str) -> dict[str, Any]:
    unsafe_pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    raw_user = unsafe_pairs.get("user")
    if not raw_user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid initData")
    try:
        parsed = json.loads(raw_user)
    except json.JSONDecodeError:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid initData") from None
    if not isinstance(parsed, dict):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid initData")
    return parsed


def row_to_profile(row: RowData) -> ProfileOut:
    return ProfileOut(
        timezone=row["timezone"],
        language=row.get("language"),
        heightCm=row["height_cm"],
        weightKg=row["weight_kg"],
        goalType=row["goal_type"],
        level=int(row.get("level") or 1),
        currentXp=int(row.get("current_xp") or 0),
        xpRequired=int(row.get("xp_required") or (100 + int(row.get("level") or 1) * 50)),
    )


def fetch_profile_row(conn: DBConnection, user_id: str) -> RowData:
    progress = get_progression(conn, user_id)
    row = conn.execute(
        """
        SELECT *
        FROM profiles
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
    merged = dict(row)
    merged["level"] = progress.level
    merged["current_xp"] = progress.currentXp
    merged["xp_required"] = progress.xpRequired
    return merged


def row_to_meal(conn: DBConnection, row: RowData) -> MealOut:
    item_rows = conn.execute(
        """
        SELECT name, grams, calories, protein_g, carbs_g, fat_g, confidence
        FROM meal_items WHERE meal_id = ?
        """,
        (row["id"],),
    ).fetchall()
    items = [
        MealItem(
            name=item["name"],
            grams=item["grams"],
            calories=item["calories"],
            proteinG=item["protein_g"],
            carbsG=item["carbs_g"],
            fatG=item["fat_g"],
            confidence=item["confidence"],
        )
        for item in item_rows
    ]
    return MealOut(
        id=str(row["id"]),
        title=row["title"],
        mealType=row["meal_type"],
        eatenAt=str_to_dt(row["eaten_at"]),
        source=row["source"],
        items=items,
    )


def row_to_scan_status(conn: DBConnection, row: RowData) -> ScanStatusResponse:
    result_row = conn.execute(
        """
        SELECT dish_name, calories, protein_g, carbs_g, fat_g, confidence, alternatives_json
        FROM scan_results WHERE scan_job_id = ?
        """,
        (row["id"],),
    ).fetchone()
    result: ScanResultOut | None = None
    if result_row:
        raw_alternatives = result_row["alternatives_json"]
        if isinstance(raw_alternatives, str):
            alternatives = json.loads(raw_alternatives) if raw_alternatives else []
        elif isinstance(raw_alternatives, list):
            alternatives = raw_alternatives
        else:
            alternatives = []
        result = ScanResultOut(
            dishName=result_row["dish_name"],
            calories=result_row["calories"],
            proteinG=result_row["protein_g"],
            carbsG=result_row["carbs_g"],
            fatG=result_row["fat_g"],
            confidence=result_row["confidence"],
            alternatives=[str(x) for x in alternatives],
        )
    return ScanStatusResponse(
        id=str(row["id"]),
        status=row["status"],
        errorCode=row["error_code"],
        result=result,
    )


def map_scan_error_code(exc: Exception) -> str:
    if isinstance(exc, httpx.HTTPStatusError):
        status_code = exc.response.status_code
        if status_code == 400:
            return "provider_invalid_image"
        if status_code == 401:
            return "provider_auth_invalid"
        if status_code == 402:
            return "provider_quota_exceeded"
        if status_code == 403:
            return "provider_forbidden"
        if status_code == 429:
            return "provider_rate_limited"
        if status_code >= 500:
            return "provider_internal_error"
        return f"provider_http_{status_code}"
    if isinstance(exc, httpx.TimeoutException):
        return "provider_timeout"
    if isinstance(exc, httpx.ConnectError):
        return "provider_connect_error"
    return "provider_unknown_error"


def configure_logging(settings: Settings) -> None:
    level_name = settings.log_level.upper()
    level = getattr(logging, level_name, logging.INFO)
    logging.basicConfig(level=level, format="%(message)s")


def run_maintenance(conn: DBConnection, settings: Settings) -> dict[str, int]:
    sessions_deleted = conn.execute(
        """
        DELETE FROM sessions
        WHERE expires_at < NOW() - make_interval(days => ?)
        """,
        (settings.sessions_retention_days,),
    ).rowcount
    scans_deleted = conn.execute(
        """
        DELETE FROM scan_jobs
        WHERE created_at < NOW() - make_interval(days => ?)
          AND status IN ('succeeded', 'failed', 'cancelled')
        """,
        (settings.scan_jobs_retention_days,),
    ).rowcount
    conn.commit()
    return {
        "sessions_deleted": int(sessions_deleted or 0),
        "scan_jobs_deleted": int(scans_deleted or 0),
    }


def create_app(settings: Settings | None = None) -> FastAPI:
    app_settings = settings or get_settings()
    configure_logging(app_settings)
    state: dict[str, Any] = {}
    metrics = MetricsStore()
    limiter = InMemoryRateLimiter()
    maintenance_stop_event = asyncio.Event()

    @asynccontextmanager
    async def lifespan(_: FastAPI):
        conn = connect(app_settings)
        init_db(conn)
        run_maintenance(conn, app_settings)
        conn.close()
        ai_client = OpenRouterClient(
            AISettings(
                api_key=app_settings.openrouter_api_key,
                model=app_settings.openrouter_model,
                base_url=app_settings.openrouter_base_url,
                timeout_seconds=app_settings.openrouter_timeout_seconds,
                app_name=app_settings.app_name,
            )
        )
        state["settings"] = app_settings
        state["ai_client"] = ai_client
        state["started_at"] = now_utc()

        async def maintenance_loop() -> None:
            interval_seconds = max(60, app_settings.maintenance_cleanup_interval_minutes * 60)
            while not maintenance_stop_event.is_set():
                try:
                    await asyncio.wait_for(maintenance_stop_event.wait(), timeout=interval_seconds)
                except TimeoutError:
                    pass
                if maintenance_stop_event.is_set():
                    break
                try:
                    loop_conn = connect(app_settings)
                    stats = run_maintenance(loop_conn, app_settings)
                    loop_conn.close()
                    logger.info(
                        json.dumps(
                            {
                                "event": "maintenance_cleanup",
                                "sessions_deleted": stats["sessions_deleted"],
                                "scan_jobs_deleted": stats["scan_jobs_deleted"],
                            }
                        )
                    )
                except Exception as exc:
                    logger.exception(
                        json.dumps(
                            {
                                "event": "maintenance_cleanup_failed",
                                "error": str(exc),
                            }
                        )
                    )

        maintenance_task = asyncio.create_task(maintenance_loop())
        yield
        maintenance_stop_event.set()
        await maintenance_task

    app = FastAPI(title="Calorie Food API", version="0.1.0", lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware,
        allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
        allow_origin_regex=app_settings.cors_allow_origin_regex,
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    @app.middleware("http")
    async def request_logging_middleware(request: Request, call_next):
        request_id = uuid.uuid4().hex[:12]
        started = time.perf_counter()
        try:
            response = await call_next(request)
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            route = request.scope.get("route")
            route_path = getattr(route, "path", request.url.path)
            response.headers["X-Request-Id"] = request_id
            metrics.inc(
                "http_requests_total",
                {
                    "method": request.method,
                    "path": route_path,
                    "status_code": str(response.status_code),
                },
            )
            metrics.observe(
                "http_request_duration_ms",
                {"method": request.method, "path": route_path},
                duration_ms,
            )
            logger.info(
                json.dumps(
                    {
                        "event": "http_request",
                        "request_id": request_id,
                        "method": request.method,
                        "path": route_path,
                        "status_code": response.status_code,
                        "duration_ms": duration_ms,
                        "client_ip": request.client.host if request.client else "unknown",
                    }
                )
            )
            return response
        except Exception as exc:
            duration_ms = round((time.perf_counter() - started) * 1000, 2)
            route = request.scope.get("route")
            route_path = getattr(route, "path", request.url.path)
            metrics.inc(
                "http_requests_total",
                {"method": request.method, "path": route_path, "status_code": "500"},
            )
            metrics.observe(
                "http_request_duration_ms",
                {"method": request.method, "path": route_path},
                duration_ms,
            )
            logger.exception(
                json.dumps(
                    {
                        "event": "http_request_error",
                        "request_id": request_id,
                        "method": request.method,
                        "path": route_path,
                        "duration_ms": duration_ms,
                        "error": str(exc),
                    }
                )
            )
            raise

    def get_conn():
        conn = connect(state["settings"])
        try:
            yield conn
        finally:
            conn.close()

    def get_ai_client() -> OpenRouterClient:
        return state["ai_client"]

    @app.get("/health/live")
    def health_live() -> dict[str, str]:
        return {"status": "ok", "service": "calorie-food-backend"}

    @app.get("/health/ready")
    def health_ready(conn: DBConnection = Depends(get_conn)) -> dict[str, str]:
        conn.execute("SELECT 1").fetchone()
        return {"status": "ready", "database": "ok"}

    @app.get("/metrics", response_class=PlainTextResponse)
    def get_metrics() -> str:
        return metrics.render_prometheus()

    def enforce_auth_rate_limit(request: Request) -> None:
        client_ip = request.client.host if request.client else "unknown"
        key = f"auth:{client_ip}"
        if not limiter.allow(key, app_settings.auth_rate_limit_per_minute):
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many auth requests")

    def enforce_scans_rate_limit(
        request: Request,
    ) -> None:
        client_ip = request.client.host if request.client else "unknown"
        key = f"scans:{client_ip}"
        if not limiter.allow(key, app_settings.scans_rate_limit_per_minute):
            raise HTTPException(status_code=status.HTTP_429_TOO_MANY_REQUESTS, detail="Too many scan requests")

    def get_current_user(
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        conn: DBConnection = Depends(get_conn),
    ) -> RowData:
        token = extract_bearer_token(authorization)
        session = conn.execute(
            "SELECT token, user_id, expires_at FROM sessions WHERE token = ? AND kind = 'access'",
            (token,),
        ).fetchone()
        if not session:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        if str_to_dt(session["expires_at"]) < now_utc():
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Token expired")
        user = conn.execute("SELECT * FROM users WHERE id = ?", (session["user_id"],)).fetchone()
        if not user:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
        return user

    @app.post("/auth/telegram/verify", response_model=AuthResponse)
    def verify_telegram(
        payload: AuthVerifyRequest,
        _: None = Depends(enforce_auth_rate_limit),
        conn: DBConnection = Depends(get_conn),
    ) -> AuthResponse:
        use_insecure_dev = app_settings.app_env == "development" and app_settings.telegram_allow_insecure_dev
        if not app_settings.telegram_bot_token and not use_insecure_dev:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="TELEGRAM_BOT_TOKEN is not configured")

        if app_settings.telegram_bot_token:
            try:
                user_payload = verify_init_data(
                    payload.initData,
                    bot_token=app_settings.telegram_bot_token,
                    ttl_seconds=app_settings.telegram_initdata_ttl_seconds,
                )
            except TelegramAuthError:
                if not use_insecure_dev:
                    raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid initData") from None
                logger.warning(json.dumps({"event": "insecure_telegram_auth_fallback_used"}))
                user_payload = parse_unsafe_telegram_init_data(payload.initData)
        else:
            logger.warning(json.dumps({"event": "insecure_telegram_auth_no_bot_token"}))
            user_payload = parse_unsafe_telegram_init_data(payload.initData)

        telegram_user = {
            "telegram_user_id": user_payload.get("id"),
            "username": user_payload.get("username"),
            "first_name": user_payload.get("first_name") or "Telegram",
            "last_name": user_payload.get("last_name"),
        }
        telegram_user_id = telegram_user["telegram_user_id"]
        if not telegram_user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Telegram user id")

        now = now_utc()
        user_id = str(uuid.uuid4())
        with transaction(conn):
            upserted_user = conn.execute(
                """
                INSERT INTO users(id, telegram_user_id, username, first_name, last_name, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT (telegram_user_id) DO UPDATE
                SET username = EXCLUDED.username,
                    first_name = EXCLUDED.first_name,
                    last_name = EXCLUDED.last_name,
                    updated_at = EXCLUDED.updated_at
                RETURNING id
                """,
                (
                    user_id,
                    telegram_user_id,
                    telegram_user.get("username"),
                    telegram_user.get("first_name"),
                    telegram_user.get("last_name"),
                    dt_to_str(now),
                    dt_to_str(now),
                ),
            ).fetchone()
            user_id = str(upserted_user["id"])
            conn.execute(
                """
                INSERT INTO profiles(user_id, timezone, language, created_at, updated_at)
                VALUES (?, 'UTC', NULL, ?, ?)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id, dt_to_str(now), dt_to_str(now)),
            )
            conn.execute(
                """
                INSERT INTO user_progression(user_id, level, current_xp, created_at, updated_at)
                VALUES (?, 1, 0, ?, ?)
                ON CONFLICT (user_id) DO NOTHING
                """,
                (user_id, dt_to_str(now), dt_to_str(now)),
            )

        access_token = str(uuid.uuid4())
        refresh_token = str(uuid.uuid4())
        with transaction(conn):
            conn.execute(
                """
                INSERT INTO sessions(token, user_id, kind, expires_at, created_at)
                VALUES (?, ?, 'access', ?, ?)
                """,
                (
                    access_token,
                    user_id,
                    dt_to_str(now + timedelta(seconds=app_settings.access_ttl_seconds)),
                    dt_to_str(now),
                ),
            )
            conn.execute(
                """
                INSERT INTO sessions(token, user_id, kind, expires_at, created_at)
                VALUES (?, ?, 'refresh', ?, ?)
                """,
                (
                    refresh_token,
                    user_id,
                    dt_to_str(now + timedelta(seconds=app_settings.refresh_ttl_seconds)),
                    dt_to_str(now),
                ),
            )

        user = conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
        return AuthResponse(
            accessToken=access_token,
            refreshToken=refresh_token,
            user=UserOut(
                id=str(user["id"]),
                telegramUserId=str(user["telegram_user_id"]),
                username=user["username"],
                firstName=user["first_name"],
                lastName=user["last_name"],
            ),
        )

    @app.post("/auth/logout", status_code=status.HTTP_204_NO_CONTENT)
    def logout(
        payload: LogoutRequest,
        authorization: Annotated[str | None, Header(alias="Authorization")] = None,
        conn: DBConnection = Depends(get_conn),
    ) -> Response:
        access_token = extract_bearer_token(authorization)
        session = conn.execute(
            "SELECT user_id FROM sessions WHERE token = ? AND kind = 'access'",
            (access_token,),
        ).fetchone()
        if not session:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid token")
        user_id = session["user_id"]
        with transaction(conn):
            conn.execute("DELETE FROM sessions WHERE token = ?", (access_token,))
            if payload.refreshToken:
                conn.execute(
                    "DELETE FROM sessions WHERE token = ? AND user_id = ? AND kind = 'refresh'",
                    (payload.refreshToken, user_id),
                )
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.post("/auth/logout-all", status_code=status.HTTP_204_NO_CONTENT)
    def logout_all(
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> Response:
        with transaction(conn):
            conn.execute("DELETE FROM sessions WHERE user_id = ?", (user["id"],))
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/profile", response_model=ProfileOut)
    def get_profile(
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> ProfileOut:
        return row_to_profile(fetch_profile_row(conn, user["id"]))

    @app.put("/profile", response_model=ProfileOut)
    def update_profile(
        payload: ProfileUpdate,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> ProfileOut:
        row = fetch_profile_row(conn, user["id"])
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Profile not found")
        data = row_to_profile(row).model_dump()
        patch = payload.model_dump(exclude_unset=True)
        data.update(patch)
        goal = data.get("goalType")
        if goal and goal not in GOAL_TYPES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid goalType")
        language = data.get("language")
        now = dt_to_str(now_utc())
        with transaction(conn):
            conn.execute(
                """
                UPDATE profiles
                SET timezone = ?, language = ?, height_cm = ?, weight_kg = ?, goal_type = ?, updated_at = ?
                WHERE user_id = ?
                """,
                (data["timezone"], language, data["heightCm"], data["weightKg"], goal, now, user["id"]),
            )
        return row_to_profile(fetch_profile_row(conn, user["id"]))

    @app.get("/goals", response_model=DailyGoal)
    def get_goals(
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> DailyGoal:
        row = conn.execute(
            """
            SELECT calories, protein_g, carbs_g, fat_g
            FROM daily_goals
            WHERE user_id = ?
            ORDER BY effective_from DESC
            LIMIT 1
            """,
            (user["id"],),
        ).fetchone()
        if not row:
            return DailyGoal(calories=2000, proteinG=120, carbsG=200, fatG=70)
        return DailyGoal(
            calories=row["calories"],
            proteinG=row["protein_g"],
            carbsG=row["carbs_g"],
            fatG=row["fat_g"],
        )

    @app.put("/goals", response_model=DailyGoal)
    def put_goals(
        payload: DailyGoal,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> DailyGoal:
        if payload.calories <= 0:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Calories must be > 0")
        now = now_utc()
        with transaction(conn):
            conn.execute(
                """
                INSERT INTO daily_goals(id, user_id, calories, protein_g, carbs_g, fat_g, effective_from, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    str(uuid.uuid4()),
                    user["id"],
                    payload.calories,
                    payload.proteinG,
                    payload.carbsG,
                    payload.fatG,
                    date.today().isoformat(),
                    dt_to_str(now),
                ),
            )
        return payload

    @app.get("/meals")
    def list_meals(
        date: date,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> dict[str, list[MealOut]]:
        rows = conn.execute(
            """
            SELECT * FROM meals
            WHERE user_id = ? AND DATE(eaten_at) = ?
            ORDER BY eaten_at DESC
            """,
            (user["id"], date.isoformat()),
        ).fetchall()
        items = [row_to_meal(conn, row) for row in rows]
        return {"items": items}

    @app.post("/meals", response_model=MealOut, status_code=status.HTTP_201_CREATED)
    def create_meal(
        payload: MealCreate,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> MealOut:
        meal_id = str(uuid.uuid4())
        now = dt_to_str(now_utc())
        if payload.mealType not in MEAL_TYPES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid mealType")
        with transaction(conn):
            conn.execute(
                """
                INSERT INTO meals(id, user_id, meal_type, title, eaten_at, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'manual', ?, ?)
                """,
                (meal_id, user["id"], payload.mealType, payload.title, dt_to_str(payload.eatenAt), now, now),
            )
            for item in payload.items:
                conn.execute(
                    """
                    INSERT INTO meal_items(id, meal_id, name, grams, calories, protein_g, carbs_g, fat_g, confidence)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        meal_id,
                        item.name,
                        item.grams,
                        item.calories,
                        item.proteinG,
                        item.carbsG,
                        item.fatG,
                        item.confidence,
                    ),
                )
        _ = award_progress_for_meal(conn, user["id"], meal_id)
        _ = evaluate_and_unlock_achievements(conn, user["id"])
        row = conn.execute("SELECT * FROM meals WHERE id = ?", (meal_id,)).fetchone()
        return row_to_meal(conn, row)

    @app.patch("/meals/{meal_id}", response_model=MealOut)
    def update_meal(
        meal_id: str,
        payload: MealUpdate,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> MealOut:
        row = conn.execute("SELECT * FROM meals WHERE id = ? AND user_id = ?", (meal_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found")
        update_data = payload.model_dump(exclude_unset=True)
        title = update_data.get("title", row["title"])
        meal_type = update_data.get("mealType", row["meal_type"])
        eaten_at = update_data.get("eatenAt", str_to_dt(row["eaten_at"]))
        if meal_type not in MEAL_TYPES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid mealType")
        with transaction(conn):
            conn.execute(
                """
                UPDATE meals SET title = ?, meal_type = ?, eaten_at = ?, updated_at = ?
                WHERE id = ?
                """,
                (title, meal_type, dt_to_str(eaten_at), dt_to_str(now_utc()), meal_id),
            )
            if payload.items is not None:
                conn.execute("DELETE FROM meal_items WHERE meal_id = ?", (meal_id,))
                for item in payload.items:
                    conn.execute(
                        """
                        INSERT INTO meal_items(id, meal_id, name, grams, calories, protein_g, carbs_g, fat_g, confidence)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                        """,
                        (
                            str(uuid.uuid4()),
                            meal_id,
                            item.name,
                            item.grams,
                            item.calories,
                            item.proteinG,
                            item.carbsG,
                            item.fatG,
                            item.confidence,
                        ),
                    )
        new_row = conn.execute("SELECT * FROM meals WHERE id = ?", (meal_id,)).fetchone()
        return row_to_meal(conn, new_row)

    @app.delete("/meals/{meal_id}", status_code=status.HTTP_204_NO_CONTENT)
    def delete_meal(
        meal_id: str,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> Response:
        row = conn.execute("SELECT id FROM meals WHERE id = ? AND user_id = ?", (meal_id, user["id"])).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Meal not found")
        with transaction(conn):
            conn.execute("DELETE FROM meals WHERE id = ?", (meal_id,))
        return Response(status_code=status.HTTP_204_NO_CONTENT)

    @app.get("/dashboard", response_model=DashboardResponse)
    def get_dashboard(
        date: date,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> DashboardResponse:
        totals_row = conn.execute(
            """
            SELECT
              COALESCE(SUM(mi.calories), 0) AS calories,
              COALESCE(SUM(mi.protein_g), 0) AS protein_g,
              COALESCE(SUM(mi.carbs_g), 0) AS carbs_g,
              COALESCE(SUM(mi.fat_g), 0) AS fat_g
            FROM meals m
            JOIN meal_items mi ON mi.meal_id = m.id
            WHERE m.user_id = ? AND DATE(m.eaten_at) = ?
            """,
            (user["id"], date.isoformat()),
        ).fetchone()
        goal_row = conn.execute(
            """
            SELECT calories, protein_g, carbs_g, fat_g
            FROM daily_goals
            WHERE user_id = ? AND effective_from <= ?
            ORDER BY effective_from DESC
            LIMIT 1
            """,
            (user["id"], date.isoformat()),
        ).fetchone()
        recent_rows = conn.execute(
            """
            SELECT * FROM meals
            WHERE user_id = ? AND DATE(eaten_at) = ?
            ORDER BY eaten_at DESC
            LIMIT 5
            """,
            (user["id"], date.isoformat()),
        ).fetchall()
        goals = DailyGoal(
            calories=goal_row["calories"] if goal_row else 2000,
            proteinG=goal_row["protein_g"] if goal_row else 120,
            carbsG=goal_row["carbs_g"] if goal_row else 200,
            fatG=goal_row["fat_g"] if goal_row else 70,
        )
        totals = DailyGoal(
            calories=int(totals_row["calories"]),
            proteinG=int(round(totals_row["protein_g"])),
            carbsG=int(round(totals_row["carbs_g"])),
            fatG=int(round(totals_row["fat_g"])),
        )
        return DashboardResponse(
            date=date,
            totals=totals,
            goals=goals,
            recentMeals=[row_to_meal(conn, row) for row in recent_rows],
        )

    @app.get("/achievements", response_model=AchievementsResponse)
    def get_achievements(
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> AchievementsResponse:
        return evaluate_and_unlock_achievements(conn, user["id"])

    @app.post("/scans", response_model=ScanJobOut, status_code=status.HTTP_202_ACCEPTED)
    async def create_scan(
        image: UploadFile | None = File(default=None),
        description: str | None = Form(default=None),
        _: None = Depends(enforce_scans_rate_limit),
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
        ai_client: OpenRouterClient = Depends(get_ai_client),
    ) -> ScanJobOut:
        description = (description or "").strip()
        if image is None and not description:
            raise HTTPException(
                status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
                detail="Either image or description is required",
            )

        content_type = ""
        raw_bytes = b""
        if image is not None:
            content_type = (image.content_type or "").lower()
            if not content_type.startswith("image/"):
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Image file is required")
            raw_bytes = await image.read()
            if not raw_bytes:
                raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Empty image")
            if len(raw_bytes) > MAX_SCAN_SIZE_BYTES:
                raise HTTPException(status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE, detail="Image too large")

        now = now_utc()
        scan_id = str(uuid.uuid4())
        image_url = (
            f"data:{content_type};base64,{b64encode(raw_bytes).decode('ascii')}"
            if image is not None
            else f"text://{description[:1000]}"
        )
        with transaction(conn):
            conn.execute(
                """
                INSERT INTO scan_jobs(id, user_id, status, image_url, error_code, created_at, updated_at)
                VALUES (?, ?, 'queued', ?, NULL, ?, ?)
                """,
                (scan_id, user["id"], image_url, dt_to_str(now), dt_to_str(now)),
            )
            conn.execute(
                "UPDATE scan_jobs SET status = 'processing', updated_at = ? WHERE id = ?",
                (dt_to_str(now_utc()), scan_id),
            )
        scan_status: Literal["queued", "processing", "succeeded", "failed", "cancelled"] = "processing"

        if not app_settings.openrouter_api_key:
            with transaction(conn):
                conn.execute(
                    "UPDATE scan_jobs SET status = 'failed', error_code = 'provider_auth_missing', updated_at = ? WHERE id = ?",
                    (dt_to_str(now_utc()), scan_id),
                )
            metrics.inc("scan_requests_total", {"outcome": "failed", "error_code": "provider_auth_missing"})
            scan_status = "failed"
            return ScanJobOut(id=scan_id, status=scan_status, createdAt=now)

        try:
            if image is not None:
                analyzed = ai_client.analyze_food(image_url, description=description or None)
            else:
                analyzed = ai_client.analyze_text(description)
            with transaction(conn):
                conn.execute(
                    """
                    INSERT INTO scan_results(
                      id, scan_job_id, dish_name, calories, protein_g, carbs_g, fat_g, confidence, alternatives_json, created_at
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        scan_id,
                        analyzed["dishName"],
                        analyzed["calories"],
                        analyzed["proteinG"],
                        analyzed["carbsG"],
                        analyzed["fatG"],
                        analyzed["confidence"],
                        json.dumps(analyzed["alternatives"]),
                        dt_to_str(now_utc()),
                    ),
                )
                conn.execute(
                    "UPDATE scan_jobs SET status = 'succeeded', updated_at = ? WHERE id = ?",
                    (dt_to_str(now_utc()), scan_id),
                )
            metrics.inc("scan_requests_total", {"outcome": "succeeded", "error_code": "none"})
            scan_status = "succeeded"
        except Exception as exc:
            error_code = map_scan_error_code(exc)
            if isinstance(exc, httpx.HTTPStatusError):
                try:
                    print(f"OpenRouter error {exc.response.status_code}: {exc.response.text[:600]}")
                except Exception:
                    pass
            with transaction(conn):
                conn.execute(
                    "UPDATE scan_jobs SET status = 'failed', error_code = ?, updated_at = ? WHERE id = ?",
                    (error_code[:64], dt_to_str(now_utc()), scan_id),
                )
            metrics.inc("scan_requests_total", {"outcome": "failed", "error_code": error_code[:64]})
            scan_status = "failed"

        return ScanJobOut(id=scan_id, status=scan_status, createdAt=now)

    @app.get("/scans/{scan_id}", response_model=ScanStatusResponse)
    def get_scan_status(
        scan_id: str,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> ScanStatusResponse:
        row = conn.execute(
            "SELECT * FROM scan_jobs WHERE id = ? AND user_id = ?",
            (scan_id, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
        if row["status"] not in SCAN_STATUSES:
            raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail="Invalid scan status")
        return row_to_scan_status(conn, row)

    @app.post("/scans/{scan_id}/confirm", response_model=MealOut, status_code=status.HTTP_201_CREATED)
    def confirm_scan(
        scan_id: str,
        payload: ScanConfirmRequest,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> MealOut:
        scan_row = conn.execute(
            "SELECT * FROM scan_jobs WHERE id = ? AND user_id = ?",
            (scan_id, user["id"]),
        ).fetchone()
        if not scan_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
        if scan_row["status"] != "succeeded":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan is not ready")
        if scan_row["confirmed_at"] is not None:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan already confirmed")
        if payload.mealType not in MEAL_TYPES:
            raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail="Invalid mealType")

        meal_id = str(uuid.uuid4())
        now = dt_to_str(now_utc())
        with transaction(conn):
            conn.execute(
                """
                INSERT INTO meals(id, user_id, meal_type, title, eaten_at, source, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, 'ai', ?, ?)
                """,
                (meal_id, user["id"], payload.mealType, payload.title, dt_to_str(payload.eatenAt), now, now),
            )
            for item in payload.items:
                conn.execute(
                    """
                    INSERT INTO meal_items(id, meal_id, name, grams, calories, protein_g, carbs_g, fat_g, confidence)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        meal_id,
                        item.name,
                        item.grams,
                        item.calories,
                        item.proteinG,
                        item.carbsG,
                        item.fatG,
                        item.confidence,
                    ),
                )
            conn.execute(
                "UPDATE scan_jobs SET confirmed_at = ?, updated_at = ? WHERE id = ?",
                (now, now, scan_id),
            )
        _ = award_progress_for_meal(conn, user["id"], meal_id)
        _ = evaluate_and_unlock_achievements(conn, user["id"])

        row = conn.execute("SELECT * FROM meals WHERE id = ?", (meal_id,)).fetchone()
        return row_to_meal(conn, row)

    @app.post("/scans/{scan_id}/cancel", response_model=ScanStatusResponse)
    def cancel_scan(
        scan_id: str,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
    ) -> ScanStatusResponse:
        row = conn.execute(
            "SELECT * FROM scan_jobs WHERE id = ? AND user_id = ?",
            (scan_id, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
        if row["status"] in {"succeeded", "failed", "cancelled"}:
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan cannot be cancelled")
        with transaction(conn):
            conn.execute(
                "UPDATE scan_jobs SET status = 'cancelled', error_code = 'cancelled_by_user', updated_at = ? WHERE id = ?",
                (dt_to_str(now_utc()), scan_id),
            )
        updated = conn.execute("SELECT * FROM scan_jobs WHERE id = ?", (scan_id,)).fetchone()
        return row_to_scan_status(conn, updated)

    @app.post("/scans/{scan_id}/recalculate", response_model=ScanStatusResponse)
    def recalculate_scan(
        scan_id: str,
        payload: ScanRecalculateRequest,
        user: RowData = Depends(get_current_user),
        conn: DBConnection = Depends(get_conn),
        ai_client: OpenRouterClient = Depends(get_ai_client),
    ) -> ScanStatusResponse:
        row = conn.execute(
            "SELECT * FROM scan_jobs WHERE id = ? AND user_id = ?",
            (scan_id, user["id"]),
        ).fetchone()
        if not row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan not found")
        if row["status"] != "succeeded":
            raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Scan is not ready")

        result_row = conn.execute(
            """
            SELECT dish_name, calories, protein_g, carbs_g, fat_g, confidence, alternatives_json
            FROM scan_results WHERE scan_job_id = ?
            """,
            (scan_id,),
        ).fetchone()
        if not result_row:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Scan result not found")

        if not app_settings.openrouter_api_key:
            raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="Provider key is missing")

        raw_alt = result_row["alternatives_json"]
        if isinstance(raw_alt, str):
            alternatives = json.loads(raw_alt) if raw_alt else []
        elif isinstance(raw_alt, list):
            alternatives = raw_alt
        else:
            alternatives = []
        base_result = {
            "dishName": result_row["dish_name"],
            "calories": result_row["calories"],
            "proteinG": float(result_row["protein_g"]),
            "carbsG": float(result_row["carbs_g"]),
            "fatG": float(result_row["fat_g"]),
            "confidence": float(result_row["confidence"]),
            "alternatives": [str(x) for x in alternatives],
        }

        try:
            recalculated = ai_client.recalculate(base_result=base_result, comment=payload.comment)
            with transaction(conn):
                conn.execute(
                    """
                    UPDATE scan_results
                    SET dish_name = ?, calories = ?, protein_g = ?, carbs_g = ?, fat_g = ?, confidence = ?, alternatives_json = ?
                    WHERE scan_job_id = ?
                    """,
                    (
                        recalculated["dishName"],
                        recalculated["calories"],
                        recalculated["proteinG"],
                        recalculated["carbsG"],
                        recalculated["fatG"],
                        recalculated["confidence"],
                        json.dumps(recalculated["alternatives"]),
                        scan_id,
                    ),
                )
                conn.execute(
                    "UPDATE scan_jobs SET updated_at = ? WHERE id = ?",
                    (dt_to_str(now_utc()), scan_id),
                )
                conn.execute(
                    """
                    INSERT INTO events(id, user_id, event_name, payload_json, created_at)
                    VALUES (?, ?, 'scan_recalculated', ?, ?)
                    """,
                    (
                        str(uuid.uuid4()),
                        user["id"],
                        json.dumps({"scanId": scan_id}),
                        dt_to_str(now_utc()),
                    ),
                )
            metrics.inc("scan_recalculate_total", {"outcome": "succeeded"})
        except Exception as exc:
            metrics.inc("scan_recalculate_total", {"outcome": "failed"})
            error_code = map_scan_error_code(exc)
            raise HTTPException(status_code=status.HTTP_502_BAD_GATEWAY, detail=f"Recalculate failed: {error_code}") from None

        updated = conn.execute("SELECT * FROM scan_jobs WHERE id = ?", (scan_id,)).fetchone()
        return row_to_scan_status(conn, updated)

    return app


app = create_app()
