# Receipts — this repository's own

The budgets, extensions and round-check receipts for **AI-Handbook's own**
review loops. Not payload: the copy under `core/.agents/receipts/` is what a
consumer receives, and nothing here travels.

Until the bootstrap this directory did not exist, and the machinery resolved
its root as `core/` — so the handbook's own receipts would have been written
*inside its own payload*, where a sync would carry one repository's review
history to every other. Root resolution now finds the directory that declares
`.agents/machinery.json`, which is this one.

**What the files mean, what is committed and what is ignored, and why rounds
are counted rather than tallied:** [`core/.agents/receipts/README.md`](../../core/.agents/receipts/README.md).
That document is the shared one; this file exists to hold the directory open
for the committed ref the guard reads, and to say which of the two you are
looking at.
