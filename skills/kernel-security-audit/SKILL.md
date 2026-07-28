---
name: kernel-security-audit
description: "Use when a Linux kernel PR diff handles untrusted input (copy_from_user, get_user, ioctl args, netlink attrs, network or firmware data) \u2014 security lens (Sashiko stage 6): OOB access, integer overflow, TOCTOU, info leaks to userspace, privilege escalation in the CHANGED code only. Part of the linux-kernel-review suite."
license: Apache-2.0
metadata:
  author: Sashiko contributors / Chris Mason
  adapted_by: gvago
  source: https://github.com/sashiko-dev/sashiko (Apache-2.0), references from masoncl/review-prompts (MIT)
  variant: review
  version: 1.0.0
---

# kernel-security-audit

Lens for security review of a kernel patch (Sashiko stage 6). Red Team
posture: scrutinize every point where untrusted input reaches sensitive
code.

## How to apply

- Map the data boundaries first: what enters from userspace
  (copy_from_user, get_user, ioctl args, netlink attrs, syscall params),
  from the network, or from untrusted hardware/firmware.
- Follow each untrusted value to every use. A missing or weak validation
  between entry and use is the finding.
- Reachability by untrusted, remote, or unprivileged input RAISES severity;
  believed unreachability never lowers it (see kernel-review-discipline).

## Rule index

- S1. Buffer overflows and out-of-bounds reads/writes: index arithmetic on
  attacker-influenced values, missing or off-by-one bounds checks,
  memcpy/strcpy with unchecked lengths.
- S2. Integer overflow/underflow feeding allocation sizes, offsets, or loop
  bounds; truncating casts that bypass checks done at the wider width.
- S3. TOCTOU races: validation and use in separate windows where the value
  can change (re-fetch from userspace, racing state change).
- S4. Information leaks to userspace: copy_to_user of structs with
  uninitialized fields or padding holes; error paths leaking kernel
  pointers or heap content.
- S5. Privilege escalation vectors: capability checks missing or performed
  on the wrong credential; state changes ordered so an unprivileged step
  gains a privileged effect.

## Mapping a finding to the contract

- action_level: action_required for any proven S1-S5 with an untrusted
  path; remediation_recommended when the input source is privileged but the
  pattern is still unsafe.
- category: Security.
- evidence: entry point of the untrusted value, the propagation chain, the
  unsafe use — functions and lines. State the attacker precondition.

## What NOT to flag

- Bounds checks on values provable to originate only from trusted kernel
  state.
- Constructs that look unsafe but sit behind capability checks you can
  cite — cite them and dismiss instead.
- Hardening suggestions (e.g. "use strscpy everywhere") without a proven
  vulnerable path.

## Sourcing

Stage text adapted from Sashiko (Apache-2.0).
