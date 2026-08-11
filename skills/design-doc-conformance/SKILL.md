---
name: design-doc-conformance
description: "Use when reviewing any change in a repo that contains design documents (docs/design*.md, docs/adr/*.md, or a dedicated context repo), verifies the implementation against those committed docs: contradictions of explicit design statements, new public interfaces absent from the design, cited to the doc line. Fires whenever design docs exist in the repo under review."
license: Apache-2.0
metadata:
  author: gvago
  variant: review
  version: 1.0.0
---

# design-doc-conformance

Lens that checks the implementation against design documents committed
in the repository. The docs are the contract; the diff must honor it.

## Boundaries

- Judge conformance to written design statements only. Code correctness,
  style, and security belong to other lenses.
- The only admissible evidence is text that exists in a committed design
  doc. Never argue from general best practice as if it were the design.
- If no design docs exist, or the change does not touch designed
  behavior, produce no findings from this lens.

## How to apply

1. Locate design docs: look for `docs/design*.md` and `docs/adr/*.md` in
   the repository under review, and any dedicated context repo the
   review environment provides.
2. Read every located doc in full before judging the diff.
3. List explicit design statements (musts, defaults, limits, interface
   inventories) and compare each changed line against them.
4. See `references/example-design-doc.md` for the statement style this
   lens can enforce against.

## Rule index

- D1. Read before judging. Read every design doc this skill's references
  point to (docs/design*.md, docs/adr/*.md, dedicated context repo)
  before producing any finding. A finding made without having read the
  docs is invalid.
- D2. Contradiction. Flag implementation that contradicts an explicit
  design statement. The finding must quote the statement and cite the
  doc file and line, plus the changed code line that violates it.
- D3. Undesigned public interface. Flag new public interfaces (exported
  functions, public classes or methods, CLI flags, endpoints, config
  keys) that appear in the diff but are absent from the design docs'
  interface inventory.
- D4. Silence without docs. When the repo has no design docs, or the
  change does not touch behavior the docs describe, stay silent. Absence
  of documentation is not a finding for this lens.
- D5. No invented requirements. Never flag against a requirement that is
  not written in a doc. Preferences, conventions, and inferred intent do
  not count; only quoted doc text does.

## Mapping a finding to the contract

- action_level: action_required for a D2 contradiction of an explicit
  must or must-not statement; remediation_recommended for D3.
- category: Correctness for D2, Maintainability for D3.
- evidence: quote the design statement with its doc path and line
  number, then cite the changed file and line that conflicts with or is
  missing from it.

## What NOT to flag

- Internal helpers and private implementation details the docs never
  claim to govern.
- Doc quality, staleness, or formatting.
- Behavior the docs are silent about (that silence is D4/D5 territory,
  not a finding).
