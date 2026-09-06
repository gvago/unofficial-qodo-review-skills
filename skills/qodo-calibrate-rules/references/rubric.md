# Rubric

Three layers. Layer 1 proposes; layers 2 and 3 veto decreases.

Severity → review level: `error` = action_required (must comply; merge-blocking) · `warning` =
remediation_recommended (comply by default) · `recommendation` = informational (apply when
appropriate). Display labels (P0/P1/P2, High/Medium/Low, Critical/Warning/Info) are workspace
presentation settings. Never read or write them.

## Layer 1 — tag taxonomy (fixed) and default severity (overridable)

The taxonomy, default severities, and default guard terms are encoded once in
`scripts/lib/calibrate-lib.mjs`; that file is the source of truth and this page is the
human-readable copy (the test suite checks they agree).

| Tag | Default | Matches rules about |
|---|---|---|
| `documentation` | recommendation | docstrings, comments, README/changelog presence |
| `naming` | recommendation | identifier, file, branch naming conventions |
| `style-formatting` | recommendation | whitespace, line length, brace style, quotes, formatter output |
| `import-order` | recommendation | import grouping/ordering, unused imports |
| `test-hygiene` | warning | test presence, structure, naming, fixtures, flakiness patterns |
| `error-handling` | warning | exceptions, retries, timeouts, null handling |
| `logging` | warning | log presence, levels, structure, no sensitive data in logs (guard may escalate) |
| `api-contract` | warning | public signatures, type annotations, schema/interface stability |
| `architecture` | warning | module boundaries, layering, dependency direction, allowed imports between components |
| `correctness-contract` | error | invariants whose violation produces wrong results or data corruption |
| `security-control` | error | authn/authz, input validation, injection, crypto usage |
| `data-integrity` | error | migrations, transactions, deletion, backups, idempotency |
| `secrets-handling` | error | credentials, tokens, keys in code/config/logs |

One tag per rule. When two fit, choose the tag with the higher default severity.

## Layer 2 — platform category as a prior

Rules carry a platform `category` (Correctness, Security, Reliability, Performance, Observability,
Maintainability, Quality, Testability, Compliance, Accessibility, Architecture). A tag with default
`recommendation` on a rule whose category is `Security` or `Compliance` is a contradiction. The
prior vetoes **decreases only**: when the rubric would lower such a rule, the rule is recorded as
`needs_decision` with its current severity kept, and the proposal lists it under needs-a-decision
with no pre-checked change. A `Security`/`Compliance` rule that is already at `recommendation` is
left unchanged and does not appear in the proposal (the proposal is a diff); an increase is never
vetoed.

## Layer 3 — keyword guard

Default guard terms (case-insensitive, whole-word or stem): `auth`, `authoriz`, `authentic`,
`secret`, `token`, `credential`, `password`, `PII`, `personal data`, `payment`, `migration`,
`delete`, `deletion`, `drop`, `encrypt`, `decrypt`. A rule whose name or content matches any guard
term is never proposed for a decrease, regardless of tag. It is listed under needs-a-decision with
the matched term shown. Increases are never vetoed. Stem matching can over-match (`drop` hits
"dropdown", `token` hits "tokenizer"); a false hit only adds a needs-a-decision row for the admin
to confirm — it never changes a rule. `auth` is special-cased so it does not match "author".

## Rubric file

Location: `${QODO_HOME:-$HOME/.qodo}/calibrate/rubric.yaml`. Written from
`references/rubric-defaults.yaml` on first run. Schema is exactly:

```yaml
version: 1
severity_overrides:       # tag → error|warning|recommendation; omitted tags use defaults
  documentation: warning
guard_terms_extra:        # appended to the default guard list
  - billing
  - invoice
```

Unknown keys are an error. Tag names outside the taxonomy are an error. The full effective rubric
(defaults merged with overrides) is written to `<run-dir>/rubric-snapshot.yaml` for every run and
is embedded verbatim in every proposal and receipt.

## Tagging: common calls

One tag per rule, chosen from the rule's **full content** together with its name and platform
category — never from the name alone. When two
tags fit, choose the one with the higher default severity ("never log tokens" is
`secrets-handling`, not `logging`; "validate request bodies against the schema" is
`security-control`, not `api-contract`).

| The rule is about | Tag |
|---|---|
| type annotations, public signatures, schema/interface stability | `api-contract` |
| module boundaries, layering, dependency direction, allowed imports between components, "X must never import Y", "create charges only via the façade" | `architecture` (not `api-contract`) |
| docstrings, comments, README/changelog | `documentation` |
| identifier or file naming | `naming` |
| formatter or linter output, whitespace, quotes, line length | `style-formatting` |
| import grouping, unused imports | `import-order` |
| tests present, structured, deterministic | `test-hygiene` |
| exceptions, retries, timeouts, null handling | `error-handling` |
| log presence, levels, structure | `logging` |
| invariants whose violation gives wrong results | `correctness-contract` |
| authn/authz, input validation, injection, crypto | `security-control` |
| migrations, transactions, deletion, idempotency, backups | `data-integrity` |
| credentials, tokens, keys in code, config, or logs | `secrets-handling` |

Long batch? Read it in parts — never skip one or tag from a skim.
