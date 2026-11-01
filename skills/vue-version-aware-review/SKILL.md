---
name: vue-version-aware-review
description: Review changed Vue 3 and Nuxt components against the declared Vue and compiler versions for directive scope, list identity, prop ownership, reactivity, watcher cost, lifecycle cleanup and API availability; skip non-Vue diffs and withhold version-dependent verdicts when version evidence is missing.
license: Apache-2.0
metadata:
  author: Community
  variant: review
  version: 1.0.0
---

# Vue version-aware review

Review lens only. Inspect the supplied diff and available repository source;
never execute commands, install packages, compile components or claim runtime results.
Read unchanged context only to establish a changed line's applicability. Report only
problems introduced by the diff, not a migration wish list.

## First establish the version

1. Locate the nearest owning package.json. Record the literal Vue dependency range
   and its path. In a workspace do not use an unrelated package's version. A Nuxt
   version is not a Vue version; inspect the app's resolved Vue dependency instead.
2. Read the matching package-lock.json, pnpm-lock.yaml, yarn.lock or bun lock text
   when available. Identify the importing workspace's resolved Vue, not the first
   occurrence of vue. Record the resolved version and source path. A lockfile is
   evidence of the resolution, not proof of what is deployed.
3. For compiler transforms also establish @vue/compiler-sfc (or the Vue compiler
   supplied by the app's framework) and relevant compiler options. Check
   propsDestructure opt-in/opt-out in Vite/Nuxt configuration when available.
   Runtime 3.5 alone does not prove that a 3.5 compiler transform is enabled.
4. With no lock, apply version-dependent checks only if the entire declared range
   supports the conclusion. ^3.4.0 can resolve 3.5; ~3.4.38 cannot. Do not turn a
   minimum into an exact version. For contradictory manifests/locks, missing
   compiler evidence or unresolved Nuxt dependencies, mark affected checks
   unevaluated with the missing evidence; do not guess a version or report a bug.
5. Every finding includes the declared range and manifest path, the resolved
   version/path if known, and compiler evidence when the rule depends on it.

## Complete rule index

Evaluate every rule for every changed Vue file. These are evidence-based checks,
not blanket bans on directives, destructuring or deep watchers.

| ID | Check and required evidence | Exceptions and version gate |
|----|-----------------------------|-----------------------------|
| VUE-1 | On Vue 3, v-if and v-for on the same element fail when the v-if expression reads that element's loop alias: v-if runs first, so that alias is out of scope. Cite the alias use. Move the filter into a computed list or put v-for on a wrapping template. | A condition independent of the alias is not automatically a correctness finding. A wrapper template with v-if on a child is valid. Do not apply Vue 2 precedence. |
| VUE-2 | A list that can reorder, insert or remove entries and retains component/input state needs stable unique item identity. Report missing :key or index keys only when changed code demonstrates both mutation/reordering and stateful rows. Put the key on template v-for when it owns the group. | Static stateless lists, immutable position-based lists and unique stable item IDs are not violations. Do not assume every list is mutable. |
| VUE-3 | Changed code assigning directly to a declared prop (for example props.total = next) violates the one-way prop binding. Identify the prop declaration and assignment. Emit an update event or use the declared model contract. | Assigning to a defineModel ref is supported from 3.4; it is not direct prop mutation. Nested object/array mutation is technically possible; flag it only with evidence that it violates the parent's ownership contract, not because it resembles a direct assignment. |
| VUE-4 | Destructuring a primitive from reactive(), or ordinary props outside a supported compiler transform, snapshots the value. Flag only when changed code expects that value to track subsequent changes, such as a computed or watchEffect reading it while the source is updated. Preserve a getter/property access or toRefs. | Reactive defineProps destructure in the same script setup block is enabled by default by compiler 3.5+. On 3.4 it is not enabled by default but an explicit propsDestructure opt-in can make it valid. Honor explicit opt-out on 3.5. Destructuring toRefs(), ref objects, or an intentionally one-time snapshot is valid. Destructuring a reactive object's nested object does not by itself lose that nested proxy's reactivity. Passing a destructured primitive to watch as a value instead of a getter remains invalid even on 3.5. |
| VUE-5 | A deep:true watcher traversing a demonstrably large object while the callback consumes only a narrow field is avoidable traversal. Cite the size/data path and the callback's narrower dependency, then recommend watching that field via a getter. | deep:true is valid when nested edits are the intended trigger. Do not infer production size from a variable name or flag a bounded small object. Numeric deep is a 3.5+ option, not a 3.4 fix. |
| VUE-6 | Component-owned manual listeners/timers need matching disposal when the component unmounts. Cite addEventListener/setInterval and the absent matching removeEventListener/clearInterval in the available lifecycle path. Use onUnmounted, onBeforeUnmount or a proven equivalent disposer. | Do not flag template event handlers, automatically stopped synchronous setup watchers, once-only completed timers or cleanup delegated to a shown composable/scope disposer. With incomplete lifecycle context, report incomplete coverage rather than assert no cleanup. |
| VUE-7 | New use of an API unsupported by the established version is a compatibility defect: useTemplateRef/useId need Vue 3.5+, defineModel needs 3.4+ by default. Cite the import/macro use and version evidence. Recommend an API valid on the established version. | Honor proven framework auto-imports, compatible polyfills and explicit pre-stable compiler opt-ins. Absence of useTemplateRef/useId in 3.4 is never a bug; ref-based template refs are valid. Never recommend a 3.5-only fix on 3.4. |

## Do not flag: version traps

| Evidence | Valid code or restriction |
|----------|---------------------------|
| Vue and compiler 3.4 | defineModel is stable and does not require an experimental flag. A model.value assignment is not VUE-3. |
| Vue 3.4 | ref(null) with a template ref is supported. Do not demand useTemplateRef or useId; both are 3.5+. |
| Vue 3.4 | toRefs(props) preserves reactivity. Do not demand reactive props destructure as a modernization. |
| Compiler 3.5 with default transform | const { count } = defineProps(...) remains reactive inside the same script setup. Do not apply the default 3.4 snapshot diagnosis. |
| Compiler 3.4 with explicit propsDestructure: true | Do not diagnose transformed defineProps destructure as a snapshot. Ordinary reactive() destructure is not covered by that transform. |
| Unknown version or compiler configuration | Record the uncertainty. Do not invent a compatibility finding or recommend a gated API. |

## Review contract

Evaluate every rule, include a coverage summary, only rule-backed findings get rule IDs.
For each violation give VUE-N, the exact rule clause, changed file and line,
version evidence, triggering behavior, source evidence and a version-compatible fix.
Only attach an ID when all its preconditions hold. Other concerns must not borrow
VUE IDs. Apply the exception/version gate last before retaining a finding.

Include a rule-by-file coverage grid with evaluated, not applicable or unevaluated
and a reason for each non-evaluated cell; total the confirmed violations separately.
Missing context is a coverage gap, not a violation and not a clean verdict. Do not
promise a particular rendered UI layout; use the review's available summary surface.

## Sources

These links document semantics, not runtime execution or platform proof:
- https://vuejs.org/guide/essentials/list.html#v-for-with-v-if
- https://vuejs.org/guide/essentials/list.html#maintaining-state-with-key
- https://vuejs.org/guide/components/props.html#one-way-data-flow
- https://vuejs.org/api/sfc-script-setup.html#reactive-props-destructure
- https://vuejs.org/api/sfc-script-setup.html#definemodel
- https://vuejs.org/guide/essentials/watchers.html#deep-watchers
- https://vuejs.org/api/composition-api-lifecycle.html#onunmounted
- https://vuejs.org/api/composition-api-helpers.html#usetemplateref
- https://vuejs.org/api/composition-api-helpers.html#useid
