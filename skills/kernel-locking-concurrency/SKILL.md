---
name: kernel-locking-concurrency
description: "Use when a Linux kernel PR diff touches locks, atomics, RCU, IRQs, or deferred work \u2014 concurrency audit (Sashiko stage 5): races, deadlocks, lock-context violations, missing barriers, RCU misuse. Every finding must name the two racing contexts. Part of the linux-kernel-review suite."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# kernel-locking-concurrency

Lens for locking and synchronization audit (Sashiko stage 5). World-class
concurrency review of the diff. This is the noisiest domain in kernel
review — every finding must name the two racing contexts.

## How to apply

- Identify every lock, RCU section, and lockless access the diff touches.
- For each concern, name context A, context B, and the interleaving that
  breaks. If you cannot construct the interleaving, route the concern to
  kernel-review-discipline as speculative.
- Load references/locking.md for the full invariant catalog before deep
  analysis; references/rcu.md whenever call_rcu/synchronize_rcu/kfree_rcu
  or RCU list ops appear.

## Rule index

- C1. Sleeping in atomic context: mutex_lock, GFP_KERNEL allocation,
  msleep, cond_resched, flush_workqueue, synchronize_rcu, cancel_work_sync
  under a spinlock, rwlock, or rcu_read_lock.
- C2. Lock ordering and deadlock: AB-BA orders, acquiring a lock already
  held by a higher layer (e.g. ethtool), missing _irqsave when the lock is
  taken in hardirq context.
- C3. Races and lockless access: shared state touched without the owning
  lock, missing smp_mb/smp_wmb/smp_rmb where lockless access is intended,
  TOCTOU where state is checked outside the lock and relied on inside.
- C4. Locking freed memory: unlock on freed objects; works/timers destroyed
  after the subsystem that can still schedule them is gone; "initialized"
  flags set before private data is ready.
- C5. RCU rules: non-RCU-safe ops (list_splice_init) on RCU-protected
  lists; list_for_each_rcu without rcu_read_lock; removal-vs-call_rcu
  ordering (see references/rcu.md).
- C6. Unprotected state modification: state checked before lock
  acquisition, hardware state/flags/stats updated without protection.
- C7. Sequence counters: double counting inside u64_stats_fetch_retry
  loops; interrupt reading a seqcount its own interrupted context writes.
- C8. Lock lifecycle: re-initializing a live lock; destroying a lock on a
  failure path other paths still use.
- C9. Missing locking on publication: a port/file exposed to userspace
  before linking completes; a worker racing cleanup.

## Mapping a finding to the contract

- action_level: action_required for a constructed deadlock, sleep-in-atomic,
  or race with memory corruption; remediation_recommended for inefficient
  but correct locking.
- category: Correctness (Security if the race is user-triggerable).
- evidence: both contexts, the shared object, the interleaving, lines.

## What NOT to flag

- READ_ONCE absence when the data is protected by a lock currently held.
- Races that existing memory barriers or lock coverage already close —
  read references/locking.md before asserting a barrier is missing.
- Theoretical races with no constructible interleaving.

## References (load only when needed)

- references/locking.md — full locking invariant catalog (512 lines).
- references/rcu.md — RCU lifecycle and list rules.

## Sourcing

Stage text adapted from Sashiko (Apache-2.0). References reproduced from
masoncl/review-prompts (MIT).
