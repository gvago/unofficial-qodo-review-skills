---
name: terraform-review
description: Use when a PR diff adds or modifies Terraform/OpenTofu (.tf / .tofu / .tftest.hcl), flags identity churn (missing `moved` blocks, `count` index churn), secrets that land in state, unsafe destroy/state ops, version-floor violations, and backend/state antipatterns in the CHANGED HCL only. Skip for non-IaC diffs.
license: Apache-2.0
metadata:
  author: Anton Babenko
  adapted_by: PR Agent Pro Team
  source: https://github.com/antonbabenko/terraform-skill (terraform-skill v1.17.1)
  variant: review
  version: 1.0.0
---

# Terraform Review Skill

Review lens for Terraform/OpenTofu changes in a pull request. Every rule below is a
**concrete violation you can point at in the diff**, not a generation workflow.

This is the review-oriented adaptation of Anton Babenko's `terraform-skill` (a coding
skill). The diagnostic categories and the version-floor knowledge are his; the contract,
stance, and rule framing have been flipped from "produce correct HCL" to "flag incorrect
HCL in a diff."

## How to apply this skill (read first)

You are reviewing a **unified diff**, not a live workspace. Therefore:

- **You cannot run anything.** No `terraform validate`, `plan`, `init`, `fmt`, or
  terraform-ls. Do not emit a finding whose justification is "run X to confirm." Judge
  from the changed lines alone.
- **Findings apply to the diff, not the repo.** Only flag HCL that was *added or modified*
  in this PR. Unchanged surrounding code is out of scope.
- **Every finding must trace to a rule below.** If you cannot point to a specific rule in
  this file that the changed HCL violates, drop it, the generic "issues" agent handles
  ordinary bugs. This skill only fires on the Terraform-specific rules enumerated here.
- **Determine the runtime floor from the diff when possible.** Read `required_version` in
  `versions.tf` / `terraform {}` blocks if the PR touches them; otherwise treat the floor
  as unknown and prefer `remediation_recommended` for version-gated rules rather than
  asserting a hard violation.

## Mapping a finding to the SkillsFinding contract

When you emit a finding, set the fields the review pipeline expects:

| This skill's severity | `action_level` | `category` (typical) |
|-----------------------|----------------|----------------------|
| **Blocking**, clear, harmful, will break or leak | `action_required` | `Security` or `Correctness` |
| **Recommended**, likely wrong but context-dependent | `remediation_recommended` | `Correctness` / `Maintainability` |
| **Optional**, maintainability nudge | `informational` | `Maintainability` |

Each finding's `evidence.citations` MUST include a `SkillCitation` with
`source = "terraform-review"`. Put the offending span in `diff_pointer`. Give a concrete
`fix_suggestion` (the **Fix** line of each rule is your starting point).

---

## Rule set

Rules are grouped by failure category. Each rule = **what to flag in the diff →
severity → why → fix.**

### 1. Identity churn (resource addresses)

- **Refactor that renames a resource/module address with no `moved` block in the same diff.**
  → **Blocking** (Correctness). Renaming an address without `moved` turns the change into
  destroy + recreate. Fix: add a `moved { from = ... to = ... }` block in the same PR; a
  rename should plan as a move, not a replacement.
- **`for_each` keys built from values not known until apply** (e.g. keyed off a computed
  resource ID/ARN). → **Blocking** (Correctness). Planning fails, keys must be known at
  plan time. Fix: key off input variables or business-meaningful static values.
- **`count` introduced for a collection where elements may be reordered/removed**, or
  `count.index` used as long-lived identity. → **Recommended** (Correctness). Removing a
  middle element reshuffles every later address. Fix: use `for_each = toset(...)` / a map
  with stable keys.
- **`moved` block left inside a module that is itself being removed in the same diff.**
  → **Blocking** (Correctness). The moves silently no-op and the resources get destroyed.
  Fix: handle the migration before/separately from the module removal.
- **`moved` block whose `from`/`to` crosses a provider boundary.** → **Recommended**
  (Correctness). `moved` cannot cross providers. Fix: use `import`/`removed` as appropriate.
- **`terraform state mv` suggested in scripts/docs** where a declarative `moved` block
  would be reviewable. → **Recommended** (Maintainability). Fix: prefer `moved` blocks.

### 2. Secret exposure (the big one, state is not safe just because it's masked)

- **`sensitive = true` added to a variable/output and treated as keeping the value out of
  state.** → **Blocking** (Security). `sensitive` only masks *display*; the value still
  lives in state. Fix: on 1.11+ use `write_only` / `*_wo` arguments; otherwise source from
  a cloud secret manager at runtime. Keep secret material out of Terraform inputs entirely.
