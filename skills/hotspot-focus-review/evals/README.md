# Hotspot review evals

These are review inputs and expected outcomes, not executed review results.
For cases 1 and 2, mount src/payments and src/booking at their indicated
repository-relative paths. For case 3, mount evals/unmatched/scripts/reservation.py
as scripts/reservation.py. Do not match against the enclosing evals directory.

1. violations: unstable retry keys, immediate retries, false payment success,
   missing correlated error log, naive instants and float monetary totals.
2. clean: stable keys, bounded backoff, correlated log and propagation, aware
   timestamps and Decimal constructed from strings.
3. unmatched path: present reservation.py as scripts/reservation.py. All hotspot
   rules are not applicable. Generic reviewers remain free to report real defects.

The gateway is a local injected adapter contract. Never call a payment service.
