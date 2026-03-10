from __future__ import annotations

from collections import defaultdict
from threading import Lock


LabelKey = tuple[tuple[str, str], ...]


def _labels_key(labels: dict[str, str]) -> LabelKey:
    return tuple(sorted((k, str(v)) for k, v in labels.items()))


def _format_labels(key: LabelKey) -> str:
    if not key:
        return ""
    parts = [f'{k}="{v}"' for k, v in key]
    return "{" + ",".join(parts) + "}"


class MetricsStore:
    def __init__(self) -> None:
        self._lock = Lock()
        self._counters: dict[str, dict[LabelKey, float]] = defaultdict(lambda: defaultdict(float))
        self._hist_sums: dict[str, dict[LabelKey, float]] = defaultdict(lambda: defaultdict(float))
        self._hist_counts: dict[str, dict[LabelKey, float]] = defaultdict(lambda: defaultdict(float))

    def inc(self, name: str, labels: dict[str, str], value: float = 1.0) -> None:
        key = _labels_key(labels)
        with self._lock:
            self._counters[name][key] += value

    def observe(self, name: str, labels: dict[str, str], value: float) -> None:
        key = _labels_key(labels)
        with self._lock:
            self._hist_sums[name][key] += value
            self._hist_counts[name][key] += 1.0

    def render_prometheus(self) -> str:
        lines: list[str] = []
        with self._lock:
            for metric_name in sorted(self._counters):
                lines.append(f"# TYPE {metric_name} counter")
                for key, value in sorted(self._counters[metric_name].items()):
                    lines.append(f"{metric_name}{_format_labels(key)} {value}")
            for metric_name in sorted(self._hist_sums):
                lines.append(f"# TYPE {metric_name} summary")
                for key, value in sorted(self._hist_sums[metric_name].items()):
                    lines.append(f"{metric_name}_sum{_format_labels(key)} {value}")
                for key, value in sorted(self._hist_counts[metric_name].items()):
                    lines.append(f"{metric_name}_count{_format_labels(key)} {value}")
        return "\n".join(lines) + "\n"
