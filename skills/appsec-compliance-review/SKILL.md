---
name: appsec-compliance-review
description: Use when a PR diff touches application code, or any committed configuration that can carry credentials, governed by an organization's written security policy. Enforces five AppSec rules on the CHANGED code only - authentication/authorization on sensitive endpoints, injection, SSRF, debug/test code reachable in production, and hardcoded secrets - reporting per-rule per-file coverage so an unevaluated rule is never a silent skip. Skip only for docs-only diffs.
license: Apache-2.0
metadata:
  author: PR Agent Pro Team
  variant: review
  version: 1.0.0
---

# AppSec compliance review

You are reviewing a pull request in a repository governed by five security
rules. Apply them to the changed code and report coverage explicitly.

These five are a starting point. Replace them with your own organization's
rules; the review contract below is the part worth keeping.

## Pairing with a rule file

When the same rules also live in a machine-readable policy file in the repo
(for example `pr_compliance_checklist.yaml` at the root), that file is the
authoritative wording and the sections below must mirror it verbatim. If the
two ever differ, the policy file wins and this skill must be updated in the
same change.

Note that a rules platform may import BOTH files as separate rule sets, which
double-reports each finding. Ship one or the other unless you have a reason to
carry both.

## The rules

### SEC-1: Authentication & Authorization

- **Objective:** Every sensitive action and every access to data must enforce
  authentication and server-side authorization. Sensitive actions include PUT,
  POST and DELETE endpoints of loan management, payment and financial,
  document management, user and access control, and critical administrative
  functionality.
- **Compliant:** All sensitive endpoints verify the caller's identity and
  check server-side authorization before performing the action or returning
  data.
- **Violation:** A sensitive endpoint (PUT/POST/DELETE on loans, payments,
  documents, user management, or admin functionality) performs its action or
  returns data without authentication or without a server-side authorization
  check.

### SEC-2: Injection Prevention

- **Objective:** Never concatenate untrusted input into SQL, OS commands,
  templates, LDAP, XPath, HTML, or JavaScript. Use parameterized queries and
  safe encoders.
- **Compliant:** Database access uses parameterized queries / prepared
  statements; shell commands, templates and markup are built with safe
  encoders, never by string concatenation of untrusted input.
- **Violation:** Untrusted input (request parameters, headers, external data)
  is concatenated or interpolated into a SQL query, OS command, template,
  LDAP/XPath expression, HTML or JavaScript.

### SEC-3: SSRF Prevention

- **Objective:** Never allow untrusted input to directly or indirectly
  control server-side URLs, hosts, IPs, ports, or request destinations.
  Prefer explicit allow-lists and detect bypass risks involving redirects,
  DNS rebinding, private/internal IP ranges, localhost, and cloud metadata
  endpoints.
- **Compliant:** Server-side HTTP/network calls use fixed or strictly
  allow-listed destinations; any user-influenced destination is validated
  against an explicit allow-list with redirect and internal-range protections.
- **Violation:** A flow from user input, external APIs, or databases reaches
  an HTTP client or network call and controls the destination (URL, host, IP,
  port) without strict destination validation.

### SEC-4: Test Code & Debug Endpoint Exposure

- **Objective:** Production code must exclude or securely disable all test,
  debug, mock, demo, diagnostic, or development-only functionality.
- **Compliant:** No test endpoints, debug routes, bypass mechanisms,
  hardcoded test users or data, mock services, or hidden administrative
  functionality reachable in production builds.
- **Violation:** Test/debug/mock/demo code, debug routes, auth bypass
  mechanisms, hardcoded test users, or environment checks exposing
  non-production functionality are present and reachable in production code
  paths.

### SEC-5: Secrets & Sensitive Data Protection

- **Objective:** Never hardcode secrets, tokens, passwords, private keys, or
  connection strings in source code.
- **Compliant:** Secrets are loaded from a secret manager or environment
  configuration; no credential material appears in the codebase.
- **Violation:** A secret, token, password, private key, or connection string
  is hardcoded in source code or configuration committed to the repository.

## How to review

1. Evaluate EVERY rule against EVERY changed file. Do not sample.
2. For each violation, report: the rule ID, the file and line, the exact rule
   text it violates, the evidence in the code, and a concrete fix.
3. If a rule cannot be evaluated for a changed file (for example, the file is
   binary or generated), report that explicitly with the reason. An
   unevaluated rule is itself a finding, never a silent skip.
4. End with a coverage summary reporting the rule x file grid, not just rule
   totals: for each changed file, which of the five rules were evaluated and
   which were skipped and why, then the violation count. "5 rules evaluated"
   without naming the files it covered is not a coverage summary.
5. Apply a false-positive gate last, per rule - it is not universal:
   - SEC-2 and SEC-3 turn on untrusted input. Drop a finding when the input is
     not attacker controlled or the code is unreachable from production.
   - SEC-1, SEC-4 and SEC-5 do not require attacker-controlled input at all. A
     missing authorization check, a debug route, or a hardcoded credential is a
     violation on its own. Drop one only when the code is genuinely unreachable
     from any production build - never because the input looks trusted.
   - "Unreachable from production" means proven unreachable, not inferred from
     a path or filename. A diff shows changed lines, not the import graph, so
     you usually cannot prove it. When you cannot, evaluate the file on its
     contents and report the finding.
   - Test fixtures and eval files are source code. A credential committed in
     one is still an SEC-5 violation; report it and note the context. Obvious
     placeholder values are still findings: policy is about the pattern, and
     the reviewer cannot tell a fake secret from a real one.
   Say so whenever you drop a finding, with which clause let it go.

## Using this skill as a template

Copy this directory to `skills/<your-skill-name>/` in your own repository and
replace the rule sections with your organization's rules. Keep the structure:

- Frontmatter `description` must read as a review lens (when to fire, when to
  skip), on one line. The relevance filter reads only this.
- One section per rule with a stable ID, carrying the full
  objective/compliant/violation criteria copied verbatim from your source
  document. Do not paraphrase or condense: a shortened rule narrows what the
  review checks. Name the source document and state that it wins on any
  difference.
- The "How to review" contract (full enumeration, rule x file coverage
  summary, per-rule false-positive gate) is what turns a rules document into a
  review a security team can trust; keep it verbatim. If you add rules, classify
  each one in step 5 as input-dependent or not - a gate that assumes every rule
  needs attacker-controlled input silently drops the ones that don't.
