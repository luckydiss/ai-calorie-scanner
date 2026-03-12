import asyncio
import json
import logging
import os
from typing import Any

import httpx


logger = logging.getLogger("telegram_bot")
logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))


def get_required_env(name: str) -> str:
    value = os.getenv(name, "").strip()
    if not value:
        raise RuntimeError(f"{name} is required for bot service")
    return value


def build_webapp_reply_markup(webapp_url: str) -> dict[str, Any]:
    return {
        "inline_keyboard": [
            [
                {
                    "text": "Open Calorie Scanner",
                    "web_app": {"url": webapp_url},
                }
            ]
        ]
    }


async def send_webapp_button(
    client: httpx.AsyncClient, api_base: str, chat_id: int, webapp_url: str
) -> None:
    text = (
        "Open the mini app to track meals, scan food, and calculate calories with AI."
    )
    payload = {
        "chat_id": chat_id,
        "text": text,
        "reply_markup": build_webapp_reply_markup(webapp_url),
    }
    response = await client.post(f"{api_base}/sendMessage", json=payload)
    response.raise_for_status()
    body = response.json()
    if not body.get("ok"):
        raise RuntimeError(f"sendMessage failed: {body}")


async def set_chat_menu_button(client: httpx.AsyncClient, api_base: str, webapp_url: str) -> None:
    payload = {
        "menu_button": {
            "type": "web_app",
            "text": "Open App",
            "web_app": {"url": webapp_url},
        }
    }
    response = await client.post(f"{api_base}/setChatMenuButton", json=payload)
    response.raise_for_status()
    body = response.json()
    if not body.get("ok"):
        raise RuntimeError(f"setChatMenuButton failed: {body}")


def iter_message_updates(updates: list[dict[str, Any]]) -> list[dict[str, Any]]:
    result: list[dict[str, Any]] = []
    for update in updates:
        message = update.get("message")
        if not isinstance(message, dict):
            continue
        chat = message.get("chat")
        if not isinstance(chat, dict):
            continue
        chat_id = chat.get("id")
        if not isinstance(chat_id, int):
            continue
        text = message.get("text")
        if text is not None and not isinstance(text, str):
            continue
        result.append({"update_id": update.get("update_id"), "chat_id": chat_id, "text": text or ""})
    return result


async def run_bot() -> None:
    token = get_required_env("TELEGRAM_BOT_TOKEN")
    webapp_url = get_required_env("TELEGRAM_WEBAPP_URL")
    api_base = f"https://api.telegram.org/bot{token}"
    offset: int | None = None
    timeout_seconds = 50

    async with httpx.AsyncClient(timeout=65) as client:
        try:
            await set_chat_menu_button(client, api_base, webapp_url)
            logger.info(json.dumps({"event": "bot_menu_button_synced", "webapp_url": webapp_url}))
        except Exception as exc:  # noqa: BLE001
            logger.error(json.dumps({"event": "bot_menu_button_sync_failed", "error": str(exc)}))
        logger.info(json.dumps({"event": "bot_started"}))
        while True:
            try:
                payload: dict[str, Any] = {
                    "timeout": timeout_seconds,
                    "allowed_updates": ["message"],
                }
                if offset is not None:
                    payload["offset"] = offset
                response = await client.post(f"{api_base}/getUpdates", json=payload)
                response.raise_for_status()
                body = response.json()
                if not body.get("ok"):
                    raise RuntimeError(f"getUpdates failed: {body}")

                updates = body.get("result", [])
                if not isinstance(updates, list):
                    updates = []

                for message_update in iter_message_updates(updates):
                    update_id = message_update["update_id"]
                    chat_id = message_update["chat_id"]
                    text = message_update["text"].strip().lower()
                    offset = int(update_id) + 1 if isinstance(update_id, int) else offset
                    if text.startswith("/start") or text.startswith("/app") or text == "":
                        await send_webapp_button(client, api_base, chat_id, webapp_url)
                        logger.info(
                            json.dumps(
                                {
                                    "event": "bot_sent_webapp_button",
                                    "chat_id": chat_id,
                                }
                            )
                        )
                await asyncio.sleep(0.2)
            except asyncio.CancelledError:
                raise
            except Exception as exc:  # noqa: BLE001
                logger.error(json.dumps({"event": "bot_loop_error", "error": str(exc)}))
                await asyncio.sleep(2)


if __name__ == "__main__":
    asyncio.run(run_bot())
