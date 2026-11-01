---
name: hotspot-focus-review
description: Review changed files matching the team's hotspot table for payment Reliability and Observability and booking Correctness using explicit path-scoped checks; skip unmatched paths and do not infer defects from historical finding counts.
license: Apache-2.0
metadata:
  author: Community
  variant: review
  version: 1.0.0
---

# Hotspot focus review

## Replace this table with your own hotspots

This is a TEMPLATE, not a claim about your repository or an analytics integration.
Read your Findings page and rule analytics, choose recurring path/category pairs,
and replace this table plus the corresponding rule rows below with your team's
actual hotspots. Keep rule IDs stable when semantics stay the same. Never invent
analytics counts or claim the reviewer queried the dashboard.

Patterns are repository-relative, case-sensitive path globs. Here ** includes
zero or more directories, so src/payments/** includes src/payments/charge.py.
A match focuses review; it does not establish a violation. An unmatched path has
no rule from this lens, and a matching path does not suppress other Qodo reviewers.

| Path glob | Qodo focus categories | Applicable rules |
|-----------|-----------------------|------------------|
| src/payments/** | Reliability, Observability | HOT-1, HOT-2, HOT-3, HOT-4 |
| src/booking/** | Correctness | HOT-5, HOT-6 |

## Complete rule index

There are four payment checks and two booking checks. Category labels use Qodo's
categories, not severity labels. Adapt these example checks alongside the table.

| ID | Path and category | Concrete check | Exceptions and required evidence |
|----|-------------------|----------------|----------------------------------|
| HOT-1 | src/payments/**; Reliability | A repeatable payment-creation call must send a stable idempotency key for the same logical operation across retries or request replays. Identify the creation call and replay path. A freshly random key on each attempt is not stable. | Do not flag read-only calls, an SDK with evidenced automatic stable keys or shown upstream deduplication that covers the operation. Do not assume a provider's parameter names; inspect the adapter contract. |
| HOT-2 | src/payments/**; Reliability | An explicit retry loop for transient payment failures must be bounded and delay successive attempts with backoff. Identify the transient error, attempt bound and delay path; an immediate retry loop violates this check. | Do not require retries for non-transient errors or add automatic retries to non-idempotent operations. Respect a shown SDK retry policy; do not layer retries blindly. No retry loop alone is not a violation. |
| HOT-3 | src/payments/**; Reliability | A reachable payment failure must not be swallowed and returned as success. Identify the exception path and success-shaped return; propagate a typed failure, raise or return an explicit failed result. | A catch that logs and rethrows or returns a caller-handled failure is valid. A documented best-effort side effect is not the primary payment operation. |
| HOT-4 | src/payments/**; Observability | A handled payment failure path needs a structured log carrying the operation's correlation_id and an error field or exception information, without credentials/card data. Cite the handler and available correlation value. | A shown centralized logger may supply correlation context; a caller that logs the propagated error once is valid. Do not demand duplicate logs or log sensitive payment details. With unavailable caller/wrapper context, mark coverage incomplete instead of asserting a missing log. |
| HOT-5 | src/booking/**; Correctness | Instants used to order bookings, compute expiry or compare across zones must be timezone-aware. Flag naive datetime.now/utcnow or parsing that discards an offset when a changed caller uses the result as an instant. Identify the comparison or persistence contract. | A local calendar date or wall-clock appointment awaiting an explicit zone is not necessarily an instant. date-only values are valid. For TS, Date represents an instant; do not call every Date naive. Check offset-less parsing only when cross-zone instant semantics are established. |
| HOT-6 | src/booking/**; Correctness | Money calculations or stored totals must use decimal arithmetic or integer minor units with an explicit currency scale, not binary float. Identify the monetary input, arithmetic and persisted/charged output. Construct Decimal from strings or exact integers, not a float. | Integer minor-unit APIs and exact Decimal arithmetic are valid. Display-only approximate charts are not stored or charged monetary totals. A TS number holding safe integer minor units is not automatically a violation. |

## Review contract

Diff-only, no execution. Read source context available to the reviewer; never run
tests, call payment providers, query analytics or claim observed runtime behavior.
Do not invent a missing helper's behavior. Only flag defects introduced by the diff.

Evaluate every rule, include a coverage summary, only rule-backed findings get rule IDs.
First map every changed file against every hotspot. Evaluate all matching checks;
record unmatched rules as not applicable, never apply payment rules to booking paths.
If patterns overlap, evaluate the union once per file and deduplicate a shared cause.
Historical frequency is a prioritization input, not evidence or severity inflation.

Each violation includes HOT-N, its exact rule clause, matching glob, focus category,
changed file and line, triggering path, confirming code and a concrete fix. A single
finding may cite multiple IDs only when each independently meets its preconditions.
Do not borrow a HOT ID for another check. Run the exception gate before reporting.

End with a rule-by-file coverage summary: evaluated, not applicable or unevaluated
with reasons, plus confirmed violation totals. Missing context belongs in coverage,
not in a rule-violation finding. Do not promise a custom rendered findings UI.
