---
name: linux-kernel-review
description: "Use when a PR diff modifies Linux kernel code (C or Rust in a kernel tree: drivers/, fs/, mm/, net/, kernel/, block/, include/linux/, arch/), orchestrator for the kernel review suite: routes the diff through the kernel-* lenses, enforces the shared low-noise contract (prove it against the code, diff-scope only, few high-value findings). Skip for non-kernel diffs."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# linux-kernel-review

Orchestrator for agentic Linux kernel patch review. Converts the Sashiko
multi-stage review protocol (sashiko-dev/sashiko) into Qodo skills. It runs
no tools. It routes a kernel diff through specialized review lenses and
enforces the shared discipline that keeps noise down.

## How to apply

- Review the diff, not the whole tree. Judge changed lines plus the context
  needed to prove or disprove a concern.
- Reason statically. You cannot build or run the code.
- Assume the patch has bugs, including in its commit message and comments.
  Every claim must be proven correct against the code.
- Prefer a few proven, high-value findings. Noise is the failure mode.

## Lens routing (the Sashiko stages, as skills)

Apply every lens whose scope the diff touches. A patch can match several.

| Lens skill | Sashiko stage | Scope |
|---|---|---|
| kernel-change-intent | 1-2 | Goal, architecture, UAPI, claim-vs-code verification |
| kernel-execution-flow | 3 | Control flow, error paths, NULL derefs, off-by-one |
| kernel-resource-lifecycle | 4 | Leaks, UAF, double free, refcounts, async teardown |
| kernel-locking-concurrency | 5 | Deadlocks, atomic-context sleeps, RCU, races |
| kernel-security-audit | 6 | OOB, integer overflow, TOCTOU, info leaks |
| kernel-driver-hardware | 7 | Registers, DMA, barriers, IRQ, suspend/resume |
| kernel-subsystem-guides | context | Per-subsystem invariants, loaded by trigger table |
| kernel-review-discipline | 9-10 | False-positive gate, severity, specificity, ALWAYS |

Sashiko stages 8 (dedup), 9 (conflict resolution), and 11 (report format)
are pipeline mechanics; the Qodo platform consolidates and renders findings.
Their reasoning rules survive inside kernel-review-discipline.

## Review order

1. Load kernel-subsystem-guides and match the diff against its trigger
   table. Load every matching guide before analysis.
2. Apply each in-scope lens to the diff. Collect candidate concerns.
3. Pass every candidate through kernel-review-discipline: prove it or drop
   it, then calibrate severity. Only survivors become findings.

## Mapping a finding to the contract

- action_level: action_required for a proven correctness, memory-safety,
  locking, or security defect; remediation_recommended for a weaker or
  speculative case; informational for a note.
- category: Security, Correctness, or Maintainability.
- evidence: cite file, function, exact line when known, the triggering
  condition, and the lens rule id. Never invent line numbers.

## What NOT to flag

- Style, naming, formatting, typos in comments (checkpatch territory).
- Defensive checks you cannot prove are reachable with bad data.
- Ignored returns from calls that cannot fail, or from debugfs APIs.
- Pre-existing low/medium issues not introduced by this patch.
- Removal of assertions/WARN/BUG as a regression.

## Sourcing

Protocol derived from Sashiko (Apache-2.0, sashiko-dev/sashiko) and Chris
Mason's review-prompts (MIT, masoncl/review-prompts). Reference files under
the lens skills reproduce masoncl content under its MIT license.
