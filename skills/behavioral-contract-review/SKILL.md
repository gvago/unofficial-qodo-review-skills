---
name: behavioral-contract-review
description: "Review changes to lifecycle/state transitions, destructive operations, repository helper/API usage, tests, and behavior described in prose documentation. Detect changed-code violations of lifecycle invariants, established semantic contracts, effective test coverage, and code/document consistency. Include docs-only behavior claims; skip formatting-only changes without semantic impact."
license: Apache-2.0
metadata:
  author: gvago
  variant: review
  version: 1.0.0
---

# Behavioral contract review

A review lens for behavioral gaps that can look correct within one diff hunk. Apply all relevant sections, not just the first one that yields a finding. Use available repository source, callers, tests and documentation as evidence. This skill does not provision tools, execute tests, or guarantee that an unavailable dependency can be inspected.

## Evidence contract

For each changed behavior, identify its inputs, caller, preconditions, side effects and observable result. Read the relevant existing helper and downstream phase before judging their contracts. A PR description or comment is a claim to verify, not proof of safety.

Report only a defect introduced or activated by the change. Anchor the finding on an added or removed line that causes it, including a removed guard/test or a changed prose claim. Cite the precise rule below, the triggering condition, the consequence and supporting source locations. Never fabricate a line, requirement, runtime result or skill attribution. Missing context is uncertainty, not proof of a bug.

## Rule index

### Lifecycle and destructive effects

- **BC-L1: Preserve transition invariants.** A metadata-only transition (pause, archive, disable, detach) must not invoke irreversible resource deletion when the established contract retains the resource for resumption, rollback or another owner. Check what each callee actually does and the state left on failures. Flag a concrete lost resource, invalid intermediate state, duplicate effect or broken recovery, not an operation's name alone.
- **BC-L2: Preserve destructive scope.** Delete, cleanup and bulk-update predicates must retain the environment, tenant, namespace and ownership boundaries required by their callers and data model. Trace selectors through the final side-effecting API. A unique-looking name is not proof of global uniqueness. State which out-of-scope resource can be changed and the reachable request that does so.
- **BC-L3: Enforce mutable preconditions at the effect.** Conditions checked during plan/preview/validation must still protect the later apply/execute/retry path when persisted state or caller identity can change between phases. An equivalent atomic predicate, lock, version check or immutable capability is sufficient. Flag the specific bypass or stale plan that can reach the effect; do not invent concurrency when no interleaving or second entry point is possible.

### Consistency with repository behavior

- **BC-C1: Preserve shared-helper semantics.** Replacement or reimplementation of existing parsing, normalization, validation or request logic must preserve the established contract used by sibling callers. Read the helper and identify a concrete input for which the changed path diverges incorrectly, including missing validation. Duplicated code that is behaviorally equivalent is not itself a finding.
- **BC-C2: Respect the actual API contract.** Calls to existing repository APIs must preserve parameter meaning, units, defaults, return shape, exception behavior and ownership. Compare the declaration and an existing correct call, not just symbol names. Flag the observable mismatch on a reachable path; a different but supported invocation is valid.

### Effective tests

- **BC-T1: Do not silently disable regression protection.** Added skip/disable/xfail markers, narrowed discovery, early returns and swallowed failures must not make an existing required behavior untested or turn unexpected failures into success. A documented platform constraint or an explicit, justified quarantine with replacement coverage is not automatically wrong. Name the lost scenario and what regression now passes unnoticed.
- **BC-T2: Synchronize on completion, not elapsed guesses.** A fixed real sleep must not be the only synchronization before asserting on asynchronous work whose completion is not bounded by that sleep. Trace the producer and show the schedule where the assertion races. Prefer events, awaited tasks or bounded condition waits. Fake-clock advancement, rate-limit/backoff behavior under test and intentional timeout tests are not sleep-based readiness bugs.
- **BC-T3: Assertions must discriminate success from failure.** A new or weakened assertion must fail for the defect it claims to guard. Judge the scenario the test actually claims, not every requirement of the entire component; the absence of an additional negative, ordering or boundary test is not a defective assertion. Flag self-comparisons, constant truths, assertions on uncalled mocks or input values rather than effects, and equality against the same mutated object when the intended state change is never checked. Show a wrong result or omitted effect that still passes. Exception assertions, snapshot tests and test-runner/framework-owned assertions can be substantive without a literal assert statement.

### Prose documentation and behavior

- **BC-D1: Keep behavioral claims consistent.** Changed code and affected current prose documentation must agree on defaults, units, scope, conditions, exclusions, ordering, retries, side effects and guarantees. Follow the behavior beyond the named function: qualifiers such as 'only', 'unless', 'before', 'after', 'all' and 'never' carry contracts even when identifiers remain unchanged. Cite the exact prose claim and the implementation branch contradicting it. Check both code-changing and docs-only changes.
- **BC-D2: Resolve intent before prescribing a fix.** When a documented behavior and implementation disagree, use explicit requirements, callers and tests to establish which side should change. Do not automatically treat docs as authoritative or require reverting a deliberate, consistently updated behavior. If the direction is unresolved, report the evidenced mismatch without inventing product intent. Historical release notes, version-scoped migration guidance, illustrative pseudocode and documentation for another mode are not current promises for this path.

## Review sequence

1. Map changed operations and their callers; trace lifecycle transitions and side-effect scope through every affected phase.
2. Compare existing helpers and sibling API usage against concrete inputs on the changed path.
3. Inspect changed test discovery, synchronization and assertions. Mentally substitute a broken result and check whether the test would reject it. Do not claim this was an executed mutation test.
4. Locate prose discussing the changed behavior. Compare its conditions, scope, ordering and exceptions with source, including when only documentation changed.
5. Apply the evidence contract and false-positive exclusions before emitting each finding. Do not emit a compliant-case ledger as a defect, and do not cap findings at one per section.

## Severity and boundaries

Use `action_required` for proven destructive loss, cross-boundary changes or a serious reachable correctness defect. Use `remediation_recommended` for ineffective regression protection, demonstrated nondeterministic tests or a materially misleading current behavior claim. Calibrate to the actual consequence; a rule ID does not prescribe severity on its own. Group only findings with the same root cause, keeping distinct affected paths explicit.

Do not flag pre-existing unrelated issues, hypothetical requirements, helper reuse for its own sake, missing tests for every line, stylistic documentation edits, justified test exclusions or unreachable failure paths. Do not assume sleep duration proves a race, that a test with no literal assertion has no oracle, or that an archive operation necessarily retains data without checking its contract.

## Adoption

Copy this folder to a skill directory supported by your Qodo deployment. Configure it as an active review-steering skill scoped to the target repository, and verify that a real review consults it. A discovered catalog entry or a zero-findings review alone does not prove execution. Review-effort and file-exclusion settings still control whether a change is reviewed; the skill cannot override a skipped review.

For evaluation results and reproducible synthetic cases, see `evals/README.md` when supplied with this release. Repository-specific invariants still need to be available in source or review context. Adjust these rules through normal human-reviewed changes, never during a review run.

## Sourcing

Original community-authored rules, Apache-2.0. This skill is unofficial and is not affiliated with or endorsed by Qodo. It contains no customer code or private product implementation details.
