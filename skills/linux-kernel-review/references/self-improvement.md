# linux-kernel-review: self-improvement loop

Human-gated. This loop runs in the authoring agent. A Qodo review reads the
committed version of these skills and never edits itself.

When a maintainer corrects or rejects a finding:

1. Identify which lens skill produced the finding and whether the fix is a
   rule change, a new what-not-to-flag entry, or a false-positive-guide
   addition in kernel-review-discipline.
2. On agreement, make the edit on a new branch and open it as a GitHub
   draft PR (or Gerrit WIP change) for the maintainer to review before it
   lands.
3. Append a dated line to references/memory.md recording what changed and
   why, with a link to the review change.

Never land a rule change without the review step.
