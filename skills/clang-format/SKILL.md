---
name: clang-format
description: Use when a PR changes C or C++ formatting governed by clang-format or .clang-format, including indentation, braces, spacing, alignment, include ordering, line breaking, macro-sensitive layout, or formatting-only review.
---

# clang-format

Review C and C++ formatting from the unified diff and the repository's committed `.clang-format` policy. This skill is an LLM review lens, not a formatter execution workflow.

## Boundaries

- Formatting review covers layout and clang-format behavior only. Do not report correctness, safety, security, API, or architecture findings unless the user separately asks for semantic review.
- Read the changed file and the repository's `.clang-format` before judging style. The project configuration is authoritative over bundled templates.
- Do not replace an existing project configuration with a template unless explicitly requested.
- Do not run tools or claim that a formatter was executed. Review only changed lines and the context needed to establish the rule violation.
- Preserve generated, vendored, excluded, or intentionally unformatted code. Check `.clang-format-ignore` and local project guidance.
- Treat bundled templates and integrations as reference material, not evidence that a changed line is invalid.

## Route the request

1. Existing configuration analysis or formatting-only review:
   - Read the authoritative config and the changed diff.
   - Match the changed line to a rule in the **Rule index** below.
   - Report only violations that can be proven from the diff and rule text.
2. New configuration:
   - Confirm no authoritative project config already exists.
   - Select the closest file under `assets/configs/`, then make minimal overrides.
   - Validate the proposed config change by reasoning through representative changed constructs. Do not claim execution.
3. Configuration change:
   - Read the current config and identify the smallest option change.
   - Check version compatibility in `references/complete/clang-format-style-options.md`.
   - Compare the changed construct with the configured rule. Do not propose repository-wide reformatting.
4. Troubleshooting:
   - State that runtime confirmation is outside this skill. Use the configured option and changed code as evidence.
   - Consult `references/cli-usage.md` and the relevant option guide only for interpretation.
5. Editor or git integration:
   - Review examples under `assets/integrations/`.
   - Adapt them to the repository instead of installing or copying them blindly.

## Option navigation

- Alignment: `references/01-alignment.md`
- Line breaking and wrapping: `references/02-breaking.md`
- Braces: `references/03-braces.md`
- Indentation: `references/04-indentation.md`
- Spacing: `references/05-spacing.md`
- Include handling: `references/06-includes.md`
- Language-specific behavior: `references/07-languages.md`
- Comments: `references/08-comments.md`
- Penalties and advanced options: `references/09-advanced.md`
- Working examples: `references/quick-reference.md`
- CLI details: `references/cli-usage.md`
- Complete CLI reference: `references/complete/clang-format-cli.md`
- Complete style-options reference: `references/complete/clang-format-style-options.md`

## Repository-specific review guidance

- The repository's `.clang-format` is authoritative for reviewed C and C++ files. Inspect it rather than substituting `assets/configs/linux-kernel.clang-format` or another generic template.
- For macro-heavy C, include representative headers and source files with `ForEachMacros`, `IfMacros`, `AttributeMacros`, and `WhitespaceSensitiveMacros` behavior when validating configuration changes.
- Respect `// clang-format off` and `// clang-format on` regions. Do not remove markers or treat intentionally preserved layout inside them as a formatting defect.
- Validate a focused change on representative files and inspect the diff for macro damage, preprocessor movement, include changes, and excessive churn.
- In Qodo review, report formatting findings only when they are in scope and supported by the authoritative config. Route semantic C concerns to the appropriate semantic review skill instead of attaching them to clang-format findings.

## Finding contract

Every finding must include all of these fields:

- `Rule ID`: the stable ID from the Rule index, such as `CF-001`.
- `Rule text`: the exact configuration line or rule text quoted below.
- `Evidence`: changed file path and changed line. Never invent a line number.
- `Reason`: why the changed text violates that rule.
- `Fix`: the smallest source change that restores compliance.

If no Rule ID and exact Rule text can be established, do not report a clang-format rule violation.

## Rule index for the Zephyr configuration

These IDs are a local review adaptation because the source `.clang-format` has no rule IDs.
The quoted text is the source rule text and must be preserved in findings.

- **CF-001**: `BreakBeforeBraces: Linux`
- **CF-002**: `ColumnLimit: 100`
- **CF-003**: `ContinuationIndentWidth: 8`
- **CF-004**: `IndentCaseLabels: false`
- **CF-005**: `IndentGotoLabels: false`
- **CF-006**: `IndentWidth: 8`
- **CF-007**: `InsertNewlineAtEOF: true`
- **CF-008**: `SpaceBeforeParens: ControlStatementsExceptControlMacros`
- **CF-009**: `SortIncludes: Never`
- **CF-010**: `UseTab: ForContinuationAndIndentation`
- **CF-011**: `ForEachMacros` includes the project macro being reviewed.
- **CF-012**: `IfMacros` includes `CHECKIF`.
- **CF-013**: `WhitespaceSensitiveMacros` includes `COND_CODE_0`, `COND_CODE_1`, `IF_DISABLED`, `IF_ENABLED`, `LISTIFY`, `STRINGIFY`, `Z_STRINGIFY`, and `DT_FOREACH_PROP_ELEM_SEP`.

Do not infer a formatting violation solely from a generic preference. Cite one of these IDs and its exact text.

## Review scope

Review only changed C/C++ lines and necessary context. Respect `clang-format off/on`, generated or vendored paths, and macro-sensitive constructs. Do not claim that a candidate is confirmed when the diff does not show the relevant formatting.

## Bundled resources

Seven configuration examples are under `assets/configs/`:

- `assets/configs/google-cpp-modified.clang-format`
- `assets/configs/linux-kernel.clang-format`
- `assets/configs/microsoft-visual-studio.clang-format`
- `assets/configs/modern-cpp17-20.clang-format`
- `assets/configs/compact-dense.clang-format`
- `assets/configs/readable-spacious.clang-format`
- `assets/configs/multi-language.clang-format`

Integration examples are:

- `assets/integrations/pre-commit`
- `assets/integrations/vimrc-clang-format.vim`
- `assets/integrations/emacs-clang-format.el`

## Reporting

State the authoritative config, changed file and line, Rule ID, exact Rule text, evidence, and fix. Do not claim that clang-format or another CLI ran. Separate formatting findings from semantic review.
