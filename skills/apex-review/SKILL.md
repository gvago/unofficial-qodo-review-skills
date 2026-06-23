---
name: apex-review
description: Use when a PR diff adds or modifies Salesforce Apex (.cls / .trigger) or SOQL/SOSL — flags governor-limit killers (SOQL/DML inside loops), missing CRUD/FLS & sharing enforcement, SOQL injection, hardcoded IDs, trigger anti-patterns, and swallowed exceptions in the CHANGED code only. Skip for non-Apex diffs.
license: Apache-2.0
metadata:
  author: PR Agent Pro Team
  source: PMD Apex ruleset (https://github.com/pmd/pmd, BSD-2-Clause) + Salesforce Apex governor-limit docs
  variant: review
  version: 1.0.0
---

# Apex Review Skill

Review lens for Salesforce **Apex** and **SOQL/SOSL** changes in a pull request. Every
rule below is a **concrete violation you can point at in the diff**.

Apex is the single highest-value language for an LLM-backed reviewer to get right: it is
under-represented in training data, and its **governor limits** make patterns that look
perfectly fine in Java/C# (a query inside a loop) silently brick production once data
volume crosses a threshold. A generic reviewer misses these constantly. This skill encodes
the Apex-specific failure modes — sourced from the PMD Apex ruleset (BSD-2) and Salesforce's
own governor-limit guidance — as diff-checkable rules.

## How to apply this skill (read first)

You are reviewing a **unified diff**, not a live org. Therefore:

- **You cannot run anything.** No `sf project deploy`, no anonymous Apex, no test run, no
  PMD execution. Judge from the changed lines alone. Never emit a finding whose
  justification is "run X to confirm."
- **Findings apply to the diff, not the whole org.** Only flag Apex that was *added or
  modified* in this PR.
- **Every finding must trace to a rule below.** If you cannot point to a specific rule in
  this file that the changed code violates, drop it — the generic "issues" agent handles
  ordinary bugs. This skill only fires on the Apex-specific rules enumerated here.
- **Loops include hidden ones.** `for`, `while`, `do-while`, *and* trigger bodies (a trigger
  processes up to 200 records per invocation — its top level is effectively a loop over
  `Trigger.new`). A query in a method called from inside a loop counts too.

## Mapping a finding to the SkillsFinding contract

| This skill's severity | `action_level` | `category` (typical) |
|-----------------------|----------------|----------------------|
| **Blocking** — will hit a governor limit, leak data, or allow injection | `action_required` | `Correctness` or `Security` |
| **Recommended** — likely wrong, context-dependent | `remediation_recommended` | `Correctness` / `Maintainability` |
| **Optional** — maintainability nudge | `informational` | `Maintainability` |

Each finding's `evidence.citations` MUST include a `SkillCitation` with
`source = "apex-review"`. Put the offending span in `diff_pointer`. Give a concrete
`fix_suggestion` (the **Fix** line of each rule is your starting point).

---

## Rule set

### 1. Governor limits — the #1 Apex footgun (mostly Blocking)

> Apex runs in a multi-tenant environment with hard per-transaction limits: **100 SOQL
> queries**, **150 DML statements**, **50,000 rows retrieved**, plus CPU time. Code that
> performs these *per record* instead of *in bulk* works in a unit test with one record and
> dies in production on a 200-record batch. This is the mistake LLMs make most.

- **SOQL or SOSL query inside a loop.** → **Blocking** (Correctness). [PMD
  `OperationWithLimitsInLoop`]. Hits the 100-query limit. Fix: move the query outside the
  loop; query once with a bulk `WHERE id IN :ids`, build a `Map<Id, SObject>`, look up
  inside the loop.
- **DML statement (`insert`/`update`/`delete`/`upsert`/`Database.*`) inside a loop.** →
  **Blocking** (Correctness). [PMD `OperationWithLimitsInLoop`]. Hits the 150-DML limit.
  Fix: accumulate records into a `List<SObject>` in the loop, perform a single DML on the
  list after the loop.
- **Other limit-consuming calls inside a loop** — `@future`/Queueable/Batch enqueue,
  `Approval.process`, `Messaging.sendEmail`, async scheduling. → **Blocking** (Correctness).
  [PMD `OperationWithLimitsInLoop`]. Fix: hoist out of the loop; batch the work.
- **Expensive Schema/describe calls inside a loop** (`Schema.getGlobalDescribe()`,
  `getDescribe()` per iteration). → **Recommended** (Performance). [PMD
  `OperationWithHighCostInLoop`]. Fix: call once before the loop, cache the result.
- **Unfiltered SOQL/SOSL** — `SELECT ... FROM X` with no `WHERE` and no `LIMIT` on a large
  object. → **Recommended** (Correctness). [PMD `AvoidNonRestrictiveQueries`]. Risks the
  50k-row limit. Fix: add a selective `WHERE` and/or `LIMIT`.

### 2. Security — CRUD / FLS / sharing / injection (mostly Blocking)

- **DML or SOQL in a class with no explicit sharing declaration.** → **Blocking**
  (Security). [PMD `ApexSharingViolations`]. Without `with sharing` the code runs in system
  context and ignores record-level access. Fix: declare `with sharing` (or `inherited
  sharing` for library classes) on classes that perform DML/SOQL.
- **Object/field access without a CRUD/FLS check** — direct `insert`/`update`/`SELECT` on
  user-reachable objects with no `Schema.sObjectType.X.isCreateable()/isAccessible()/...`
  guard or `WITH SECURITY_ENFORCED` / `Security.stripInaccessible`. → **Blocking**
  (Security). [PMD `ApexCRUDViolation`]. Fix: add the CRUD/FLS check, or use `WITH
  SECURITY_ENFORCED` in the SOQL, or `Security.stripInaccessible` before DML.
- **Dynamic SOQL built by string-concatenating an untrusted variable** —
  `Database.query('... ' + var + ' ...')`. → **Blocking** (Security). [PMD
  `ApexSOQLInjection`]. Fix: use bind variables (`:var`), or `String.escapeSingleQuotes()`
  for identifiers that cannot be bound.
- **Hardcoded credentials / endpoints in callouts.** → **Blocking** (Security). [PMD
  `ApexSuggestUsingNamedCred`]. Fix: use a Named Credential.
- **Plain `http://` endpoint in a callout.** → **Blocking** (Security). [PMD
  `ApexInsecureEndpoint`]. Fix: use `https://`.
- **Redirect to a user-controlled location** (open redirect). → **Blocking** (Security).
  [PMD `ApexOpenRedirect`]. Fix: validate/whitelist the target.
- **URL parameter used without escaping** (`ApexPages.currentPage().getParameters().get(..)`
  flowing into output). → **Blocking** (Security). [PMD `ApexXSSFromURLParam`]. Fix:
  escape/sanitize before use.
- **`addError()` called with escaping disabled** (`escape=false`). → **Blocking**
  (Security). [PMD `ApexXSSFromEscapeFalse`]. Fix: leave escaping on.
- **Hardcoded crypto keys/IVs** in `Crypto` calls. → **Blocking** (Security). [PMD
  `ApexBadCrypto`]. Fix: use randomly generated keys/IVs.

### 3. Triggers & error-prone patterns

- **Hardcoded Salesforce ID** (`'001...'`, `'00D...'`, record-type/profile IDs as string
  literals). → **Blocking** (Correctness). [PMD `AvoidHardcodingId`]. IDs differ across
  sandbox/prod/orgs and break on deploy. Fix: query the record dynamically or use a Custom
  Setting/Metadata.
- **Direct indexed access to `Trigger.new[0]` / `Trigger.old[0]`** instead of iterating the
  collection. → **Recommended** (Correctness). [PMD `AvoidDirectAccessTriggerMap`]. Assumes
  a single record; breaks on bulk. Fix: iterate `Trigger.new`, key into `Trigger.oldMap`.
- **Business logic written directly in a trigger body.** → **Recommended** (Maintainability).
  [PMD `AvoidLogicInTrigger`]. Fix: delegate to a handler class.
- **DML in a constructor or initializer.** → **Recommended** (Correctness). [PMD `ApexCSRF`].
  Merely loading a page executes it — a CSRF surface. Fix: move DML out of the constructor.
- **Empty `catch` block** (exception swallowed, nothing logged/rethrown). → **Recommended**
  (Correctness). [PMD `EmptyCatchBlock`]. Fix: handle, log with context, or rethrow.
- **`Map` keyed by an interface type** where an abstract class defines `equals`/`hashCode`.
  → **Recommended** (Correctness). [PMD `AvoidInterfaceAsMapKey`]. Lookups misbehave. Fix:
  key by a concrete type / stable field.
- **Class/enum/interface named the same as a `System` or `Schema` builtin.** → **Recommended**
  (Correctness). [PMD `TypeShadowsBuiltInNamespace`]. Shadows the namespace. Fix: rename.

### 4. Async & global surface

- **`Queueable` implemented without attaching a `Finalizer`.** → **Recommended**
  (Reliability). [PMD `QueueableWithoutFinalizer`]. No failure handling for the async job.
  Fix: `System.attachFinalizer(...)`.
- **New `@future` method** where Queueable would be more capable. → **Optional**
  (Maintainability). [PMD `AvoidFutureAnnotation`]. `@future` is legacy (no chaining, limited
  args). Fix: prefer Queueable.
- **New `global` class/method** outside a managed-package boundary. → **Recommended**
  (Maintainability). [PMD `AvoidGlobalModifier`]. `global` signatures can never be changed or
  deleted. Fix: use `public` unless the cross-package surface is truly required.

### 5. Tests (lower severity, but real)

- **New `@isTest` class using `seeAllData=true`.** → **Recommended** (Correctness). [PMD
  `ApexUnitTestShouldNotUseSeeAllDataTrue`]. Tests then depend on org data and break
  unpredictably. Fix: create test data in the test (or `@testSetup`).
- **New test method with no assertion at all.** → **Recommended** (Correctness). [PMD
  `ApexUnitTestClassShouldHaveAsserts`]. Fix: assert the actual outcome.
- **`testMethod` keyword** instead of the `@isTest` annotation. → **Optional**
  (Maintainability). [PMD `ApexUnitTestMethodShouldHaveIsTestAnnotation`]. `testMethod` is
  deprecated. Fix: use `@isTest`.

---

## What NOT to flag

- Generic bugs, logic errors, or non-Apex issues — those belong to the issues agent.
- Code style/formatting unless a rule above names it.
- Anything in files not changed by this PR.
- Anything requiring deployment or a test run to confirm (you have no org).
- A "SOQL in loop" finding when the query is demonstrably already bulkified (collected
  before the loop, looked up via a Map inside it) — read the surrounding changed lines
  before flagging.

## Source & attribution

Rules are derived from the **PMD Apex ruleset**
(https://github.com/pmd/pmd, BSD-2-Clause) — specifically the `performance`, `security`,
`errorprone`, and `bestpractices` categories — and from Salesforce's published Apex
governor-limit guidance. Rule identifiers in brackets (e.g. `OperationWithLimitsInLoop`) map
back to PMD rules so a reviewer can consult the upstream rationale and examples. This skill
is original prose authored for PR review and is licensed Apache-2.0; it copies no PMD source
text verbatim.

**For *writing* Salesforce code** (Apex, LWC, OmniStudio, Data Cloud, Agentforce), see
Salesforce's official skills at https://github.com/forcedotcom/sf-skills — those are
authoring/generation skills and complement this review-only skill.