- **`nonsensitive()` used to "unwrap" a sensitive value into plan output / an output.**
  → **Blocking** (Security). This launders secrets into plan artifacts and CI logs. Fix:
  remove the `nonsensitive()`; do not surface the secret.
- **Plaintext secret as a `variable` default, or committed in `*.tfvars`** ("for demo"
  counts). → **Blocking** (Security). Fix: remove; reference a secret manager / env var.
- **Outputs exposing full connection strings or credentials**, even when marked
  `sensitive`. → **Blocking** (Security). Fix: expose only non-secret identifiers.
- **`password_wo` (or other `*_wo`) paired with a data source that still reads the secret
  into state on refresh** (e.g. `aws_secretsmanager_secret_version.secret_string`).
  → **Blocking** (Security). The write-only arg helps the resource, but the data source
  re-reads it. Fix: use an `ephemeral` resource (1.10+) or a CI-injected env var.
- **Secrets echoed through `provisioner` / `local-exec` stdout.** → **Blocking** (Security).
  Leaks into CI logs. Fix: don't pass secrets through provisioner commands.
- **A compliance framework named (SOC 2 / PCI / HIPAA / GDPR / FedRAMP) with no enforceable
  gate** added (no policy stage, approval, or evidence artifact). → **Recommended**
  (Security). Fix: add the actual control, not just the claim. Note data-residency for
  GDPR/FedRAMP. (Encrypted ≠ audit evidence.)

### 3. Destroy & state safety

- **`-auto-approve` on a destroy**, or a targeted `destroy` in scripts/CI with no
  `plan -destroy` shown first. → **Blocking** (Correctness). Locals referencing a targeted
  resource pull all its `for_each` consumers in as implicit dependents, destroy deletes
  more than expected. Fix: require a reviewed `plan -destroy` artifact + explicit approval;
  never `-auto-approve` a destroy.
- **Production apply that re-runs `plan` inside the apply job** instead of applying the
  reviewed plan artifact. → **Recommended** (Correctness). Fix: apply the saved
  `plan -out` artifact from the plan stage.
- **`*.tfstate` (or `.tfstate.backup`) added to the diff / not git-ignored.** → **Blocking**
  (Security). Fix: remove from VCS, add to `.gitignore`, move to a remote backend.
- **Local state introduced/kept for a team/production config** (no `backend` block, or
  `backend "local"`). → **Blocking** (Security). Fix: use a remote backend (locking,
  encryption, versioning, audit).
- **`rm .terraform.tfstate.lock.info` / `force-unlock` added without cause.** → **Recommended**
  (Correctness). Fix: investigate why the lock exists first; don't blanket force-unlock.
- **Manual edits to `terraform.tfstate`.** → **Blocking** (Correctness). Fix: use
  `terraform state mv/rm/import` (or `moved`/`import` blocks).
- **Prod and non-prod sharing one backend key**, or one monolithic root state. →
  **Recommended** (Security/Maintainability). Fix: separate backend keys per environment;
  split by component at true ownership boundaries.
- **DynamoDB lock table configured on Terraform ≥ 1.10** instead of `use_lockfile = true`
  on the S3 backend. → **Recommended** (Maintainability). Fix: prefer native S3 lockfile on
  1.10+.
- **`terraform_remote_state` used within a single team's own stack** to read values that are
  available as module outputs. → **Recommended** (Maintainability). Fix: pass via module
  outputs; reserve `terraform_remote_state` for true ownership boundaries.
- **Destructive state op with no rollback/recovery note** in the PR. → **Recommended**
  (Maintainability). Fix: document how to undo and what evidence to keep.

### 4. Version-floor guards (the crown jewel)

A feature used below its runtime floor will break; the right-hand column is the classic
mistake. **If the diff uses a feature but the PR's `required_version` floor is below the
minimum (or the floor is unknown and the feature is recent), flag it.** Severity is
**Blocking** when the floor is demonstrably too low, otherwise **Recommended**.

