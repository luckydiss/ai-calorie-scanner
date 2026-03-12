from __future__ import annotations

from pydantic import BaseModel, Field


class LevelProgressOut(BaseModel):
    level: int = Field(ge=1)
    currentXp: int = Field(ge=0)
    xpRequired: int = Field(ge=1)
