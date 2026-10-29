# Review guidance

For changes that depend on an interface in another repository, consult `coordinated-config-implementation-review` at `skills/coordinated-config-implementation-review/SKILL.md`. Use the linked ticket and companion PR metadata to locate source evidence before judging missing implementation. Apply the skill's evidence and uncertainty boundaries; retain substantive integration defects. Report real rollout dependencies even when code exists in an open PR. Do not manufacture skill attribution or tool-access claims.

For a directly linked companion PR, inspect its proposed head through the available cross-repository context before asserting that a contract is missing. Cite the actual inspected source revision. An open companion is not deployed. A ticket describing how this review experiment is evaluated does not require application code to execute a review; assess application contracts, not experiment bookkeeping.

Inspect available companion source mounts (`/cross_repos/` and `__extra_repos__/`) before reporting missing source. For each changed configured contract, trace its method/path and each consumed configuration key through the actual handler. Evaluate contracts independently: one working companion handler does not satisfy another configured route. A route rejected by the dispatcher is an actionable contract defect even when another route is implemented. Cite the actual source; do not require a finding when both contracts are supported.

Use `coordinated-config-implementation-review` for this investigation and attribute only findings genuinely produced by that skill. Unrelated skill rules retain their declared language/path applicability; C/C++ formatting rules do not govern Python.

Other review dimensions remain enabled; this guidance does not waive correctness, security or existing standards.
