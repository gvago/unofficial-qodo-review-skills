---
name: commit-message-review
description: "Use when reviewing any Gerrit change or PR that has a commit message, verifies the message against the diff: claim/code mismatches (message says fix, diff adds a feature), unmentioned user-visible behavior changes, vague messages on non-trivial diffs, implausible ticket or issue ids. Fires on every review where a commit message is visible."
license: Apache-2.0
metadata:
  author: gvago
  variant: review
  version: 1.0.0
---

# commit-message-review

Lens that verifies the commit message against the diff. Runs no tools.
Trust nothing the message says until the diff proves it.

## Boundaries

- Judge only the relationship between the commit message and the changed
  lines. Code correctness, style, and design belong to other lenses.
- Gerrit has no inline anchoring on the commit message pseudo-file yet.
  Anchor every finding on a changed line in the diff that demonstrates
  the mismatch, and quote the offending message text in the finding body.
- Do not flag wording, grammar, tense, or formatting of the message when
  its content is accurate.

## How to apply

1. Read the full commit message: subject, body, and trailers (Fixes:,
   Bug:, Issue:, ticket ids).
2. Read the whole diff and list what it actually does: fixes, features,
   refactors, behavior changes, interface changes.
3. Compare the two lists and apply the rule index.

## Rule index

- M1. Claim/diff match. Every claim in the message must match what the
  diff actually does. Flag mismatches: the message says fix but the diff
  adds a feature, the message describes a change the diff does not
  contain, or the diff does something major that the message frames as
  something else.
- M2. Behavior coverage. The message must mention every user-visible
  behavior change present in the diff: changed defaults, removed or
  renamed flags and options, altered output or error handling, new or
  removed endpoints or commands. An unmentioned behavior change is a
  finding even when the rest of the message is accurate.
- M3. No vague messages on non-trivial diffs. Messages like "fix stuff",
  "update code", "misc changes", or a bare file name are findings when
  the diff is non-trivial (more than a rename, a comment edit, or a
  one-line mechanical change).
- M4. Ticket plausibility. A referenced ticket or issue id must be
  plausible for the change scope: the project prefix and the subject the
  message attributes to it should fit the code being touched. Flag ids
  whose stated subject or project clearly does not match the diff. Do
  not demand tracker access; judge plausibility from message and diff
  alone.

## Mapping a finding to the contract

- action_level: action_required for a proven M1 mismatch that would
  mislead a reader about what shipped; remediation_recommended for M2,
  M3, and M4.
- category: Correctness for M1, Maintainability for M2 to M4.
- evidence: quote the message text and cite the changed file and line
  that contradicts it or is missing from it. Anchor on the change
  itself, never on the commit message pseudo-file.

## What NOT to flag

- Accurate but terse messages on trivial diffs.
- Message style, capitalization, or line-length conventions.
- Claims about motivation or external context that the diff cannot
  verify either way.
