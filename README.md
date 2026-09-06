# Unofficial Qodo Review Skills

Community-authored [agent skills](https://code.claude.com/docs/en/skills) shaped for
**Qodo Merge PR review**, the skills agent that discovers `SKILL.md` files in a repo and
emits review findings driven by their rules.

> **Unofficial.** Not affiliated with or endorsed by Qodo. These are community adaptations.

> **What you need to run them.** The skills themselves are Apache-2.0 and free to
> copy, adapt, and redistribute (see `LICENSE` and `NOTICE`). Acting on them is not:
> they are executed by Qodo's skills agent during PR review, which requires an active
> paid Qodo subscription on a plan that includes the skills agent. Check your plan
> before adopting these. Nothing here changes what your Qodo subscription covers.

These skills are **starting points**, adapted from existing open-source projects or built
for customer initiatives. Tune the rules to your codebase and conventions before relying on
them; any performance figures published by the upstream projects describe those projects,
not these adaptations.

## How Qodo's skills agent uses these

When enabled, the review pipeline scans these directories at a repo root:

```
.qodo/skills/  .claude/skills/  .cursor/skills/  .agents/skills/  skills/
```

For each `SKILL.md` it reads the frontmatter `description`, decides whether the skill is
relevant to the PR diff, and, for the ones that pass, applies the skill body's rules to
the changed code, citing the skill in each finding.

That means a review skill must:

- declare a `description` that reads as a **review lens** (so the relevance filter fires),
- contain **concrete, checkable rules** the agent can point at a diff span for,
- assume **no execution**, the agent sees a unified diff, not a live workspace.

## Available skills

| Skill | Purpose |
|-------|---------|
| [`terraform-review`](skills/terraform-review/SKILL.md) | Flags Terraform/OpenTofu diff issues: identity churn (missing `moved` blocks, `count` index churn), secrets that land in state, unsafe destroy/state ops, version-floor violations, backend antipatterns. Adapted from [antonbabenko/terraform-skill](https://github.com/antonbabenko/terraform-skill) (Apache-2.0). |
| [`apex-review`](skills/apex-review/SKILL.md) | Flags Salesforce Apex/SOQL diff issues: governor-limit killers (SOQL/DML in loops), missing CRUD/FLS & sharing enforcement, SOQL injection, hardcoded IDs, trigger anti-patterns. Rules derived from the [PMD Apex ruleset](https://github.com/pmd/pmd) (BSD-2). For *writing* SF code, see Salesforce's official [sf-skills](https://github.com/forcedotcom/sf-skills). |
| [`clang-format`](skills/clang-format/SKILL.md) | Reviews changed C/C++ formatting against the repository's committed `.clang-format`, cites stable local `CF-*` rule IDs and exact rule text, and does not claim formatter execution. Adapted from [Jamie-BitFlight/claude_skills](https://github.com/Jamie-BitFlight/claude_skills/tree/main/plugins/clang-format/skills/clang-format) (MIT). |
| [`linux-kernel-review`](skills/linux-kernel-review/SKILL.md) *(suite)* | Linux kernel patch review: one orchestrator plus eight lens skills covering change intent, execution flow, resource lifecycle, locking/concurrency, security, driver/hardware, per-subsystem invariants, and a false-positive/severity gate. Adapted from [Sashiko](https://github.com/sashiko-dev/sashiko)'s review protocol (Apache-2.0) and [masoncl/review-prompts](https://github.com/masoncl/review-prompts) (MIT). See below. |
| [`commit-message-review`](skills/commit-message-review/SKILL.md) | Verifies the commit message against the diff: claim/code mismatches, unmentioned user-visible behavior changes, vague messages on non-trivial diffs, implausible ticket references. |
| [`design-doc-conformance`](skills/design-doc-conformance/SKILL.md) | Checks the implementation against design documents committed in the repo (`docs/design*.md`, `docs/adr/*.md`) or a wired context repo: contradictions cited to the doc line, new public interfaces absent from the design. Stays silent when no docs exist. |
| [`appsec-compliance-review`](skills/appsec-compliance-review/SKILL.md) | Enforces an organization's written AppSec policy on changed application code: authentication/authorization on sensitive endpoints, injection, SSRF, debug/test code reachable in production, hardcoded secrets. Reports per-rule coverage so an unevaluated rule is never a silent skip. Template: swap the five rules for your own and keep the review contract. |

### The `linux-kernel-review` suite

Nine skills that work together. The orchestrator routes a kernel diff through the lenses;
`kernel-review-discipline` is always applied last as the false-positive gate.

| Skill | Sashiko stage | Lens |
|-------|---------------|------|
| [`linux-kernel-review`](skills/linux-kernel-review/SKILL.md) | orchestration | Router + shared low-noise contract |
| [`kernel-change-intent`](skills/kernel-change-intent/SKILL.md) | 1-2 | Design soundness, UAPI breakage, commit-message-vs-code |
| [`kernel-execution-flow`](skills/kernel-execution-flow/SKILL.md) | 3 | Control flow, error paths, NULL, uninitialized values |
| [`kernel-resource-lifecycle`](skills/kernel-resource-lifecycle/SKILL.md) | 4 | Leaks, UAF, refcounts, async teardown symmetry |
| [`kernel-locking-concurrency`](skills/kernel-locking-concurrency/SKILL.md) | 5 | Races, deadlocks, RCU, barriers (findings must name both racing contexts) |
| [`kernel-security-audit`](skills/kernel-security-audit/SKILL.md) | 6 | OOB, integer overflow, TOCTOU, info leaks, privesc |
| [`kernel-driver-hardware`](skills/kernel-driver-hardware/SKILL.md) | 7 | Registers, DMA, barriers, IRQ, device state machines |
| [`kernel-subsystem-guides`](skills/kernel-subsystem-guides/SKILL.md) | shared context | Trigger table → 67 per-subsystem invariant guides ([masoncl/review-prompts](https://github.com/masoncl/review-prompts), MIT) |
| [`kernel-review-discipline`](skills/kernel-review-discipline/SKILL.md) | 9-10 | False-positive gate + severity calibration, **always applied last** |

Sashiko's stages 8 and 11 (dedup, LKML report rendering) are pipeline mechanics that the
Qodo platform performs natively, so only their reasoning rules were kept. Kernel severity
maps to the Qodo contract as Critical/High → `action_required`, Medium →
`remediation_recommended`, Low → `informational`.

For the full kernel suite, copy **all nine** `linux-kernel-review`/`kernel-*` folders, the
orchestrator and discipline gate assume the lenses are present. Eval fixtures (a buggy vs
fixed demo driver with expected findings) live in
[`skills/linux-kernel-review/evals/`](skills/linux-kernel-review/evals/).

## Workflow skills (agent chores, not review lenses)

These run in your coding agent (Claude Code, Qodo Command) as tasks, not in the review pipeline:

| Skill | Purpose |
|-------|---------|
| [`guideline-distiller`](skills/guideline-distiller/SKILL.md) | Turns a prose style guide or team-conventions doc into atomic, enforceable review rules (one detectable violation per rule), flags conflicting/identical/overlapping rules, and quarantines aspirational prose for human review. |
| [`toml-portal-migration-audit`](skills/toml-portal-migration-audit/SKILL.md) | Audits a repo's `.pr_agent.toml` against a portal-managed settings map and proposes a removal-only diff so the portal becomes the single source of truth. Unknown keys are marked for deploy-team confirmation, never guessed. |
| [`qodo-calibrate-rules`](skills/qodo-calibrate-rules/SKILL.md) | Calibrates the severity of every active Qodo rule in a workspace as one reviewable, reversible batch: exports the rules through the Qodo CLI, proposes a severity per rule from an editable rubric (13 taxonomy tags plus a keyword guard that blocks silent demotion of security/data rules), hands the admin a checklist or browser page to approve, skip, or override each row, applies only the approved rows, re-reads the workspace to verify, and can revert the whole run from its receipt. Fixes the common noise source of imported rules defaulting to `error`. Requires the Qodo CLI (logged in, workspace admin) and Node 20+, no npm install. Self-tests: `node --test 'skills/qodo-calibrate-rules/scripts/test/*.test.mjs'`. Authored by Jonathan Klick (Qodo), MIT, vendored at 0.8.0. |

## Usage

Drop a skill folder into one of the scanned directories of the repo you want reviewed , 
e.g. copy `skills/terraform-review/` into your project's `skills/` (or `.qodo/skills/`).
The Qodo skills agent discovers it on the next review.

```bash
# from the repo you want reviewed
git clone https://github.com/gvago/unofficial-qodo-review-skills /tmp/uqrs
cp -R /tmp/uqrs/skills/terraform-review skills/terraform-review
```

## Attribution

`terraform-review` is a PR-review adaptation of
[**terraform-skill**](https://github.com/antonbabenko/terraform-skill) by
**Anton Babenko** (Apache-2.0). The original is a *coding* skill; this variant flips the
contract and rule framing toward *reviewing a diff*. Reference files under
`skills/terraform-review/references/` are reproduced from the source under the same license.

`clang-format` is a PR-review adaptation of the
[**clang-format skill**](https://github.com/Jamie-BitFlight/claude_skills/tree/main/plugins/clang-format/skills/clang-format)
by **Jamie-BitFlight** (MIT). It converts the original configuration and tooling workflow
into a diff-only Qodo review lens. Bundled reference and template files are reproduced under
the upstream MIT license.

The `linux-kernel-review` suite adapts the review protocol of
[**Sashiko**](https://github.com/sashiko-dev/sashiko) (Linux Foundation, Apache-2.0) , 
its 11 reviewer-persona stages repackaged as diff-review skills. The subsystem guides and
discipline references are reproduced from
[**masoncl/review-prompts**](https://github.com/masoncl/review-prompts) by
**Chris Mason** (MIT, see [THIRD_PARTY_LICENSE-masoncl-review-prompts](THIRD_PARTY_LICENSE-masoncl-review-prompts)).
Sashiko's Rust infrastructure (lore/NNTP ingestion, worktrees, webhooks, UI) was deliberately
not converted, the Qodo platform provides ingestion, consolidation, and rendering.

`qodo-calibrate-rules` is vendored from
[**qodo-calibrate-rules**](https://github.com/qodo-se/qodo-calibrate-rules) by
**Jonathan Klick** (MIT, see [skills/qodo-calibrate-rules/LICENSE](skills/qodo-calibrate-rules/LICENSE)),
upstream `main` at 305215e plus the test fix proposed in
[qodo-se/qodo-calibrate-rules#5](https://github.com/qodo-se/qodo-calibrate-rules/pull/5).

## License

[Apache License 2.0](LICENSE).
