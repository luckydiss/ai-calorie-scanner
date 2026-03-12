from __future__ import annotations

import json
import uuid
from datetime import UTC, date, datetime, timedelta
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from ..db import DBConnection, transaction
from .definitions import ACHIEVEMENT_DEFINITIONS, COFFEE_KEYWORDS, GREEN_LIGHT_KEYWORDS, HONESTY_KEYWORDS
from .schemas import AchievementOut, AchievementsResponse, StreakOut


def now_utc() -> datetime:
    return datetime.now(tz=UTC)


def dt_to_str(dt: datetime) -> str:
    return dt.astimezone(UTC).isoformat()


def str_to_dt(value: str | datetime) -> datetime:
    if isinstance(value, datetime):
        return value
    return datetime.fromisoformat(value)


def ensure_achievement_catalog(conn: DBConnection) -> None:
    for definition in ACHIEVEMENT_DEFINITIONS:
        conn.execute(
            """
            INSERT INTO achievements(id, key, title, description, rule_json, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT (key) DO UPDATE
            SET title = EXCLUDED.title,
                description = EXCLUDED.description,
                rule_json = EXCLUDED.rule_json
            """,
            (
                str(uuid.uuid4()),
                definition["key"],
                definition["title"],
                definition["description"],
                json.dumps(
                    {
                        "metric": definition["metric"],
                        "target": definition["target"],
                        "hidden": bool(definition.get("hidden", False)),
                        "group": definition.get("group"),
                        "tier": definition.get("tier"),
                    }
                ),
                dt_to_str(now_utc()),
            ),
        )


def compute_streak(days_desc: list[date]) -> tuple[int, int]:
    if not days_desc:
        return 0, 0
    sorted_days = sorted(set(days_desc), reverse=True)
    current = 1
    for idx in range(1, len(sorted_days)):
        if (sorted_days[idx - 1] - sorted_days[idx]).days == 1:
            current += 1
        else:
            break
    longest = 1
    run = 1
    for idx in range(1, len(sorted_days)):
        if (sorted_days[idx - 1] - sorted_days[idx]).days == 1:
            run += 1
            longest = max(longest, run)
        else:
            run = 1
    return current, longest


def normalize_text(value: str) -> str:
    return " ".join(value.lower().strip().split())


def has_any_keyword(texts: list[str], keywords: set[str]) -> bool:
    normalized = " ".join(normalize_text(text) for text in texts if text)
    return any(keyword in normalized for keyword in keywords)


def get_user_timezone(conn: DBConnection, user_id: str) -> ZoneInfo:
    profile_row = conn.execute("SELECT timezone FROM profiles WHERE user_id = ?", (user_id,)).fetchone()
    timezone_name = profile_row["timezone"] if profile_row and profile_row["timezone"] else "UTC"
    try:
        return ZoneInfo(str(timezone_name))
    except ZoneInfoNotFoundError:
        return ZoneInfo("UTC")


def get_goal_for_day(conn: DBConnection, user_id: str, day: date) -> dict[str, float] | None:
    goal_row = conn.execute(
        """
        SELECT calories, protein_g, carbs_g, fat_g
        FROM daily_goals
        WHERE user_id = ? AND effective_from <= ?
        ORDER BY effective_from DESC
        LIMIT 1
        """,
        (user_id, day.isoformat()),
    ).fetchone()
    if not goal_row:
        return None
    return {
        "calories": float(goal_row["calories"]),
        "protein_g": float(goal_row["protein_g"]),
        "carbs_g": float(goal_row["carbs_g"]),
        "fat_g": float(goal_row["fat_g"]),
    }


