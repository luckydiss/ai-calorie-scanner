from __future__ import annotations

import hashlib
import hmac
import json
import time
from urllib.parse import parse_qsl


class TelegramAuthError(Exception):
    pass


def verify_init_data(init_data: str, bot_token: str, ttl_seconds: int) -> dict:
    pairs = dict(parse_qsl(init_data, keep_blank_values=True))
    recv_hash = pairs.get("hash")
    if not recv_hash:
        raise TelegramAuthError("Missing hash")

    auth_date = pairs.get("auth_date")
    if not auth_date or not auth_date.isdigit():
        raise TelegramAuthError("Missing auth_date")
    now = int(time.time())
    if now - int(auth_date) > ttl_seconds:
        raise TelegramAuthError("initData expired")

    # https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
    check_parts = [f"{k}={v}" for k, v in sorted(pairs.items()) if k != "hash"]
    data_check_string = "\n".join(check_parts)
    secret_key = hmac.new(b"WebAppData", bot_token.encode("utf-8"), hashlib.sha256).digest()
    expected_hash = hmac.new(secret_key, data_check_string.encode("utf-8"), hashlib.sha256).hexdigest()
    if not hmac.compare_digest(expected_hash, recv_hash):
        raise TelegramAuthError("Invalid hash")

    raw_user = pairs.get("user")
    if not raw_user:
        raise TelegramAuthError("Missing user payload")
    try:
        user = json.loads(raw_user)
    except json.JSONDecodeError as exc:
        raise TelegramAuthError("Invalid user json") from exc
    if not isinstance(user, dict):
        raise TelegramAuthError("Invalid user payload")
    return user
