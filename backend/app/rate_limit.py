from __future__ import annotations

import time
from collections import defaultdict, deque


class InMemoryRateLimiter:
    def __init__(self):
        self._store: dict[str, deque[float]] = defaultdict(deque)

    def allow(self, key: str, limit: int, window_seconds: int = 60) -> bool:
        now = time.time()
        queue = self._store[key]
        while queue and queue[0] <= now - window_seconds:
            queue.popleft()
        if len(queue) >= limit:
            return False
        queue.append(now)
        return True
