---
name: kernel-execution-flow
description: "Use when a Linux kernel PR diff changes C/Rust control flow \u2014 traces execution statically (Sashiko stage 3): broken error paths, NULL derefs, uninitialized or stale values, off-by-one loop logic, preprocessor/linkage hazards in the CHANGED code only. Part of the linux-kernel-review suite."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# kernel-execution-flow

Lens for control-flow and logic verification (Sashiko stage 3). Acts as a
static analysis engine tracing C (or Rust) execution flow through the diff.

## How to apply

- Trace every branch, switch, loop, and goto in the changed code.
- Explore every error handling path (goto cleanup;) and prove it behaves
  correctly under failure.
- Never make assumptions from return types, comments, WARN_ON/BUG_ON, or
  error-handling patterns — verify by tracing concrete execution paths.
  Full tracing discipline: references/technical-patterns.md.
- For deadlock/infinite-wait/crash candidates, prove the path is
  structurally possible — not that it fires every run. Method:
  references/callstack.md.

## Rule index

- F1. Logic errors: incorrect loop conditions, inverted tests, off-by-one
  in bounds, wrong operator precedence.
- F2. Unhandled error paths and missing return-value checks. Checking
  returns of allocation, init, locking, and resource-management calls is a
  mandatory kernel API contract, not defensive programming. Exceptions:
  __init/early-boot code, debugfs APIs, teardown paths, explicit (void)
  casts with sound justification.
- F3. NULL pointer dereference. Reading a pointer field is not a
  dereference; only accessing its contents is. Prove the NULL can reach the
  access.
- F4. Preprocessor and linkage correctness: CONFIG_ prefix misspellings
  (e.g. HAVE_ where CONFIG_ was intended), #ifdef branch divergence,
  static/inline or section placement that breaks linking or loses symbols
  under LTO.

## Mapping a finding to the contract

- action_level: action_required for a proven logic error or mandatory
  unchecked return on a real path; remediation_recommended when the failure
  path is real but consequence is contained.
- category: Correctness.
- evidence: the traced path — caller, condition values, and the line where
  behavior diverges from intent.

## What NOT to flag

- Errors impossible in the call path found (e.g. guarded by IS_ENABLED
  upstream). Prove reachability before reporting.
- Defensive bounds checks without a proven untrusted source.
- likely()/unlikely() hint changes with no logic impact.

## References (load only when needed)

- references/technical-patterns.md — core kernel tracing rules, context
  rules, error-handling notes, RCU mandatory check.
- references/callstack.md — blocking/waiting bug analysis protocol.

## Sourcing

Stage text adapted from Sashiko (Apache-2.0). References reproduced from
masoncl/review-prompts (MIT).
