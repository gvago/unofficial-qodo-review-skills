# Design: rate limiter service

Status: accepted
Scope: src/ratelimit/

## Requirements

- RL-1: The limiter MUST use a token bucket algorithm.
- RL-2: The default bucket capacity MUST be 100 requests.
- RL-3: The refill interval MUST be 1 second and MUST NOT be
  configurable per client.
- RL-4: When a request is rejected, the service MUST return HTTP 429
  with a Retry-After header.
- RL-5: Limits MUST be keyed by API token, not by client IP address.

## Public interface inventory

The module exposes exactly these public entry points. Anything else is
an internal detail.

- `RateLimiter(capacity: int = 100)`
- `RateLimiter.allow(token: str) -> bool`
- `RateLimiter.retry_after(token: str) -> int`

## Non-goals

- Distributed rate limiting across instances.
- Persistence of bucket state across restarts.
