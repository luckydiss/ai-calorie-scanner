from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

import httpx


@dataclass(frozen=True)
class AISettings:
    api_key: str
    model: str
    base_url: str
    timeout_seconds: float
    app_name: str


class OpenRouterClient:
    def __init__(self, settings: AISettings):
        self._settings = settings

    def _extract_json(self, content: str) -> dict[str, Any]:
        content = content.strip()
        try:
            return json.loads(content)
        except json.JSONDecodeError:
            match = re.search(r"\{.*\}", content, re.DOTALL)
            if not match:
                raise ValueError("Model output is not valid JSON") from None
            return json.loads(match.group(0))

    def _chat_json(self, prompt: str, image_data_url: str | None = None) -> dict[str, Any]:
        content: list[dict[str, Any]] = [{"type": "text", "text": prompt}]
        if image_data_url:
            content.append({"type": "image_url", "image_url": {"url": image_data_url}})

        payload = {
            "model": self._settings.model,
            "messages": [{"role": "user", "content": content}],
            "temperature": 0.1,
        }
        headers = {
            "Authorization": f"Bearer {self._settings.api_key}",
            "Content-Type": "application/json",
            "HTTP-Referer": "http://localhost",
            "X-Title": self._settings.app_name,
        }
        with httpx.Client(timeout=self._settings.timeout_seconds) as client:
            resp = client.post(f"{self._settings.base_url}/chat/completions", json=payload, headers=headers)
            resp.raise_for_status()
            data = resp.json()

        choices = data.get("choices") or []
        if not choices:
            raise ValueError("No choices in model response")
        message = choices[0].get("message") or {}
        content_raw = message.get("content")
        if isinstance(content_raw, list):
            text_parts: list[str] = []
            for part in content_raw:
                if isinstance(part, dict) and part.get("type") == "text":
                    text_parts.append(str(part.get("text", "")))
            content_raw = "\n".join(text_parts)
        if not isinstance(content_raw, str) or not content_raw.strip():
            raise ValueError("Empty model content")
        return self._extract_json(content_raw)

    def _normalize(self, parsed: dict[str, Any]) -> dict[str, Any]:
        return {
            "dishName": str(parsed.get("dishName") or "Unknown meal"),
            "calories": max(0, int(round(float(parsed.get("calories", 0))))),
            "proteinG": max(0.0, float(parsed.get("proteinG", 0))),
            "carbsG": max(0.0, float(parsed.get("carbsG", 0))),
            "fatG": max(0.0, float(parsed.get("fatG", 0))),
            "confidence": min(1.0, max(0.0, float(parsed.get("confidence", 0.5)))),
            "alternatives": [str(x) for x in (parsed.get("alternatives") or [])][:5],
        }

    def analyze_food(self, image_data_url: str, description: str | None = None) -> dict[str, Any]:
        prompt = (
            "Analyze meal photo and estimate nutrition.\n"
            "Return strict JSON only with keys: "
            "dishName (string), calories (int), proteinG (number), carbsG (number), "
            "fatG (number), confidence (number from 0 to 1), alternatives (array of strings)."
        )
        if description:
            prompt += f"\nUser description: {description.strip()[:500]}"
        parsed = self._chat_json(prompt=prompt, image_data_url=image_data_url)
        return self._normalize(parsed)

    def analyze_text(self, description: str) -> dict[str, Any]:
        prompt = (
            "Estimate nutrition from text meal description only.\n"
            "Return strict JSON only with keys: "
            "dishName (string), calories (int), proteinG (number), carbsG (number), "
            "fatG (number), confidence (number from 0 to 1), alternatives (array of strings).\n"
            f"Meal description: {description.strip()[:1200]}"
        )
        parsed = self._chat_json(prompt=prompt, image_data_url=None)
        return self._normalize(parsed)

    def recalculate(self, base_result: dict[str, Any], comment: str) -> dict[str, Any]:
        prompt = (
            "Recalculate nutrition using previous estimate and user correction.\n"
            "Return strict JSON only with keys: "
            "dishName (string), calories (int), proteinG (number), carbsG (number), "
            "fatG (number), confidence (number from 0 to 1), alternatives (array of strings).\n"
            f"Previous estimate: {json.dumps(base_result, ensure_ascii=True)}\n"
            f"User correction: {comment.strip()[:800]}"
        )
        parsed = self._chat_json(prompt=prompt, image_data_url=None)
        return self._normalize(parsed)
