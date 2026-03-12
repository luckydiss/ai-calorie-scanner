from __future__ import annotations

import json
import uuid
from dataclasses import dataclass
from datetime import UTC, date, datetime
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..db import DBConnection, transaction
from .schemas import LevelProgressOut

MEAL_LOGGED_XP = 5
DAY_COMPLETED_XP = 10
STREAK_MAINTAINED_XP = 10
CALORIE_GOAL_REACHED_XP = 20
COMPLETED_DAY_MEALS = 3
CALORIE_GOAL_LOWER_BOUND = 0.85
CALORIE_GOAL_UPPER_BOUND = 1.15


def now_utc() -> datetime:
    return datetime.now(tz=UTC)


def dt_to_str(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def str_to_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def xp_required_for_level(level: int) -> int:
    return 100 + level * 50


@dataclass
class ProgressionAwardResult:
    progress: LevelProgressOut
    leveledUp: bool


def get_user_timezone(conn: DBConnection, user_id: str) -> ZoneInfo:
    profile_row = conn.execute("SELECT timezone FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    timezone_name = profile_row["timezone"] if profile_row and profile_row["timezone"] else "UTC"
    try:
        return ZoneInfo(str(timezone_name))
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def ensure_progression_row(conn: DBConnection, user_id: str) -> None:
    now = dt_to_str(now_utc())
    conn.execute(
        """
        INSERT INTO user_progression(user_id, level, current_xp, created_at, updated_at)
        VALUES (?, 1, 0, ?, ?)
        ON CONFLICT (user_id) DO NOTHING
        """,
        (user_id, now, now),
    )


def get_progression(conn: DBConnection, user_id: str) -> LevelProgressOut:
    ensure_progression_row(conn, user_id)
    row = conn.execute(
        """
        SELECT level, current_xp
        FROM user_progression
        WHERE user_id = ?
        """,
        (user_id,),
    ).fetchone()
    level = int(row["level"]) if row else 1
    current_xp = int(row["current_xp"]) if row else 0
    return LevelProgressOut(level=level, currentXp=current_xp, xpRequired=xp_required_for_level(level))


def was_xp_event_awarded(conn: DBConnection, user_id: str, event_name: str, event_key: str) -> bool:
    row = conn.execute(
        """
        SELECT 1
        FROM events
        WHERE user_id = ?
          AND event_name = ?
          AND payload_json->>'key' = ?
        LIMIT 1
        """,
        (user_id, event_name, event_key),
    ).fetchone()
    return row is not None


def award_xp_once(
    conn: DBConnection,
    user_id: str,
    *,
    event_name: str,
    event_key: str,
    amount: int,
    payload: dict[str, str | int] | None = None,
) -> ProgressionAwardResult:
    ensure_progression_row(conn, user_id)
    current = get_progression(conn, user_id)
    if was_xp_event_awarded(conn, user_id, event_name, event_key):
        return ProgressionAwardResult(progress=current, leveledUp=False)

    level = current.level
    current_xp = current.currentXp + amount
    leveled_up = False
    while current_xp >= xp_required_for_level(level):
        current_xp -= xp_required_for_level(level)
        level += 1
        leveled_up = True

    now = dt_to_str(now_utc())
    payload_json = {"key": event_key, "amount": amount, **(payload or {})}
    with transaction(conn):
        conn.execute(
            """
            UPDATE user_progression
            SET level = ?, current_xp = ?, updated_at = ?
            WHERE user_id = ?
            """,
            (level, current_xp, now, user_id),
        )
        conn.execute(
            """
            INSERT INTO events(id, user_id, event_name, payload_json, created_at)
            VALUES (?, ?, ?, ?, ?)
            """,
            (str(uuid.uuid4()), user_id, event_name, json.dumps(payload_json), now),
        )

    return ProgressionAwardResult(
        progress=LevelProgressOut(level=level, currentXp=current_xp, xpRequired=xp_required_for_level(level)),
        leveledUp=leveled_up,
    )


def count_meals_for_local_day(conn: DBConnection, user_id: str, timezone_name: str, local_day: date) -> int:
    row = conn.execute(
        """
        SELECT COUNT(*)::int AS cnt
        FROM meals
        WHERE user_id = ?
          AND DATE(eaten_at AT TIME ZONE ?) = ?
        """,
        (user_id, timezone_name, local_day.isoformat()),
    ).fetchone()
    return int(row["cnt"]) if row else 0


def get_local_logged_days_desc(conn: DBConnection, user_id: str, timezone_name: str) -> list[date]:
    rows = conn.execute(
        """
        SELECT DISTINCT DATE(eaten_at AT TIME ZONE ?) AS local_day
        FROM meals
        WHERE user_id = ?
        ORDER BY local_day DESC
        """,
        (timezone_name, user_id),
    ).fetchall()
    return [row["local_day"] for row in rows]


def get_current_streak_days(conn: DBConnection, user_id: str, timezone_name: str) -> int:
    days = get_local_logged_days_desc(conn, user_id, timezone_name)
    if not days:
        return 0
    streak = 1
    for index in range(1, len(days)):
        if (days[index - 1] - days[index]).days == 1:
            streak += 1
        else:
            break
    return streak


def get_goal_for_day(conn: DBConnection, user_id: str, local_day: date) -> int | None:
    row = conn.execute(
        """
        SELECT calories
        FROM daily_goals
        WHERE user_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC
        LIMIT 1
        """,
        (user_id, local_day.isoformat()),
    ).fetchone()
    return int(row["calories"]) if row else None


def get_calories_for_local_day(conn: DBConnection, user_id: str, timezone_name: str, local_day: date) -> int:
    row = conn.execute(
        """
        SELECT COALESCE(SUM(mi.calories), 0)::int AS total
        FROM meals m
        JOIN meal_items mi ON mi.meal_id = m.id
        WHERE m.user_id = ?
          AND DATE(m.eaten_at AT TIME ZONE ?) = ?
        """,
        (user_id, timezone_name, local_day.isoformat()),
    ).fetchone()
    return int(row["total"]) if row else 0


def award_progress_for_meal(conn: DBConnection, user_id: str, meal_id: str) -> ProgressionAwardResult:
    ensure_progression_row(conn, user_id)
    meal_row = conn.execute(
        """
        SELECT eaten_at
        FROM meals
        WHERE id = ? AND user_id = ?
        """,
        (meal_id, user_id),
    ).fetchone()
    if not meal_row:
        return ProgressionAwardResult(progress=get_progression(conn, user_id), leveledUp=False)

    timezone = get_user_timezone(conn, user_id)
    timezone_name = str(timezone)
    local_dt = str_to_dt(meal_row["eaten_at"]).astimezone(timezone)
    local_day = local_dt.date()

    leveled_up = False
    result = award_xp_once(
        conn,
        user_id,
        event_name="xp_meal_logged",
        event_key=meal_id,
        amount=MEAL_LOGGED_XP,
        payload={"mealId": meal_id},
    )
    leveled_up = leveled_up or result.leveledUp

    if count_meals_for_local_day(conn, user_id, timezone_name, local_day) >= COMPLETED_DAY_MEALS:
        result = award_xp_once(
            conn,
            user_id,
            event_name="xp_day_completed",
            event_key=local_day.isoformat(),
            amount=DAY_COMPLETED_XP,
            payload={"day": local_day.isoformat()},
        )
        leveled_up = leveled_up or result.leveledUp

    if get_current_streak_days(conn, user_id, timezone_name) >= 2:
        result = award_xp_once(
            conn,
            user_id,
            event_name="xp_streak_maintained",
            event_key=local_day.isoformat(),
            amount=STREAK_MAINTAINED_XP,
            payload={"day": local_day.isoformat()},
        )
        leveled_up = leveled_up or result.leveledUp

    goal_calories = get_goal_for_day(conn, user_id, local_day)
    total_calories = get_calories_for_local_day(conn, user_id, timezone_name, local_day)
    if goal_calories and goal_calories * CALORIE_GOAL_LOWER_BOUND <= total_calories <= goal_calories * CALORIE_GOAL_UPPER_BOUND:
        result = award_xp_once(
            conn,
            user_id,
            event_name="xp_calorie_goal_reached",
            event_key=local_day.isoformat(),
            amount=CALORIE_GOAL_REACHED_XP,
            payload={"day": local_day.isoformat()},
        )
        leveled_up = leveled_up or result.leveledUp

    progress = get_progression(conn, user_id)
    return ProgressionAwardResult(progress=progress, leveledUp=leveled_up)
