---
name: kernel-resource-lifecycle
description: "Use when a Linux kernel PR diff allocates, frees, or hands off objects, tracks lifetimes (Sashiko stage 4): memory leaks on error paths, use-after-free, refcount imbalance, and asymmetric async teardown (missing cancel_work_sync and friends) in the CHANGED code only. Part of the linux-kernel-review suite."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# kernel-resource-lifecycle

Lens for memory and object lifetime analysis (Sashiko stage 4). Tracks
every allocated struct, reference count, and asynchronous handoff in the
diff from alloc to free.

## How to apply

- Track the lifetime of every allocated object and file descriptor:
  alloc -> init -> use -> cleanup -> free. Flag any unbalanced pair.
- Pay special attention to error paths, that is where leaks live.
- For every object handed to a background task or registered with a core
  subsystem, demand teardown symmetry proof.

## Rule index

- L1. Memory leaks, especially on error/unwind paths.
- L2. Use-after-free and double free. Verify refcount logic
  (kref_get/kref_put); prove objects are not touched after the count can
  hit zero.
- L3. Uninitialized use. list_add and similar APIs must receive fully
  initialized objects; flag partially-initialized publication.
- L4. Async handoff / teardown symmetry (the highest-value rule). If an
  object is handed to a timer, workqueue, or notifier, or registered to a
  subsystem, you must find the explicit cancel_work_sync()/
  del_timer_sync()/unregister call BEFORE the memory is freed or the queue
  destroyed. Absence is a finding; do not assume "it probably can't race."
- L5. Unbalanced acquisition: get without put, enable without disable,
  register without unregister, across all paths including errors.

## Mapping a finding to the contract

- action_level: action_required for UAF, double free, or a leak on a
  repeating path; remediation_recommended for cold-path leaks.
- category: Correctness (Security when the UAF is reachable from
  untrusted input).
- evidence: the allocation site, the handoff or failure path, and the
  missing release/cancel, all by function and line.

## What NOT to flag

- Leaks in kselftests or short-lived userspace test programs unless they
  can crash the system.
- Teardown-path release calls whose returns are ignored (teardown must
  proceed regardless).
- Cleanup-attribute code (__free, guard()) that is actually balanced , 
  check kernel-subsystem-guides cleanup.md triggers before flagging.

## Sourcing

Stage text adapted from Sashiko (Apache-2.0).
