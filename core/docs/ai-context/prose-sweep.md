<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->
# Reconciling prose with a landed design change: sweep, never patch

**This file is the only statement of the method.** `claude-core.md` and
[`known-failure-patterns.md`](known-failure-patterns.md) point at it; the
`prose-sweep` skill enacts it and `scripts/sweep-scope.mjs` fixes the scope.
A second copy is a second thing to drift, which is this failure one level up.

**When it runs.** A retirement: a rule replaced, a mechanism deleted, an
authority moved. A change that adds a rule without retiring one has nothing
to sweep for. **And it runs again after every batch of fixes** — each patch
seeds fresh instances of the class it patched (two of twenty-seven in the
2026-09-20 run were sentences written in the two preceding batches), so a
sweep that is not cheap enough to re-run is always one batch behind.

---

## Why patching fails, measured

AI-Handbook #96 replaced the review loop's binding-disposition and
critical-only model. The mechanism landed; the prose did not follow. Three
author-side reconciliations each declared the class closed and each missed
instances the next reader found — 4, then 3, then 3 — and a fourth pass by
four cold readers found 27 more in 13 files after the class had been closed
three times.

**The comfortable diagnosis is wrong.** The residue does not sit somewhere
unexpected. Every known miss was within a screen of an edit the author had
just made; one was a context line inside the previous sweep's own diff hunk.
Predicting *where* to look is not what was missing.

**Three things were.**

1. **A phrase list is the wrong index.** Patching hunts the face of the class
   the author has already seen, and an entire opposite face — "to
   convergence" against "one triage" — goes untouched. A phrase list built
   from what you have seen cannot contain what you are about to write.
2. **The class has several sub-shapes, and one of them carries none of the
   class's vocabulary.** For "when a loop stops": a cap; a write with no
   review after it; an artifact class selecting loop *length*; and unbounded.
   Four instances in one skill file were found only because the second shape
   was written into the brief.
3. **The author reads a stray clause of the old model as consistent, because
   they know what was meant.** That is a property of the reader, not the
   method. A further method run by the same reader has a poor prior whatever
   its shape; the author's index is their memory of what they wrote, and
   that is the index that fails.

---

## The spec: what a sweep is given

Four inputs, written before any file is opened. The script refuses a spec
missing any of them.

- **The rule** — one sentence naming what is being swept for, by meaning.
- **Its home** — the one file (and section) whose statement is authoritative.
  Everything else may only *cite* it.
- **Sub-shapes, as a closed list** — the distinct forms an assertion of the
  retired rule takes, enumerated by *shape*, never by wording, with one
  example each. Expect three to six; one is always an undercount. A reader
  may add a shape mid-sweep, and a shape added by a reader is worth more than
  the instance that prompted it.
- **Not-in-class, as an explicit list** — what a reader must *not* return.
  Without it, readers return the repository's entire history section. This
  list is as load-bearing as the class: it is the only part of the output that
  can detect a bad class definition, so the readers' declined candidates are
  audited against it (below), and a live mechanism the class's wording would
  catch is named here rather than left to a reader's charity.

## The checkable property is structural, not lexical

The test that found 27: **does any file other than the rule's home make a
statement *about* the rule, rather than pointing *at* it?** A file can be
wrong by omission — state correctly what ends a loop and never name the rule
that does — and no grep finds that, because there is no wrong phrase. The
briefs the review loop's own advisors read every round were exactly that
case. So a reader's question per file is *asserts or cites*, and the fix for
an assertion is a citation of the home, never a better restatement: a correct
restatement is a fresh copy that will drift, and two of the 2026-09-20 hits
were correct restatements written in the preceding batch.

## Scope is the whole payload, never the files under edit

