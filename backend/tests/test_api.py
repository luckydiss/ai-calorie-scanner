from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import date, datetime
from pathlib import Path

from contextlib import contextmanager

import psycopg
from alembic import command
from alembic.config import Config
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app


@contextmanager
def make_client():
    bot_token = "test_bot_token"
    database_url = os.getenv("TEST_DATABASE_URL", os.getenv("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/calorie_food"))
    _migrate_db(database_url)
    settings = Settings(
        app_env="test",
        app_port=8080,
        access_ttl_seconds=3600,
        refresh_ttl_seconds=86400,
        openrouter_api_key="",
        openrouter_model="google/gemini-3.1-flash-lite-preview",
        openrouter_base_url="https://openrouter.ai/api/v1",
        openrouter_timeout_seconds=30.0,
        app_name="calorie-food-test",
        telegram_bot_token=bot_token,
        telegram_initdata_ttl_seconds=300,
        auth_rate_limit_per_minute=100,
        scans_rate_limit_per_minute=100,
        database_url=database_url,
        telegram_allow_insecure_dev=False,
        log_level="INFO",
        maintenance_cleanup_interval_minutes=30,
        sessions_retention_days=30,
        scan_jobs_retention_days=30,
        cors_allow_origin_regex=r"^https?://(localhost|127\.0\.0\.1)(:\d+)?$",
    )
    app = create_app(settings)
    with TestClient(app) as client:
        _reset_db(database_url)
        try:
            yield client
        finally:
            _reset_db(database_url)


def _reset_db(database_url: str) -> None:
    with psycopg.connect(database_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                """
                TRUNCATE TABLE
                  scan_results,
                  scan_jobs,
                  meal_items,
                  meals,
                  daily_goals,
                  profiles,
                  sessions,
                  users
                RESTART IDENTITY CASCADE
                """
            )
        conn.commit()


def _migrate_db(database_url: str) -> None:
    root_dir = Path(__file__).resolve().parent.parent
    alembic_cfg = Config(str(root_dir / "alembic.ini"))
    alembic_cfg.set_main_option("sqlalchemy.url", database_url)
    command.upgrade(alembic_cfg, "head")


def make_init_data(user_id: int = 123456) -> str:
    bot_token = "test_bot_token"
    user = {"id": user_id, "first_name": "Ivan", "last_name": "Petrov", "username": "ivan"}
    pairs = {
        "auth_date": str(int(time.time())),
        "query_id": "AAEAAAE",
        "user": json.dumps(user, separators=(",", ":")),
    }
    data_check_string = "\n".join(f"{k}={pairs[k]}" for k in sorted(pairs))
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    pairs["hash"] = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    return "&".join(f"{k}={v}" for k, v in pairs.items())


def auth_headers(client: TestClient) -> dict[str, str]:
    payload = {"initData": make_init_data()}
    resp = client.post("/auth/telegram/verify", json=payload)
    assert resp.status_code == 200
    token = resp.json()["accessToken"]
    return {"Authorization": f"Bearer {token}"}


def auth_tokens(client: TestClient) -> dict[str, str]:
    payload = {"initData": make_init_data()}
    resp = client.post("/auth/telegram/verify", json=payload)
    assert resp.status_code == 200
    return {
        "access": resp.json()["accessToken"],
        "refresh": resp.json()["refreshToken"],
    }


def test_profile_and_goals_flow() -> None:
    with make_client() as client:
        headers = auth_headers(client)

        profile = client.get("/profile", headers=headers)
        assert profile.status_code == 200
        assert profile.json()["timezone"] == "UTC"

        updated = client.put(
            "/profile",
            json={"timezone": "Europe/Moscow", "goalType": "maintain"},
            headers=headers,
        )
        assert updated.status_code == 200
        assert updated.json()["timezone"] == "Europe/Moscow"
        assert updated.json()["goalType"] == "maintain"

        goal_set = client.put(
            "/goals",
            json={"calories": 2100, "proteinG": 130, "carbsG": 220, "fatG": 70},
            headers=headers,
        )
        assert goal_set.status_code == 200

        goal_get = client.get("/goals", headers=headers)
        assert goal_get.status_code == 200
        assert goal_get.json()["calories"] == 2100


def test_meals_and_dashboard_flow() -> None:
    with make_client() as client:
        headers = auth_headers(client)

        eaten_at = datetime(2026, 3, 10, 12, 30).isoformat() + "Z"
        meal_payload = {
            "title": "Grilled Chicken Salad",
            "mealType": "lunch",
            "eatenAt": eaten_at,
            "items": [
                {"name": "Chicken", "calories": 220, "proteinG": 32, "carbsG": 0, "fatG": 8},
                {"name": "Vegetables", "calories": 90, "proteinG": 3, "carbsG": 12, "fatG": 2},
            ],
        }
        created = client.post("/meals", json=meal_payload, headers=headers)
        assert created.status_code == 201
        meal_id = created.json()["id"]

        meals = client.get("/meals", params={"date": date(2026, 3, 10).isoformat()}, headers=headers)
        assert meals.status_code == 200
        assert len(meals.json()["items"]) == 1

        dashboard = client.get("/dashboard", params={"date": "2026-03-10"}, headers=headers)
        assert dashboard.status_code == 200
        assert dashboard.json()["totals"]["calories"] == 310

        updated = client.patch(
            f"/meals/{meal_id}",
            json={"title": "Chicken Salad Updated"},
            headers=headers,
        )
        assert updated.status_code == 200
        assert updated.json()["title"] == "Chicken Salad Updated"

        deleted = client.delete(f"/meals/{meal_id}", headers=headers)
        assert deleted.status_code == 204


