---
name: kernel-driver-hardware
description: "Use when a Linux kernel PR diff touches driver hardware interaction \u2014 register access, DMA mapping, memory barriers, IRQ handlers, device power/state machines (Sashiko stage 7). Skip for purely generic software logic (VFS, core networking). Part of the linux-kernel-review suite."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# kernel-driver-hardware

Lens for hardware-facing driver review (Sashiko stage 7). A hardware
engineer's read of register access, DMA, and device state machines. If the
diff is purely generic software logic (VFS, core networking), this lens
returns no findings — say so and stop.

## How to apply

- Establish the device state machine implied by the driver: probe, open,
  start, stop, reset, suspend/resume, remove. Every hardware touch must be
  legal in the state where it happens.
- Verify ordering guarantees explicitly; never assume the compiler or bus
  preserves your intended order without a barrier.

## Rule index

- H1. Register access legality: clocks and power domains enabled before
  registers are touched; no MMIO after reset/suspend has torn state down.
- H2. DMA correctness: every dma_map has a matching unmap on all paths;
  missing dma_wmb()/dma_rmb() between descriptor writes and doorbell;
  unsafe DMA buffer allocation (stack buffers, unaligned).
- H3. Endianness: missing or double cpu_to_le32/be conversions on
  hardware-shared structures.
- H4. IRQ handling: handlers touching state that is freed or reset
  concurrently; missing synchronize_irq before teardown; enabling IRQs
  before the handler's data is ready.
- H5. Ring/queue state: hardware rings accessed before initialization in
  the current hardware state; producer/consumer index math on wrap.
- H6. Timing: missing required delays after reset/power transitions;
  busy-wait loops without timeout.

## Mapping a finding to the contract

- action_level: action_required for state-machine violations, missing
  barriers on DMA paths, or IRQ/teardown races; remediation_recommended for
  missing timeouts on unlikely-stuck waits.
- category: Correctness.
- evidence: the register/DMA/IRQ operation, the device state at that point,
  and why the ordering or state is wrong. Cite the datasheet constraint
  only as stated in the code/comments — do not invent hardware behavior.

## What NOT to flag

- Generic software logic — return no findings for non-hardware diffs.
- Barrier "hardening" where existing locks already order the accesses.
- Delay-length tuning without evidence the current value fails.

## Sourcing

Stage text adapted from Sashiko (Apache-2.0). For driver-subsystem
specifics (i2c, hid, tty, pci, ata...), kernel-subsystem-guides carries the
per-subsystem invariant files.
