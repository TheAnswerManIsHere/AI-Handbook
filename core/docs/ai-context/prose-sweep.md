<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->
# Reconciling prose with a landed design change: sweep, never patch

**This file is the only statement of the method.** `claude-core.md` and
[`known-failure-patterns.md`](known-failure-patterns.md) point at it rather
than restating it. A second copy is a second thing to drift — which is the
failure this file exists to fix, one level up.

**When it runs.** A design change lands — a rule replaced, a mechanism
deleted, an authority moved — and the payload still describes the old one
somewhere. Not every edit needs this: a change that adds a rule without
retiring one has nothing to sweep for. The trigger is a *retirement*.

---

## Why patching fails, measured

AI-Handbook #96 replaced the review loop's binding-disposition and
critical-only model. The mechanism landed; the prose did not follow. Three
attempts to make it follow each missed instances the next review round found:

| Round | Method | Result |
|---|---|---|
| 3 | Grep for the retired phrases the author could recall | Missed 4 |
| 4 | Read the affected sections end to end, by decision path | Missed 3 |
| 5 | Both, plus an acceptance check | Third consecutive round of residue |

**The comfortable diagnosis is wrong.** It is tempting to conclude the residue
survives because it sits somewhere unexpected. It does not. All three of round
5's misses were within a screen of an edit the author had just made; one was a
**context line inside the previous sweep's own diff hunk**. A method that
predicts *where* to look is not what was missing.

**Two things were.** First, the retired design is never one proposition. It is
several, and each sweep hunts only the facet the last reviewer happened to
name. Second, and decisive: **the author of the new model reads a stray clause
of the old one as consistent, because they know what was meant.** That is why a
cold reader finds three per round and the author finds none after reading the
same pages end to end. **A further method carried out by the same reader has a
poor prior, whatever its shape.**

---

## The method

1. **Enumerate the retired propositions as a closed list, before reading
   anything.** Not the retired *wording* — the propositions. Each one is a
   claim the payload used to make and no longer does. Expect three to six;
   one is almost always an undercount. Anyone may add to the list, and a
   proposition added by a reader mid-sweep is worth more than the instance
   that prompted it.

2. **Bound the file set by mechanism and write it down.** Which files could
   carry a claim about this? Name them in the issue or the PR body rather than
   rediscovering them per round. The set routinely reaches outside the payload
   directory, because a repo that governs itself with the file it ships
   describes that file in its own overlay and README.

3. **A reader who did not write the new model reads each file once, end to
   end, against the whole list.** This is the step that does the work, and the
   one that cannot be delegated back to the author. A dispatched assessor with
   the list as its brief is the cheapest cold reader available; one per file
   group, in parallel, each checking every sentence against *every*
   proposition rather than the one its section is about.

4. **Grep is a cross-check, never the method.** It has failed twice here. A
   failed search supports only the scope searched, and a paraphrase forks
   exactly as well as a quotation.

### Residue or history

This repo deliberately keeps its own history, so the distinction has to be
stated or a cold reader deletes the record along with the residue:

- **Residue** — a sentence that asserts, assumes or instructs a retired
  proposition **as if it were current**. Including in a subordinate clause, a
  parenthetical, an example, a table cell, or a sentence whose subject is
  something else entirely.
- **History, which stays** — a sentence that names the retired proposition
  **as retired**, with what replaced it.
- **Borderline** — reported with reasoning, never silently dropped. Several of
  the sharpest findings arrive this way.

### The sweep is not finished until it is written down

A sweep whose record is "I checked" is one the next reader re-invents. Record,
in the PR body or the issue: the proposition list as swept, the file set, and
the passages **checked and deliberately cleared** with one line each. The last
of those is what stops the next sweep re-deriving the same three cleared
passages — and it is where a rule that *survived* the change gets its clause
saying so, so it stops looking like an oversight.

---

## Worked instance: the #96 / #134 review model (2026-09-20, AI-Handbook #121)

Re-runnable as written. The propositions:

| | Retired proposition |
|---|---|
| a | A judge whose verdict binds |
| b | A tier or artifact class that selects a strictness, rubric or threshold |
| c | A fixed reply form or length for a decline |
| d | An expected decline or fix rate |
| e | A loop bounded by a count or a mechanism rather than a judgement — the self-policed apparatus deleted 2026-08-20, the budget/receipts/ledger deleted in the #89 cut, and "convergence" as the exit condition |
| f | A plan review that opens a branch and a PR |

(a)–(d) came from the three failed rounds. **(e) and (f) were added by cold
readers during the sweep, and (e) was proposed independently by three of the
six** — which is step 1's "one is almost always an undercount", measured.

The file set: both cores, `working-modes.md`, `code-review.md`,
`known-failure-patterns.md`, the `bugfix`, `pr-watch`, `model-routing`,
`plan-review-loop` and `maintenance` skills, and this repository's own
`CLAUDE.md` and `README.md`.

**The control, and the result.** Three instances were already known and named
on #121 before the sweep ran. The cold readers were not told about them. All
three were surfaced independently, by three different readers, along with
substantially more that four previous passes had not found — including the only
text left in the payload asserting the external adjudicator still existed, and
a clause in `claude-core.md` instructing that an assessment's output was not
mine to overrule, twenty-three lines below the rule saying I decide.
`plan-review-loop/SKILL.md` came back clean, which is also a result.