def build_achievement_state(conn: DBConnection, user_id: str) -> tuple[dict[str, int], StreakOut]:
    user_tz = get_user_timezone(conn, user_id)
    meal_rows = conn.execute(
        """
        SELECT
          m.id AS meal_id,
          m.title,
          m.meal_type,
          m.eaten_at,
          m.source,
          mi.name AS item_name,
          mi.calories,
          mi.protein_g,
          mi.carbs_g,
          mi.fat_g
        FROM meals m
        JOIN meal_items mi ON mi.meal_id = m.id
        WHERE m.user_id = ?
        ORDER BY m.eaten_at DESC
        """,
        (user_id,),
    ).fetchall()
    recalc_row = conn.execute(
        "SELECT COUNT(*)::int AS cnt FROM events WHERE user_id = ? AND event_name = 'scan_recalculated'",
        (user_id,),
    ).fetchone()

    meals_by_id: dict[str, dict[str, Any]] = {}
    for row in meal_rows:
        meal_id = str(row["meal_id"])
        meal = meals_by_id.setdefault(
            meal_id,
            {
                "title": row["title"],
                "meal_type": row["meal_type"],
                "eaten_at": str_to_dt(row["eaten_at"]).astimezone(user_tz),
                "source": row["source"],
                "items": [],
            },
        )
        meal["items"].append(
            {
                "name": row["item_name"],
                "calories": float(row["calories"]),
                "protein_g": float(row["protein_g"]),
                "carbs_g": float(row["carbs_g"]),
                "fat_g": float(row["fat_g"]),
            }
        )

    daily: dict[date, dict[str, Any]] = {}
    total_meals = len(meals_by_id)
    ai_meals = 0
    manual_meals = 0
    honesty_logs = 0
    late_night_logs = 0
    green_logs = 0
    coffee_logs = 0
    micro_logs = 0
    big_feast_meals = 0

    for meal in meals_by_id.values():
        local_dt = meal["eaten_at"]
        local_day = local_dt.date()
        item_names = [str(item["name"]) for item in meal["items"]]
        texts = [str(meal["title"]), *item_names]
        day_state = daily.setdefault(
            local_day,
            {
                "meal_count": 0,
                "unique_items": set(),
                "calories": 0.0,
                "protein_g": 0.0,
                "carbs_g": 0.0,
                "fat_g": 0.0,
                "breakfast_before_10": False,
                "meal_times": [],
                "has_snack": False,
            },
        )
        day_state["meal_count"] += 1
        day_state["unique_items"].update(normalize_text(name) for name in item_names if name)
        meal_calories = sum(float(item["calories"]) for item in meal["items"])
        day_state["calories"] += meal_calories
        day_state["protein_g"] += sum(float(item["protein_g"]) for item in meal["items"])
        day_state["carbs_g"] += sum(float(item["carbs_g"]) for item in meal["items"])
        day_state["fat_g"] += sum(float(item["fat_g"]) for item in meal["items"])
        day_state["meal_times"].append(local_dt)

        if meal["source"] == "ai":
            ai_meals += 1
        if meal["source"] == "manual":
            manual_meals += 1
        if has_any_keyword(texts, HONESTY_KEYWORDS):
            honesty_logs += 1
        if has_any_keyword(texts, GREEN_LIGHT_KEYWORDS):
            green_logs += 1
        if has_any_keyword(texts, COFFEE_KEYWORDS):
            coffee_logs += 1
        if local_dt.hour >= 22:
            late_night_logs += 1
        if meal["meal_type"] == "breakfast" and local_dt.hour < 10:
            day_state["breakfast_before_10"] = True
        if meal["meal_type"] == "snack":
            day_state["has_snack"] = True
        if any(float(item["calories"]) < 50 for item in meal["items"]):
            micro_logs += 1
        if meal_calories >= 900:
            big_feast_meals += 1

    meal_days = sorted(daily.keys(), reverse=True)
    current_streak_days, longest_streak_days = compute_streak(meal_days)
    last_logged_day = meal_days[0] if meal_days else None

    with transaction(conn):
        conn.execute(
            """
            INSERT INTO streaks(user_id, current_streak_days, longest_streak_days, last_logged_day, updated_at)
            VALUES (?, ?, ?, ?, ?)
            ON CONFLICT (user_id) DO UPDATE
            SET current_streak_days = EXCLUDED.current_streak_days,
                longest_streak_days = EXCLUDED.longest_streak_days,
                last_logged_day = EXCLUDED.last_logged_day,
                updated_at = EXCLUDED.updated_at
            """,
            (
                user_id,
                current_streak_days,
                longest_streak_days,
                last_logged_day.isoformat() if last_logged_day else None,
                dt_to_str(now_utc()),
            ),
        )

    breakfast_days = [day for day in meal_days if daily[day]["breakfast_before_10"]]
    breakfast_streak_days, _ = compute_streak(breakfast_days)

    max_unique_items_day = max((len(day_state["unique_items"]) for day_state in daily.values()), default=0)
    comeback_days = 0
    weekend_double_days = 0
    calorie_sniper_days = 0
    snack_master_days = 0
    holy_trinity_days = 0
    meal_interval_pairs = 0
    thursday_two_meal_days = 0
    calorie_corridor_days: list[date] = []

    sorted_asc = sorted(meal_days)
    for idx in range(1, len(sorted_asc)):
        if (sorted_asc[idx] - sorted_asc[idx - 1]).days > 1:
            comeback_days += 1

    for day, day_state in daily.items():
        if day_state["has_snack"] or day_state["meal_count"] >= 4:
            snack_master_days += 1
        if day.weekday() == 3 and day_state["meal_count"] >= 2:
            thursday_two_meal_days += 1
        if day.weekday() == 5 and day_state["meal_count"] >= 2:
            sunday_state = daily.get(day + timedelta(days=1))
            if sunday_state and sunday_state["meal_count"] >= 2:
                weekend_double_days += 1
        goal = get_goal_for_day(conn, user_id, day)
        meal_times = sorted(day_state["meal_times"])
        for idx in range(1, len(meal_times)):
            gap_hours = (meal_times[idx] - meal_times[idx - 1]).total_seconds() / 3600
            if 3 <= gap_hours <= 5:
                meal_interval_pairs += 1
                break
        if goal and abs(day_state["calories"] - goal["calories"]) <= 20:
            calorie_sniper_days += 1
        if goal and goal["calories"] > 0 and 0.85 * goal["calories"] <= day_state["calories"] <= 1.15 * goal["calories"]:
            calorie_corridor_days.append(day)
        if (
            goal
            and goal["protein_g"] > 0
            and goal["carbs_g"] > 0
            and goal["fat_g"] > 0
            and day_state["protein_g"] >= 0.75 * goal["protein_g"]
            and day_state["carbs_g"] >= 0.75 * goal["carbs_g"]
            and day_state["fat_g"] >= 0.75 * goal["fat_g"]
        ):
            holy_trinity_days += 1

    calorie_corridor_streak_days, _ = compute_streak(sorted(calorie_corridor_days, reverse=True))

    metrics = {
        "total_meals": total_meals,
        "ai_meals": ai_meals,
        "manual_meals": manual_meals,
        "scan_recalculations": int(recalc_row["cnt"] if recalc_row else 0),
        "honesty_logs": honesty_logs,
        "late_night_logs": late_night_logs,
        "green_logs": green_logs,
        "coffee_logs": coffee_logs,
        "micro_logs": micro_logs,
        "big_feast_meals": big_feast_meals,
        "max_unique_items_day": max_unique_items_day,
        "breakfast_streak_days": breakfast_streak_days,
        "current_streak_days": current_streak_days,
        "calorie_sniper_days": calorie_sniper_days,
        "snack_master_days": snack_master_days,
        "holy_trinity_days": holy_trinity_days,
        "meal_interval_pairs": meal_interval_pairs,
        "thursday_two_meal_days": thursday_two_meal_days,
        "calorie_corridor_streak_days": calorie_corridor_streak_days,
        "comeback_days": comeback_days,
        "weekend_double_days": weekend_double_days,
    }
    return metrics, StreakOut(
        currentDays=current_streak_days,
        longestDays=longest_streak_days,
        lastLoggedDay=last_logged_day,
    )


