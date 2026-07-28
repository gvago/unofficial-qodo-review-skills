---
name: kernel-change-intent
description: "Use when reviewing a Linux kernel PR diff, verifies commit goal and implementation claims (Sashiko stages 1-2): design soundness, UAPI/ABI breakage, and commit-message-vs-code mismatches in the CHANGED code only. Part of the linux-kernel-review suite."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# kernel-change-intent

Lens for commit goal and implementation-claim verification (Sashiko stages
1-2). Runs no tools. Judges whether the change's concept is sound and
whether the code actually does what the commit message claims.

## How to apply

- Read the commit message first, then verify every claim against the diff.
  Do not trust the message; assume it may be wrong or even intentionally
  misleading.
- Question assumptions. Consider simpler alternative designs.
- Judge changed lines and their direct blast radius only.

## Rule index

- I1. Architectural soundness. Flag fundamentally flawed concepts,
  long-term maintainability hazards, and violations of established kernel
  design principles. Consider system-wide implications.
- I2. UAPI and backwards compatibility. Any UAPI breakage or ABI change
  without proper deprecation is action_required (Critical-class).
- I3. Claim-vs-code match. Every claim in the commit message must be fully
  realized in the diff. Flag missing pieces: a core change without updating
  corresponding callers, a struct change without updating all initializers,
  incomplete implementations, undocumented side-effects.
- I4. API contract completeness. When defining or modifying structures
  containing function pointers, verify all logically required callbacks are
  implemented. Check for interface omissions.
- I5. Semantic soundness of arguments. Verify arguments passed to external
  subsystems (kobjects, netdevs, etc.) are valid and semantically correct:
  non-empty strings, correct sizes, correct format specifiers, correct
  bitwise operations, sound bounds math.

## Mapping a finding to the contract

- action_level: action_required for UAPI breakage or a proven
  claim/code mismatch that changes behavior; remediation_recommended for
  maintainability or design concerns.
- category: Correctness for mismatches, Maintainability for design.
- evidence: quote the commit-message claim and cite the code that
  contradicts or fails to implement it.

## What NOT to flag

- Low-level memory or locking errors, other lenses own those.
- Stylistic disagreement with a design that violates no kernel principle.
- Commit message wording nits with no code impact.

## Sourcing

Stage text adapted from Sashiko (Apache-2.0). No reference files needed;
this lens is pure reasoning.
