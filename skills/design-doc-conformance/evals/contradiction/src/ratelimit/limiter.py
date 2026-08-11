import time


class RateLimiter:
    def __init__(self, capacity=50):
        self.capacity = capacity
        self._buckets = {}

    def _refill(self, bucket, now):
        elapsed = now - bucket["last"]
        bucket["tokens"] = min(self.capacity, bucket["tokens"] + elapsed * self.capacity)
        bucket["last"] = now

    def allow(self, ip):
        now = time.monotonic()
        bucket = self._buckets.setdefault(ip, {"tokens": self.capacity, "last": now})
        self._refill(bucket, now)
        if bucket["tokens"] >= 1:
            bucket["tokens"] -= 1
            return True
        return False

    def retry_after(self, ip):
        bucket = self._buckets.get(ip)
        if bucket is None or bucket["tokens"] >= 1:
            return 0
        return 1
