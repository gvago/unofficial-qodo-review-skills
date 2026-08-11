---
name: guideline-distiller
description: "Use when asked to convert, distill, or restructure a prose coding guideline, style guide, review checklist, or team-conventions markdown file into atomic enforceable review rules for the Qodo portal, or when prose guidelines are catching too few violations in review."
license: Apache-2.0
metadata:
  author: gvago
  variant: workflow
  version: 1.0.0
---

# guideline-distiller

Turn a prose guideline document into atomic, enforceable review rules. The
Qodo portal ingests markdown guideline files from the repo into structured
rules, but prose enforces poorly: in a real measurement only 7 of 18 planted
violations were caught with prose guidelines, while atomic rules (exactly one
detectable violation per entry) reach reliable enforcement. This skill is the
transformation step between the two.

Read `references/atomic-rule-checklist.md` before splitting statements; it
defines what makes a rule atomic and detectable, with worked examples.

## Boundaries

- Content transformation only. Do not commit, push, or open PRs.
- No portal API calls. The user reviews the output file before it goes live.
- Never modify or delete the source document. Write output to a new file.
- Never invent a rule that is not present in the source document. Every
  output rule must trace back to a source statement.

## Workflow

1. **Inventory.** Read the entire source document. List every normative
   statement: sentences containing must, should, never, always, avoid,
   prefer, do not, required, forbidden, or equivalent imperative phrasing.
   Include statements buried in examples or footnotes. Count them so the
   user can verify coverage.
2. **Split and triage.** Break each statement into atomic rules, exactly one
   detectable violation per rule (see the checklist reference). A statement
   like "use snake_case for functions and UPPER_CASE for macros" becomes two
   rules. Aspirational or unverifiable prose ("be readable", "use common
   sense", "keep it simple") goes to a separate not-enforceable list for the
   user to review; do not silently drop anything.
3. **Write each atomic rule** with all five parts:
   - Rule text in imperative form ("Do X", "Never do Y").
   - A one-line rationale.
   - One minimal violating code example.
   - One compliant example.
   - A severity suggestion (critical, high, medium, or low).
4. **Flag collisions.** During distillation, mark rules that conflict with
   each other, are identical duplicates, or overlap partially. List them in
   a "Conflicts and duplicates" note near the top of the output. The portal
   surfaces these too, but catching them before ingestion saves churn.
5. **Emit one output file.** A single best_practices style markdown file:
   one `##` heading per atomic rule, the five parts under each heading, and
   a final `## Not enforceable (review manually)` section holding the
   triaged-out prose verbatim with a one-line reason each.
6. **Verify fidelity.** Confirm every output rule maps to a source statement
   and every source statement is either a rule or in the not-enforceable
   section. Confirm the source document is byte-for-byte untouched.

## Output shape

```markdown
# Best practices distilled from <source file>

> Conflicts and duplicates: <list or "none found">

## Rule: <imperative rule text>
Rationale: <one line>
Severity: <suggestion>
Violation:
    <minimal code>
Compliant:
    <minimal code>

## Not enforceable (review manually)
- "<original prose>" (reason it cannot be detected)
```

## If the document is already atomic

Say so. Report that minimal or no changes are needed, list any small gaps
(a rule missing an example, a stray aspirational line), and do not rewrite
rules that already meet the checklist.