Of 13 files carrying instances, 4 were touched by the change that created the
rule; 12 instances were in files no diff-derived list would name. The scope
is therefore the whole payload by default, and **includes the directories a
docs-shaped scope misses**: `.agents/roles/**`, `.claude/agents/**`,
`.agents/memory/**`, and the root `CLAUDE.md`, `AGENTS.md` and `README.md`.
Two of the highest-consequence instances were in the role brief and the agent
definition the two assessors read verbatim on every round. The scope is
enumerated by `scripts/sweep-scope.mjs` from the tracked set, so it cannot be
narrowed by hand or by ignore rules.

## Cold readers, two reading modes, each declared

A reader who did not write the new model reads against the whole list, not
the shape its section is about. Readers are fanned out by directory, each
holding no author context. A full read of everything is unaffordable, so two
modes exist and **each reader declares which it used per file**:

- **Read in full** — the rule's neighbourhood, named in the spec.
- **Swept** — opened by heading and front-matter, searched by the class's
  vocabulary *in context*, escalated to a full read on any hit.

The declaration (`OPENED n / READ IN FULL n / SWEPT n`, then the per-file
mode) is what lets a human distinguish a clean file from an unread one.
Without it a silent file and an unvisited file look identical.

## What a reader returns

**Per candidate:** `path:line`; the sub-shape; the sentence **verbatim**; why
a reader of that file goes wrong; and a confidence of `high`, `medium` or
`low`. Confidence survives to the report and is never thresholded away: the
2026-09-20 split was 5 high / 14 medium / 8 low, and a low-confidence hit in
an assessor brief was still worth a human's eye because the file never named
the rule. A tool that returns only `high` returns 5 of 27.

**Per reader:** the inventory declaration above, and **every declined
candidate with the exclusion that resolved it**. Declined candidates are
mandatory, not a courtesy: they are how the author audits whether the
not-in-class list is swallowing real hits.

## After the run

The author verifies each candidate in the checkout before writing anything;
a reader's quote is a claim, not a finding. Residue is fixed by citing the
home. History — a sentence naming the retired thing *as* retired, with its
replacement — stays. The record goes in the PR body: the spec as swept, the
inventory, what was fixed, and what was declined with its exclusion, so the
next sweep is re-run rather than re-invented. Then the sweep runs again over
the batch.

**Anti-goal: this is not a phrase checker.** The class was un-greppable in 12
of 27 cases, including all three of the highest-consequence ones. Grep is a
cross-check for a reader, never the method.

---

## Worked instances

### The #96 / #134 review model (AI-Handbook #121, PR #141)

Six propositions, of which (e) and (f) were added by cold readers mid-sweep
and (e) was proposed independently by three of six:

| | Retired proposition |
|---|---|
| a | A judge whose verdict binds |
| b | A tier or artifact class that selects a strictness, rubric or threshold |
| c | A fixed reply form or length for a decline |
| d | An expected decline or fix rate |
| e | A loop bounded by a *retired* count or mechanism: the self-policed apparatus deleted 2026-08-20 (criticality gate, finding-count trend, plan-growth tripwire, oscillation diagnosis); the per-PR round budget with its receipts, extension grants, round-count cache and readiness receipt (#89 cut); and "convergence" as the exit condition |
| f | A plan review that opens a branch and a PR |

**Not in class**, and this list was missing from the first run — round 1 of
#141 found that (e) as first written would have caught live safeguards: the
six-hour stop that asks David to resume; pre-registered flip conditions;
the ship gate; no-re-request-without-a-behavioural-change; and the docs-only
depth rule, which governs what a reviewer *raises* and survived #96.

**The control.** Three instances were known before the run and withheld from
the readers. All three came back, from three different readers.

**What the first run got wrong, and the second constraint set fixed.** Its
file set was the issue's, not the payload's, so the two assessor briefs, the
`document` skill and `documentation-workflow.md` were never opened and all
four carried the class. Its brief enumerated propositions, not sub-shapes,
so "a write with no review after it" was never hunted. Its readers had a
binary `BORDERLINE` where a confidence band belonged. Every one of those is
now a rule above.
