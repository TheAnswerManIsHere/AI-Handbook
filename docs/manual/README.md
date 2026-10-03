# The AI-Handbook Manual

> A living, human- and AI-readable manual for how the handbook works **and why
> it works that way** — the narrative of the development process every product
> David builds with AI agents runs on. It exists so that David, Claude, Codex
> and any future collaborator share one picture of that process, and so the
> reasoning behind each rule survives the pull requests it was decided in.
>
> **Read it front to back and you get the whole process.** The chapters follow
> one piece of work from request to merge, not the repository's directory
> layout — see *How to read this manual*.

## How to read this manual

The handbook governs one loop, and the manual follows it:

**A request arrives → it is routed → planned → built and opened as a pull
request → reviewed → closed out → and what was learned is written down for the
next request.** David asks for something; Claude decides what kind of work it
is and how much ceremony it earns; a plan is agreed with an independent
reviewer and approved by David; the change ships as a pull request; Codex
reviews it and two independent assessors advise on what is worth fixing; the
merge is verified in the running product; and the lesson lands in the durable
docs so the next session starts from it.

Chapter **1** says what the handbook is and how it reaches a product.
Chapter **2** introduces the cast. Chapters **3–7** walk the loop in order.
Chapters **8–11** cover what runs alongside every step — how Claude talks to
David, how memory and documentation work, how work is tracked, and which model
does what. Chapter **12** is the machinery underneath, last because you don't
need it to understand the process. Each chapter ends by pointing at the next,
so reading straight through works.

Dipping in for one area works too — every chapter stands on its own, and the
[glossary](./glossary.md) defines the vocabulary, which is dense.

## How this manual relates to the rest of the repository

Two layers, one truth, no forking:

- **The rules themselves** live in the payload — `core/.agents/core/` (the two
  portable cores), `core/docs/ai-context/` (the shared contracts),
  `core/.claude/skills/` (the procedures), and `core/scripts/` (the machinery).
  They are dense, agent-facing and loaded into a session's context; they ship
  to every product.
- **`docs/manual/`** (this directory) is the *narrative* — chapters a person
  can read without opening a contract: what each part of the process does, how
  it feels from David's side and from Claude's, and the reasoning behind it.

The manual **links to the rules; it never restates them.** A rule lives in
exactly one place, and that is never here. When a chapter needs the precise
wording of a rule it links to it; when it explains a rule it explains the
*job* the rule does and *why*, in words that would survive the rule's exact
phrasing being edited.

**The manual does not ship.** It lives at the repository root, outside
`core/`, so the sync never copies it into a product. Every product already has
its own `docs/manual/` about itself, and a product's agents get the handbook's
rules directly from the payload. This manual is for whoever needs to
understand the handbook as a system — chiefly David.

### Name the rule; don't restate its tuning

Some rules carry a number in their name — the *two-review limit*, the
*six-hour* stop on a review loop. A chapter may use the name, because that is
what the rule is called. What a chapter does not do is restate the rule's
exact thresholds, lists or conditions as though it were the source: those
change by pull request, and a second copy is a copy that drifts. The test,
borrowed from the Overhype.me manual: **could the rule's home be edited —
a threshold moved, a condition added — without making this sentence wrong?**
If not, the sentence belongs in the rule's home, and the chapter links to it.

## How the manual grows

This first version was written in one pass (David, 2026-10-03), the same way
Overhype.me's manual was backfilled once. From here on it grows incrementally.

**The handbook's version of the documentation ceremony is different from a
product's.** The fleet contract
([`documentation-workflow.md`](../../core/docs/ai-context/documentation-workflow.md))
gives process pull requests no harvest, because in a product the process is
not the product. Here the process *is* the product, so this repository keeps
its own rule, stated in its [`CLAUDE.md`](../../CLAUDE.md): **the handbook's
`/maintenance` pass reads the pull requests merged since the last pass and
updates the chapters they touched.** Nothing about this ships to a product.

Chapters describe the process **as it is now**. History lives in git and in
the dated notes inside the rules themselves — no changelog sections accumulate
here. A chapter may say *why* a rule replaced an earlier one when the earlier
one is what makes the present rule make sense; it does not keep a timeline.

## Chapter quality bar — no empty chapters

A chapter file exists **only** when it holds meaningful present-tense content
across the template below. The Contents table may list a planned chapter as
*not yet written*; the file appears only once there is real content to fill
it.

## Chapter template

Every chapter follows this shape:

1. **What it does** — the area's job, in plain terms.
2. **How it works** — what David sees, what Claude does, and a plain-language
   sketch of any machinery underneath.
