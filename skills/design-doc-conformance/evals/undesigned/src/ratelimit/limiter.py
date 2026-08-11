import time


class RateLimiter:
    def __init__(self, capacity=100):
        self.capacity = capacity
        self._refill_interval = 1.0
        self._buckets = {}

    def _refill(self, bucket, now):
        elapsed = now - bucket["last"]
        rate = self.capacity / self._refill_interval
        bucket["tokens"] = min(self.capacity, bucket["tokens"] + elapsed * rate)
        bucket["last"] = now

    def allow(self, token):
        now = time.monotonic()
        bucket = self._buckets.setdefault(token, {"tokens": self.capacity, "last": now})
        self._refill(bucket, now)
        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return True
        return False

    def retry_after(self, token):
        bucket = self._buckets.get(token)
        if bucket is None or bucket["tokens"] >= 1:
            return 0
        return 1

    def reset(self, token):
        self._buckets.pop(token, None)

    def set_refill_interval(self, seconds):
        if seconds > 0:
            self._refill_interval = float(seconds)