def test_scan_job_created_and_marked_failed_without_key() -> None:
    with make_client() as client:
        headers = auth_headers(client)
        files = {"image": ("meal.png", b"fake-image-bytes", "image/png")}
        created = client.post("/scans", files=files, headers=headers)
        assert created.status_code == 202
        data = created.json()
        assert data["status"] == "failed"

        scan_id = data["id"]
        status_resp = client.get(f"/scans/{scan_id}", headers=headers)
        assert status_resp.status_code == 200
        status_data = status_resp.json()
        assert status_data["id"] == scan_id
        assert status_data["status"] == "failed"
        assert status_data["errorCode"] == "provider_auth_missing"

        cancel_resp = client.post(f"/scans/{scan_id}/cancel", headers=headers)
        assert cancel_resp.status_code == 409


def test_text_only_scan_created_and_marked_failed_without_key() -> None:
    with make_client() as client:
        headers = auth_headers(client)
        created = client.post(
            "/scans",
            data={"description": "Chicken salad with olive oil and feta"},
            headers=headers,
        )
        assert created.status_code == 202
        data = created.json()
        assert data["status"] == "failed"


def test_health_endpoints() -> None:
    with make_client() as client:
        live = client.get("/health/live")
        assert live.status_code == 200
        assert live.json()["status"] == "ok"

        ready = client.get("/health/ready")
        assert ready.status_code == 200
        assert ready.json()["status"] == "ready"


def test_achievements_include_hidden_and_level_tracks() -> None:
    with make_client() as client:
        headers = auth_headers(client)

        breakfast_day_1 = {
            "title": "Apple Breakfast",
            "mealType": "breakfast",
            "eatenAt": datetime(2026, 3, 10, 8, 15).isoformat() + "Z",
            "items": [
                {"name": "Apple", "calories": 95, "proteinG": 0, "carbsG": 25, "fatG": 0},
            ],
        }
        breakfast_day_2 = {
            "title": "Berry Yogurt",
            "mealType": "breakfast",
            "eatenAt": datetime(2026, 3, 11, 8, 45).isoformat() + "Z",
            "items": [
                {"name": "Berries", "calories": 80, "proteinG": 1, "carbsG": 18, "fatG": 0},
            ],
        }
        late_burger = {
            "title": "Late Burger",
            "mealType": "dinner",
            "eatenAt": datetime(2026, 3, 11, 22, 30).isoformat() + "Z",
            "items": [
                {"name": "Burger", "calories": 540, "proteinG": 25, "carbsG": 40, "fatG": 30},
            ],
        }

        assert client.post("/meals", json=breakfast_day_1, headers=headers).status_code == 201
        assert client.post("/meals", json=breakfast_day_2, headers=headers).status_code == 201
        assert client.post("/meals", json=late_burger, headers=headers).status_code == 201

        achievements = client.get("/achievements", headers=headers)
        assert achievements.status_code == 200
        payload = achievements.json()
        by_key = {item["key"]: item for item in payload["items"]}

        assert by_key["first_bite"]["unlocked"] is True
        assert by_key["manual_control"]["unlocked"] is True
        assert by_key["green_light"]["unlocked"] is True
        assert by_key["sweet_truth"]["unlocked"] is True
        assert by_key["night_owl"]["unlocked"] is True
        assert by_key["morning_magic_bronze"]["unlocked"] is True
        assert by_key["morning_magic_silver"]["unlocked"] is True
        assert by_key["calorie_sniper"]["unlocked"] is False
        assert by_key["calorie_sniper"]["title"] == "Hidden achievement"


def test_logout_revokes_access_and_refresh() -> None:
    with make_client() as client:
        tokens = auth_tokens(client)
        headers = {"Authorization": f"Bearer {tokens['access']}"}

        logout_resp = client.post(
            "/auth/logout",
            json={"refreshToken": tokens["refresh"]},
            headers=headers,
        )
        assert logout_resp.status_code == 204

        profile = client.get("/profile", headers=headers)
        assert profile.status_code == 401


def test_metrics_endpoint_exposes_counters() -> None:
    with make_client() as client:
        _ = client.get("/health/live")
        metrics_resp = client.get("/metrics")
        assert metrics_resp.status_code == 200
        text = metrics_resp.text
        assert "http_requests_total" in text
        assert "http_request_duration_ms_count" in text
