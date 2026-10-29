---
name: coordinated-config-implementation-review
description: "Use when a config or client change depends on an endpoint, configuration consumer, or interface in another repository. Inspect linked or same-ticket companion PRs before reporting missing implementation; skip changes with no cross-repository dependency."
license: Apache-2.0
metadata:
  author: gvago
  variant: review
  version: 1.0.0
---

# Coordinated config and implementation review

Before reporting that a config change has no matching implementation in another repository, check for companion PRs linked directly or through the same ticket ID. Inspect their changes and distinguish code already merged, code awaiting merge, and code not yet implemented. State any required merge or deployment order. If companion PRs are inaccessible, describe the uncertainty rather than assuming the implementation is missing.

## Evidence and boundaries

- Read the ticket and follow its repository/PR references when accessible. Search available PR metadata for the ticket ID, including open PRs; do not limit investigation to the default branch.
- Verify the actual endpoint, binding and effective consumer in companion code. A ticket reference, filename, PR title or claimed implementation is not sufficient.
- Cite the companion PR, inspected commit, path and relevant code. Record whether it is open, merged or inaccessible at review time. Do not treat open code as deployed or a later merge as historical availability.
- Preserve a concrete warning when a required contract is absent or incomplete. Distinguish that defect from an implemented-but-unmerged integration dependency. Never suppress a warning merely because a companion PR exists.
- State the conditions for safe rollout. Do not invent a strict deployment order when compatibility/defaults are unverified, and do not equate merge with deployment.
- This lens uses source and accessible review tools; it never claims to have executed a service, deployment or integration test.
