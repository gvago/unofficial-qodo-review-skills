---
name: accessibility-review
description: Use when a PR diff touches UI code - HTML, JSX/TSX, Vue/Svelte/Angular templates, CSS, or mobile view code. Enforces the WCAG 2.2 AA success criteria that are checkable in a diff - text alternatives, programmatic labels, name/role/value on custom widgets, keyboard access, focus visibility and management, autoplay media, page language and title, label-in-name, status messages - reporting per-rule per-file coverage so an unevaluated rule is never a silent skip. Skip for diffs with no user-facing UI code (backend, docs, config, build scripts).
license: Apache-2.0
metadata:
  author: PR Agent Pro Team
  variant: review
  version: 1.0.0
---

# Accessibility (WCAG 2.2 AA) review

You are reviewing a pull request in a repository that must conform to WCAG
2.2 Level AA. Apply the rules below to the changed UI code and report
coverage explicitly.

Rule criteria are derived from the W3C Web Content Accessibility Guidelines
2.2 (https://www.w3.org/TR/WCAG22/). The WCAG success criterion cited in each
rule is the authoritative wording; on any difference, WCAG wins and this
skill must be updated in the same change.

## What a diff can and cannot prove

This skill checks properties visible in source code. It must NOT claim to
verify rendered-page behavior: actual color contrast after the CSS cascade,
runtime focus order, zoom/reflow behavior, or how a screen reader announces
the result. Those need a runtime scanner (axe-core, Pa11y, SiteImprove,
Lighthouse) and human assistive-technology testing. When a finding depends on
rendered state you cannot see, say so and mark it advisory instead of
inventing a verdict.

## The rules

### A11Y-1: Text alternatives (SC 1.1.1)

- **Objective:** Every non-text content element that conveys meaning has a
  programmatic text alternative.
- **Compliant:** Meaningful `<img>`, `<svg>`, `<canvas>`, icon buttons, and
  image inputs carry an accessible name (`alt`, `aria-label`,
  `aria-labelledby`, `<title>` in SVG). Purely decorative images use
  `alt=""` or `aria-hidden="true"`.
- **Violation:** A meaningful image or icon-only control is added or changed
  with no accessible name, or a decorative image gets a redundant/noisy alt
  ("image of...", filename).

### A11Y-2: Name, role, value on custom widgets (SC 4.1.2, 1.3.1)

- **Objective:** Interactive elements expose their name, role, and state
  programmatically. Native HTML elements come first; ARIA only when no
  native element fits.
- **Compliant:** Buttons are `<button>`, links are `<a href>`, inputs are
  native controls. A justified custom widget carries the correct ARIA role,
  an accessible name, and state attributes (`aria-expanded`,
  `aria-selected`, `aria-checked`) that the code actually updates.
- **Violation:** A `<div>`/`<span>` with a click handler acts as a button or
  link without `role`, accessible name, and keyboard support; a custom
  widget's visual state changes without the matching ARIA state update.
  A custom widget that exposes an equivalent name, role, state, and keyboard
  behavior conforms; suggest the native element as advisory, not a violation.

### A11Y-3: Keyboard access (SC 2.1.1, 2.1.2, 2.4.3)

- **Objective:** All functionality is operable through a keyboard, with no
  traps and a sensible focus order.
- **Compliant:** Pointer handlers on non-native elements are paired with
  `tabindex="0"` and key handling (Enter/Space); `tabindex` values are only
  `0` or `-1`; overlays can be dismissed with Escape.
- **Violation:** A mouse/touch-only handler (`onclick`, `onmousedown`,
  hover-only reveal) on an element keyboard users cannot reach or activate;
  a widget that captures focus with no keyboard exit. A positive `tabindex`
  is a violation only when the resulting sequential focus order no longer
  preserves meaning and operability; when the order cannot be judged from
  the diff, report it as advisory for runtime verification.

### A11Y-4: Focus visibility and management (SC 2.4.7, 2.4.11)

- **Objective:** Keyboard focus is always visible and lands in the right
  place after UI transitions.
- **Compliant:** `outline: none` / `outline: 0` only appears together with a
  visible replacement (`:focus-visible` style at least 3:1 against the
  unfocused state); opening a modal/drawer moves focus into it and closing
  restores focus to the trigger.
- **Violation:** A focus outline is removed with no visible replacement in
  the same change; a modal/drawer/menu is added with no focus move, trap, or
  restore logic.

### A11Y-5: Forms, labels, and errors (SC 3.3.1, 3.3.2, 1.3.5)

- **Objective:** Every form control has a programmatic label; errors are
  identified in text and associated with the field.
- **Compliant:** Inputs have `<label for>`, `aria-label`, or
  `aria-labelledby`; error messages are rendered as text and linked via
  `aria-describedby` with `aria-invalid` set; personal-data fields carry
  `autocomplete` tokens.
- **Violation:** A form control is added or changed with no programmatic
  label (placeholder alone is not a label); validation errors are shown only
  visually (color/border/toast) with no text associated to the field; a
  field collecting personal data (name, email, phone, address, payment)
  omits its `autocomplete` input-purpose token or uses an invalid one.

### A11Y-6: Media and motion (SC 1.4.2, 2.2.2, 1.2.2)

- **Objective:** Nothing plays or moves automatically without user control.
- **Compliant:** Audio/video does not autoplay with sound, or provides an
  immediate pause/stop/mute control; auto-updating or moving content
  (carousels, tickers, animations over 5s) has a pause mechanism;
  prerecorded video offers captions (`<track kind="captions">` or a stated
  captioning pipeline).
- **Violation:** `autoplay` media without controls or muting; a carousel or
  animation with no pause; a prerecorded video containing audio added with
  no captions track and no caption story. Silent or purely visual video, and
  media that is a clearly labeled alternative for equivalent page text, are
  exempt from the captions check. If the diff cannot establish whether the
  video has audio or qualifies for an exemption, report it as advisory for
  content verification, not a violation.

### A11Y-7: Page language and title (SC 3.1.1, 3.1.2, 2.4.2)

- **Objective:** Documents declare their language and have descriptive
  titles; passages in a different language are marked. Document-level checks
  (`<html lang>`, `<title>`) apply only when the diff touches page shells,
  layouts, or document templates; the language-of-parts check applies to any
  changed content.
- **Compliant:** `<html lang="...">` present and correct; `<title>`
  describes the page; inline language changes use `lang` on the element.
- **Violation:** A page template is added or changed with a missing/wrong
  `lang` attribute or an empty/generic `<title>`; changed content introduces
  a passage in another language with no `lang` attribute on its element.

### A11Y-8: Contrast declared in code (SC 1.4.3, 1.4.11)

- **Objective:** Text contrast is at least 4.5:1 (3:1 for large text) and UI
  component/graphic contrast at least 3:1.
- **Compliant:** Color pairs whose foreground and background are both
  literal values in the changed code meet the ratios.
- **Violation:** Both colors of a pair are visible as literals in the diff
  (same rule, same component, or an explicit token pair) and the computed
  ratio fails. WCAG's own exemptions apply: disabled/inactive controls,
  logos and brand names, purely decorative or incidental text, and
  nonessential graphics carry no contrast requirement. If either side of the
  pair is not determinable from the diff (inheritance, theme variables,
  images), do NOT guess: report the pair as advisory for runtime
  verification instead.

### A11Y-9: Label in name (SC 2.5.3)

- **Objective:** For controls with a visible text label, the accessible name
  contains that visible text.
- **Compliant:** `aria-label`/`aria-labelledby` on a labeled control starts
  with or contains the visible label text.
- **Violation:** A control's accessible name omits or contradicts its
  visible label (e.g. button text "Send" with `aria-label="Submit form"`),
  breaking voice-control activation.

### A11Y-10: Status messages (SC 4.1.3)

- **Objective:** Status updates that do not take focus are exposed to
  assistive technology.
- **Compliant:** Dynamically injected status text (save confirmations,
  result counts, loading/progress, cart updates) is rendered in a live
  region (`role="status"`, `role="alert"`, or `aria-live`).
- **Violation:** Changed code adds a visual-only status message with no
  live-region or equivalent programmatic announcement and no focus move.

## How to review

1. Evaluate EVERY rule against EVERY changed UI file. Do not sample.
2. For each violation, report: the rule ID, the WCAG success criterion, the
   file and line, the exact rule text it violates, the evidence in the code,
   and a concrete fix (prefer the native-HTML fix over an ARIA patch).
3. If a rule cannot be evaluated for a changed file (binary, generated,
   non-UI), report that explicitly with the reason. An unevaluated rule is
   itself a finding, never a silent skip.
4. End with a coverage summary reporting the rule x file grid: for each
   changed UI file, which of the ten rules were evaluated and which were
   skipped and why, then the violation count. "10 rules evaluated" without
   naming the files it covered is not a coverage summary.
5. Apply a false-positive gate last, per rule:
   - `alt=""` or `aria-hidden="true"` on a genuinely decorative image is
     compliant, not a missing alt.
   - Native interactive elements (`<button>`, `<a href>`, `<input>`) already
     provide role and keyboard support; do not demand redundant ARIA on
     them.
   - A11Y-7's document-level checks fire only on document shells/templates,
     never on fragments or components; its language-of-parts check is not
     suppressed there.
   - A11Y-8 findings require both literal colors in the diff; anything less
     is advisory, clearly labeled.
   - Storybook stories, test files, and fixtures: report findings as
     advisory context, not violations, unless the file ships to users.
   Say so whenever you drop a finding, with which clause let it go.

## Using this skill as a template

Copy this directory to `skills/<your-skill-name>/` in your own repository.
Keep the structure: a one-line review-lens `description`, one section per
rule with a stable ID and the WCAG SC it mirrors, and the "How to review"
contract (full enumeration, rule x file coverage summary, per-rule
false-positive gate). If your organization targets a different conformance
level (A, AAA, EN 301 549), swap the rule set and keep the contract.
