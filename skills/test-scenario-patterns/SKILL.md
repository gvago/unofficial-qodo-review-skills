---
name: test-scenario-patterns
description: "Use when a PR adds or changes test scenarios (test functions, parametrized cases, test classes) in tests/. Classifies EVERY added or modified test scenario against the approved test-pattern catalog (TP-01..TP-06) and reports the match, including scenarios that are compliant."
license: Apache-2.0
metadata:
  author: gvago
  variant: review
  version: 1.1.0
---

# Test scenario pattern ledger

Our team only accepts test scenarios that follow one of the approved
patterns below. Reviewers need an explicit record for every scenario, not
only for problems: a clean review must still say WHY each scenario was
accepted.

## How to apply

1. Enumerate every test scenario added or modified in the diff. A scenario is
   one test function, or one row of a `pytest.mark.parametrize` table.
2. For each scenario, decide which single catalog pattern it matches, using the
   "Recognize by" criteria. Pick the most specific match.
3. Report one ledger line per scenario, in this exact format:

   `PATTERN-LEDGER | <file>::<test name> | <TP-xx or NO-MATCH> | <one-line reason>`

4. A scenario that matches a pattern is COMPLIANT. Still report it, with the
   matched pattern ID. Do not omit compliant scenarios; the ledger is the
   audit record.
5. A scenario that matches no pattern is reported as `NO-MATCH` and is a
   finding: name the closest pattern and what is missing.

## Required ledger finding

In addition to any NO-MATCH findings, ALWAYS raise exactly one finding,
severity Low, category Testability, titled "Test pattern ledger", anchored on
the first changed line of the first changed test file. Its description must be
the full ledger: one `PATTERN-LEDGER | ...` line per scenario, compliant
scenarios included. This finding is the audit record and must be raised even
when every scenario is compliant. It is not optional and must not be merged
into other findings.

## Pattern catalog

- **TP-01 Happy path AAA**: one call to the unit under test with valid input,
  explicit Arrange / Act / Assert, asserts on the returned value.
  Recognize by: single act line, equality assertion on output, no mocks.
- **TP-02 Boundary table**: `pytest.mark.parametrize` over values at and around
  a documented limit (min, min-1, max, max+1, zero/empty).
  Recognize by: parametrize ids or values that straddle a limit.
- **TP-03 Error contract**: asserts the exact exception type AND message/field
  using `pytest.raises(..., match=...)`.
  Recognize by: `pytest.raises` with `match=`; bare `pytest.raises(Exception)`
  does NOT qualify.
- **TP-04 Collaborator double**: replaces an external dependency (clock, HTTP,
  DB, gateway) with a fake/mock AND verifies the interaction (call args or
  call count).
  Recognize by: mock/fake injected through a parameter, plus
  `assert_called_*` or recorded-call assertions.
- **TP-05 Idempotency**: performs the same operation twice and asserts the
  second call leaves state and outputs unchanged.
  Recognize by: repeated act, assertion comparing first and second results
  or state.
- **TP-06 Round-trip**: encode/serialize then decode/parse, asserts equality
  with the original.

## Not a pattern (always NO-MATCH)

- Tests without assertions, or asserting only `is not None`.
- Tests that use `time.sleep` or real wall-clock time.
- Tests that call real network endpoints.
