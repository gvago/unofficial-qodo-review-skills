# Live proof

The demo runs in [PR 22](https://github.com/gvago/unofficial-qodo-review-skills/pull/22).
[Automatic result comment](https://github.com/gvago/unofficial-qodo-review-skills/pull/22#issuecomment-5810328350).

The plan producer is synthetic and explicitly labelled. GitHub comment reads/writes and Qodo review operations are real. No Terraform execution, customer infrastructure, native-feature deployment or customer CI integration is claimed.

## Same-source revision sequence

All three reviews assessed commit `57ef33c835d9e3373027ad1183f3c01e1ea3bbf3`. No source push or manual review command occurred between the plan changes. The watcher submitted reviews itself.

| Input event | Qodo's plan-specific response |
|---|---|
| Development and production comments arrive, both set to one day | Flags `example-audit-prod` expiring after one day |
| Edit the existing production comment to 120 days | Explicitly acknowledges the production plan uses 120 days, while still identifying the missing source-level minimum |
| Post a new production comment with seven days | Flags the supplied production value of seven days; retains the development plan and replaces only production evidence |

`proof.json` preserves operation IDs, source comment IDs, revision, digests, full-analysis/coverage metadata and the returned finding text. The result comment is updated in place, so it shows the latest result, not the first two historical bodies.

## What the run exposed

- The first review completed with fresh full code coverage, but its prior-finding inventory was incomplete. The initial watcher rejected it. The publisher was corrected to show fresh findings with an explicit incomplete-history warning, never a clean-PR claim, and resumed the same retained operation. Subsequent plan changes then ran automatically without intervention.
- Native PR review identified missing review-scope input in the cache key and repeated collection of rejected terminal operations. Both are corrected with regression tests.
- Returned findings include duplicated retention concerns and a separate demo-deployment concern. This proof establishes evidence ingestion and re-review, not perfect finding precision or deduplication.

## Remaining boundary

Standard Atlantis comments do not necessarily expose a trustworthy commit identity. This example requires a full SHA marker from the trusted producer and a configured expected-project list. It does not solve dynamic project discovery, production hosting, or the customer's request for a first-class feature without producer/CI changes. Do not present it as that finished feature.