3. **Why it works this way** — the reasoning: the constraint, the failure that
   prompted it, the alternative that was tried or rejected.
4. **Boundaries & known limitations** — what it deliberately does not do, and
   the known rough edges.
5. **Going deeper** — links to the rules in the payload, and only stable,
   high-value file entry points. A chapter is narrative, not a file map.

Style: written for a smart reader who has never opened the repository. Plain
sentences over jargon; explain the *why*, not just the *what*. A claim the
author could not check is marked **Needs David confirmation** rather than
stated as fact.

### Link each glossary term once per chapter

The **first** time a chapter uses a term defined in the
[glossary](./glossary.md), it links to that term's anchor:

```markdown
the [oracle](./glossary.md#oracle) the reviewer judges against
```

**First occurrence only** — later mentions stay plain text. This matters most
for ordinary words that mean something specific here: *oracle*, *payload*,
*overlay*, *round*, *finding*, *ceremony*, *phase*, *tier*, *class*. Several
of those name more than one thing — a *bugfix tier* is not the *internal
tier* — so link the sense the sentence means.

Glossary anchors come from its `###` headings, so renaming a heading breaks
every link into it. Rename deliberately and update the chapters in the same
commit.

**Citing a file:** use a repository-relative path —
`core/docs/ai-context/working-modes.md`, not a bare `working-modes.md` — so a
reader can find it and a link checker can check it.

## Contents

In reading order. A chapter file appears only once it holds real content, so
*not yet written* rows are honest gaps rather than placeholders.

| # | Chapter | Covers | Status |
| --- | --- | --- | --- |
| 1 | [`1-what-the-handbook-is.md`](./1-what-the-handbook-is.md) | What the handbook is, the core/overlay split, how the sync carries it into a product and takes back what it stops shipping | ✅ written |
| 2 | [`2-who-does-what.md`](./2-who-does-what.md) | David, Claude, Codex, Astra, Fable and Replit — what each is for and what each may decide | ✅ written |
| 3 | [`3-routing-a-request.md`](./3-routing-a-request.md) | **Route** — feature, bugfix or prototype; how much ceremony a change earns; the Trivial and Documentation classes | ✅ written |
| 4 | [`4-planning.md`](./4-planning.md) | **Plan** — the pre-plan conversation, the plan, Astra's review, the scope gate and David's approval | ✅ written |
| 5 | `5-opening-a-pr.md` | **Build** — branches, the PR body and its oracle, the server-side rulesets | not yet written |
| 6 | `6-the-review-loop.md` | **Review** — Codex, shared judgement, the Worth rule, the two-review limit, the ship gate, translation | not yet written |
| 7 | `7-close-out.md` | **Close out** — the merge bar, the Repl sync, post-merge verification, UAT | not yet written |
| 8 | `8-talking-to-david.md` | Banners, notifications, numbered questions, quoting — how Claude communicates | not yet written |
| 9 | `9-memory-and-documentation.md` | **Remember** — Type 1 and Type 2 documentation, memory notes, handoff, prose sweeps | not yet written |
| 10 | `10-tracking-work.md` | Workstream issues, `/status`, `/next`, `/maintenance` | not yet written |
| 11 | `11-models-cost-and-routing.md` | Which model does what, subagent routing, and what a loop costs | not yet written |
| 12 | `12-the-machinery.md` | The scripts, the CI checks, the settings template, and how skills and agents are wired | not yet written |

**This table is the source of truth for chapter numbers**, and the number
appears in two other places that must agree with it: each chapter's own
`# Chapter N · Title` heading, and the `**Next:** chapter N — …` footer of the
chapter before it. Inserting or reordering a chapter renumbers a run of files —
do it in one commit, and check the footers, which are the easiest to miss.

Deliberately **not** written anywhere: "chapter N **of 12**." A total restated
across twelve files goes stale the moment a chapter is added.

## Outside this manual

This manual covers the **process**. Some things deliberately live elsewhere —
named here so their absence reads as a decision rather than a gap:

- **How to enroll a product** — [`docs/consuming-repos.md`](../consuming-repos.md),
  the step-by-step a new consumer follows.
- **Deciding where a rule belongs** — [`docs/porting-notes.md`](../porting-notes.md).
- **Research and pilots** — [`docs/research/`](../research/).
- **Each product's own manual** — in that product's repository, about that
  product.
- **The rules themselves** — the payload under [`core/`](../../core/), which
  these chapters link into rather than restate.