def evaluate_and_unlock_achievements(conn: DBConnection, user_id: str) -> AchievementsResponse:
    ensure_achievement_catalog(conn)
    metrics, streak = build_achievement_state(conn, user_id)

    catalog_rows = conn.execute(
        "SELECT id, key, title, description, rule_json FROM achievements",
    ).fetchall()
    by_key = {row["key"]: row for row in catalog_rows}

    with transaction(conn):
        for definition in ACHIEVEMENT_DEFINITIONS:
            key = definition["key"]
            target = int(definition["target"])
            progress = int(metrics.get(definition["metric"], 0))
            if progress >= target and key in by_key:
                conn.execute(
                    """
                    INSERT INTO user_achievements(id, user_id, achievement_id, unlocked_at)
                    VALUES (?, ?, ?, ?)
                    ON CONFLICT (user_id, achievement_id) DO NOTHING
                    """,
                    (str(uuid.uuid4()), user_id, by_key[key]["id"], dt_to_str(now_utc())),
                )

    unlocked_rows = conn.execute(
        """
        SELECT a.key, ua.unlocked_at
        FROM user_achievements ua
        JOIN achievements a ON a.id = ua.achievement_id
        WHERE ua.user_id = ?
        """,
        (user_id,),
    ).fetchall()
    unlocked_by_key = {row["key"]: str_to_dt(row["unlocked_at"]) for row in unlocked_rows}

    items: list[AchievementOut] = []
    for definition in ACHIEVEMENT_DEFINITIONS:
        key = definition["key"]
        progress = int(metrics.get(definition["metric"], 0))
        target = int(definition["target"])
        row = by_key.get(key)
        hidden = bool(definition.get("hidden", False))
        unlocked = key in unlocked_by_key
        title = row["title"] if row else definition["title"]
        description = row["description"] if row else definition["description"]
        if hidden and not unlocked:
            title = "Hidden achievement"
            description = "Log in unusual ways to discover this one."
        items.append(
            AchievementOut(
                key=key,
                title=title,
                description=description,
                progress=min(progress, target),
                target=target,
                unlocked=unlocked,
                unlockedAt=unlocked_by_key.get(key),
                hidden=hidden,
                group=definition.get("group"),
                tier=definition.get("tier"),
            )
        )
    return AchievementsResponse(streak=streak, items=items)
