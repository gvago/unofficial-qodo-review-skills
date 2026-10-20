# Vue review evals

These are review inputs and expected outcomes, not executed review results.
Use evals.json to select each case. Preserve repository-relative paths in the prompt.

1. violations: seven rule types plus three valid Vue 3.4 version traps. Inventory
   also exercises ordinary reactive primitive destructuring separately from props.
2. clean: no rule-backed findings expected.
3. compiler-boundary: use one manifest/config pair at a time as package.json and
   vite.config.js. Never infer an owning package from the illustrative pair filename.

The violation components deliberately include a Vue 3.5-only import and an
out-of-scope template alias. A successful app build is not the expected result.
The booking input's default-value binding is an additional generic issue, not a
VUE rule. Do not attach a VUE ID to that issue. Clean inputs use :value instead.
No comments in the component sources reveal the expected rule IDs.