| Feature | Min version | Anti-pattern to flag in the diff |
|---------|-------------|----------------------------------|
| `for_each` over `count` for stable identities | 0.12+ | `count` used for a collection where identity matters → index churn |
| `try()` | 0.12.20+ | `element(concat(...))` legacy fallback instead of `try()` |
| `nonsensitive()` | 0.15+ | used to unwrap a sensitive value into plan output (secret laundering) |
| `nullable = false` | 1.1+ | omitted, letting `null` silently override a default |
| `moved` blocks | 1.1+ | omitted during rename → destroy/create |
| `optional()` with defaults | 1.3+ | wrapper variables / loose `map(any)` contracts instead |
| declarative `import` blocks | 1.5+ | ad-hoc CLI `terraform import` in automation instead |
| `check` blocks | 1.5+ | `check` used expecting it to **gate** apply, it is advisory (warnings only). Use `precondition`/`postcondition` to block. |
| native `terraform test` | 1.6+ | mocked-provider tests treated as full integration coverage |
| mock providers | 1.7+ | asserting **computed** values in `command = plan` mode (needs `apply`) |
| `removed` blocks | 1.7+ | deleting resources with no lifecycle transition |
| provider-defined functions | 1.8+ | overusing data sources for simple transforms |
| cross-variable validation | 1.9+ | checks pushed into postconditions only |
| S3 native lock-file (`use_lockfile`) | 1.10+ | DynamoDB lock table recommended even on ≥1.10 |
| `ephemeral` values | 1.10+ | treated as interchangeable with `sensitive` (only `ephemeral` stays out of state) |
| `write_only` / `*_wo` arguments | 1.11+ | `sensitive = true` used while assuming state is safe |

Also flag: **silently emitting 1.10+/1.11+ features (`use_lockfile`, `write_only`,
`removed`, `ephemeral`) with no corresponding `required_version` bump** in the same diff.
Fix in all cases: either raise `required_version` to the feature's floor, or use the
pre-floor fallback explicitly.

### 5. Contracts, structure & maintainability (lower severity)

- **Exact provider/runtime pin `version = "5.0.0"`** where `~> 5.0` is more maintainable
  (non-prod contexts). → **Optional** (Maintainability). (Exact pins are correct for prod
  module consumption, judge by context.)
- **Untyped `map(any)` / `any` for a long-lived module input** instead of `optional()` with
  typed defaults (1.3+). → **Recommended** (Maintainability). Fix: type the contract.
- **Variable block missing `description` or explicit `type`**, output missing
  `description`. → **Optional** (Maintainability). Fix: add them.
- **`ignore_changes = all` / broad ignore lists** added to silence plan noise. →
  **Recommended** (Correctness). Fix: diagnose the drift root cause instead of ignoring.
- **`each.value` inside a `dynamic` block intending the outer iterator** (shadowed by the
  inner block name). → **Recommended** (Correctness). Fix: set `iterator = ...` and use it.
- **`dynamic` block iterating `toset(...)` of maps/objects** → non-deterministic block
  ordering in plan diffs. → **Recommended** (Correctness). Fix: sort the list or key a map
  by a stable field.
- **Hardcoded cloud IDs/ARNs** (`vpc-0abc...`, literal `arn:aws:iam::...`) introduced in the
  diff. → **Recommended** (Correctness). Often hallucinated from training data. Fix: use a
  data source or input variable.
- **Security-group anti-patterns:** ingress/egress open to `0.0.0.0/0`, or inline
  `ingress`/`egress` blocks in `aws_security_group` (AWS provider v5+). → **Recommended**
  (Security). Fix: least-privilege rules; separate
  `aws_vpc_security_group_{ingress,egress}_rule` resources.
- **Encryption/TLS skipped, default VPC used** for new data stores/resources. →
  **Recommended** (Security). Fix: enforce encryption at rest + TLS; dedicated VPC.

---

## What NOT to flag

- Generic bugs, logic errors, or non-Terraform issues, those belong to the issues agent.
- HCL style/formatting unless a rule above names it.
- Anything in files not changed by this PR.
- Anything requiring execution to confirm (you have no workspace).
- A feature-floor "violation" when the PR does not touch `required_version` **and** the
  feature is old enough to be universally available, don't speculate about an unknown floor
  for, say, `try()`.

## Depth references (optional, read on demand)

These are the source skill's depth docs, carried over for examples and rationale. Read one
only when a rule above fires and you want the worked detail. They are written in a
generation voice, translate to review as above.

- `references/code-patterns.md`, `count`/`for_each` deep dive, `moved` patterns, the full
  Feature Guard Table, version management, provisioners-as-last-resort.
- `references/security-compliance.md`, secrets handling, `write_only`/`ephemeral`,
  trivy/checkov, compliance mappings.
- `references/state-management.md`, backends, locking, safe-destroy protocol, migration,
  multi-team isolation, recovery.

## License & attribution

Apache License 2.0. Derived from **terraform-skill** by **Anton Babenko**
(https://github.com/antonbabenko/terraform-skill, v1.17.1, © 2026 Anton Babenko),
adapted into a PR-review variant by the PR Agent Pro Team. The reference files under
`references/` are reproduced from the source project under the same license.
