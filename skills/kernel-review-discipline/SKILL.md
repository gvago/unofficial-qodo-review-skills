---
name: kernel-review-discipline
description: "ALWAYS apply last when any linux-kernel-review suite lens produced candidate findings on a Linux kernel PR diff, the false-positive gate and severity calibration (Sashiko stages 9-10): prove-it-or-drop-it verification, conflict resolution, kernel severity mapped to the Qodo action contract. The noise killer for the suite."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# kernel-review-discipline

The quality gate every candidate finding must pass (Sashiko stages 9-10:
conflict resolution, verification, severity). ALWAYS apply this lens last,
to the merged concern list from all other lenses. This is where Sashiko
kills its false positives; it is the most important skill in the set.

## Core principle

If you cannot prove an issue exists with concrete evidence, do not report
it. For deadlocks, infinite waits, crashes, and corruption, "concrete
evidence" means proving the code path is structurally possible, not that
it fires on every run. Do not dismiss such bugs as "unlikely in practice."

## The gate, in order

1. Dedup and merge (Sashiko stage 8). Group concerns sharing a root cause
   or line; merge complementary reasoning. Never generalize a specific
   finding into a vague category, keep the most specific details.
2. Conflict resolution (stage 9). Where one lens raised a concern and
   another dismissed the same candidate, treat both as untrusted hypotheses
   and re-verify against the code. Discard the concern only when the
   dismissal's evidence concretely disproves it. LOCAL BOUNDARY RULE: never
   discard a defect in the patch's own code by assuming callers, parallel
   code, or legacy layers mask it, unless you can cite the specific code
   that makes the failure structurally impossible.
3. False-positive check (stage 10). Run every survivor through
   references/false-positive-guide.md. To discard, you MUST find concrete
   proof that invalidates the concern's reasoning; inability to confirm is
   not grounds to drop. Follow every section; complete task POSITIVE.1.
4. Pre-existing filter. If the bug predates the patch, say so explicitly.
   Report pre-existing issues only at high/critical severity; discard
   pre-existing low/medium.
5. Severity calibration. Use references/severity.md. Reason consequence ->
   triggering path -> reachability, and open the severity explanation with
   that reasoning so the label is auditable. Untrusted/remote reachability
   raises the level; believed unreachability never lowers it. A finding you
   can only state speculatively is capped at Medium but still reported,
   never dropped, the only reason a level ever goes down.

## Specificity requirement (Sashiko stage 10 rule 7)

Every finding MUST cite exact function name(s), file path(s), line numbers
when known, and triggering conditions. "Potential overflow in ring buffer
calculations" is insufficient, state which variable overflows, in which
function, under what input. Never invent line numbers; use the nearest
verified symbol when the line is unknown.

## Mapping severity to the Qodo contract

| Kernel severity (severity.md) | action_level |
|---|---|
| Critical / High | action_required |
| Medium | remediation_recommended |
| Low | informational (usually: do not report) |

## References (load only when needed)

- references/false-positive-guide.md, the full proof protocol (495 lines).
- references/severity.md, level definitions, calibration questions.

## Sourcing

Stage text adapted from Sashiko (Apache-2.0). References reproduced from
masoncl/review-prompts (MIT).
