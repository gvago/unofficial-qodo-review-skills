# Atomic rule checklist

A rule is portal-ready when a reviewer (human or LLM) can look at a diff and
answer "violated: yes or no" without judgment calls. Use this checklist on
every candidate rule before it goes in the output file.

## The checklist

A rule is atomic and detectable when ALL of these hold:

1. **One violation.** Exactly one way to break it. If you can imagine two
   distinct violating code patterns that break different clauses, split it.
2. **Observable in code.** The violation is visible in source text or a
   diff. No intent, taste, or runtime knowledge required.
3. **Imperative and specific.** Starts with a verb, names the concrete
   construct: function names, macro names, return values, header order.
4. **Self-contained.** Understandable without reading the rest of the
   document. No "as above" or "see section 3".
5. **Falsifiable.** You can write a minimal code snippet that clearly
   violates it and one that clearly complies.

Fails any item: either split it (item 1), rewrite it (items 3, 4), or move
it to the not-enforceable list (items 2, 5).

## Not enforceable, common shapes

- Pure aspiration: "be readable", "write clean code", "use common sense".
- Unbounded judgment: "keep functions short" with no number, "avoid
  excessive nesting" with no depth.
- Process, not code: "discuss large changes with the team first".
- Runtime-only properties: "the code must be fast", "avoid memory leaks"
  stated without a detectable code pattern.

A judgment rule becomes enforceable the moment the source gives a number or
a concrete pattern. "Keep functions short" is out; "functions must not
exceed 60 lines" is in. Never add the number yourself; that would invent a
rule.

## Five worked examples

### 1. Compound statement, split it

Before (prose):

> Functions should use snake_case and macros should be UPPER_CASE, and
> neither should start with an underscore.

After (three atomic rules):

- Name functions in snake_case.
- Name macros in UPPER_CASE.
- Do not start a function or macro name with an underscore.

Why: three distinct violating patterns (a CamelCase function, a lowercase
macro, a leading underscore) means three rules.

### 2. Vague quantity, keep only the concrete part

Before (prose):

> Keep functions focused and short; as a rule of thumb nothing over 60
> lines, and definitely avoid doing too many things in one function.

After (one atomic rule plus one not-enforceable entry):

- Rule: Do not write functions longer than 60 lines.
- Not enforceable: "keep functions focused / avoid doing too many things"
  (no detectable threshold; the 60-line limit already captures the
  measurable part).

Why: the source supplied the number 60, so that clause is detectable. The
focus clause is judgment.

### 3. Hidden multiple violations in one sentence

Before (prose):

> Always check the return value of malloc and never cast its result.

After (two atomic rules):

- Check the return value of malloc against NULL before use.
- Do not cast the result of malloc.

Why: unchecked return and a cast are independent defects; a diff can have
either without the other.

### 4. Aspirational sentence, move it out

Before (prose):

> Code should be self-documenting and easy for a new team member to follow.

After:

- Not enforceable: "self-documenting and easy to follow" (no code pattern
  distinguishes compliant from violating; pure judgment).

Why: fails checklist items 2 and 5. Do not manufacture a proxy rule like
"add comments"; the source did not say that.

### 5. Buried conditional, make the trigger explicit

Before (prose):

> When a header is included only for one type, prefer a forward declaration
> instead, except in public API headers where includes must be complete.

After (two atomic rules):

- In non-public headers, use a forward declaration instead of an include
  when only a type name is needed.
- In public API headers, include every header the declarations depend on.

Why: two contexts with opposite requirements. As one rule, a reviewer
cannot answer yes/no without untangling the exception; split by context and
each rule has one violation.

## Severity suggestions

Suggest, do not decree; the user tunes severity in the portal.

- **critical**: violations that cause defects (unchecked allocation,
  missing bounds check mandated by the source).
- **high**: violations the source marks must/never with correctness impact.
- **medium**: must/never statements about structure or API hygiene.
- **low**: should/prefer statements, naming, layout.

## Conflict and duplicate detection

While splitting, keep a running list of rule texts. Before finishing:

- **Identical**: same requirement stated twice, possibly in different
  words. Keep one, note the duplicate.
- **Conflicting**: two rules that cannot both be satisfied on the same
  code (e.g. "braces on the same line" and "braces on the next line").
  Output both, flag the pair, let the user pick.
- **Overlapping**: one rule is a subset of another. Flag it; usually the
  narrower rule survives and the broad one shrinks.
