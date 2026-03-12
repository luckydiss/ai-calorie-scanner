from __future__ import annotations

from datetime import date, datetime
from typing import Literal

from pydantic import BaseModel, Field


class StreakOut(BaseModel):
    currentDays: int
    longestDays: int
    lastLoggedDay: date | None = None


class AchievementOut(BaseModel):
    key: str
    title: str
    description: str
    progress: int = Field(ge=0)
    target: int = Field(ge=1)
    unlocked: bool
    unlockedAt: datetime | None = None
    hidden: bool = False
    group: str | None = None
    tier: Literal["bronze", "silver", "gold"] | None = None


class AchievementsResponse(BaseModel):
    streak: StreakOut
    items: list[AchievementOut]
