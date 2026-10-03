# Chapter 7 · Close-out

> What happens between "the review is done" and "David can click the change in
> the running product" — the [merge bar](./glossary.md#merge-bar), the merge
> itself, the [Repl sync](./glossary.md#repl-sync) that follows every merge,
> the [post-merge verification](./glossary.md#post-merge-verification) run in
> the live environment, the report that hands the turn back to David, and the
> [UAT](./glossary.md#uat) he runs afterwards. Close-out belongs to Claude end
> to end: no pull request waits for David's click.
>
> Deep rules: [`claude-core.md`](../../core/.agents/core/claude-core.md),
> *Close-out is mine, end to end*;
> [`pr-docs`](../../core/.claude/skills/pr-docs/SKILL.md) (what a feature PR
> must carry before it is done); [`uat`](../../core/.claude/skills/uat/SKILL.md)
> (running the acceptance test with David).

## What it does

A merged pull request is not a shipped feature. Each product runs from a Repl
that tracks `main`, so code sitting on Claude's branch exists nowhere David
can use it. **Merging is what makes the work testable**, and close-out is the
sequence that gets it there safely and proves it arrived: check the merge bar,
merge, bring the running environment up to date, run the checks only that
environment can run, write down what was decided, and tell David exactly what
to go and try.

It is also where a [workstream](./glossary.md#workstream) ends. If no UAT is
owed, nothing remains for anyone to verify once the sync is confirmed, so the
workstream's issue is closed in the same pass. If one is owed, the issue stays
open until David's run is accepted.

Production is a different thing again. Publishing the app to real users is a
separate, explicitly requested action and never part of close-out.

## How it works

### The merge bar

Before anything merges, four things must be true for the
[standard loop](./glossary.md#standard-loop): CI is green; a
[Codex](./glossary.md#codex) review has come back for the exact commit that
would merge; every review thread is resolved; and every
[round translation](./glossary.md#round-translation) that was owed has been
delivered to David. Chapter 6 explains why each of those exists; close-out is
where they are read together, by eye, immediately before the merge.

Three exits from the standard loop carry their own, lighter bars — a
[Trivial](./glossary.md#trivial) change David declared, a
[Documentation-class](./glossary.md#documentation-class) change, and a feature
in [prototype phase](./glossary.md#prototype-phase). Their exact conditions
live in the core and in
[`working-modes.md`](../../core/docs/ai-context/working-modes.md); what they
share is that each still requires green CI.

Two subtleties are spelled out because they have bitten before:

- **Only a review of the head that would merge counts.** A review of a commit
  Claude has since pushed past did not review the diff that is about to land.
  The core names exactly which signals count as "the review returned" — and a
  thumbs-up reaction is explicitly not one, because it carries no author, no
  time and no commit, and so cannot say what it approved.
- **Two things nothing proves mechanically.** That every requested review
  round actually came back, and that the pass being read covers the head that
  would merge. Both are Claude's to check by eye.

GitHub enforces one of the four itself: the `main`
[ruleset](./glossary.md#ruleset) requires every conversation to be resolved,
so the Merge button simply does not work while a thread is open.

### The sequence

Once the bar is met, Claude runs the same short sequence every time:

1. **Re-read the live pull request** immediately before merging — a fresh
   read, not the green state remembered from twenty minutes ago. If anything
   moved, the bar is re-checked.
2. **Squash-merge.** Every merge is a squash-merge, whoever performs it, so
   `main` gets one commit per pull request.
3. **Sync the Repl and confirm it.** Claude asks Replit to pull the new
   `main`, then confirms two separate things: the Repl is on the new commit,
   *and* its working copy is clean. Neither check substitutes for the other.
   If it has not landed after a few tries, Claude reports a sync problem
   rather than waiting indefinitely.
4. **Run the post-merge verification**, if the pull request's body has one
   with real content (below).
5. **Post the [harvest-notes comment](./glossary.md#harvest-notes-comment)**
   on the workstream issue, for a product feature in
   [production phase](./glossary.md#production-phase).
6. **Send the merge report** to David, with a push notification.

The merge report carries both commit identifiers, the verification results,
the line naming any latitude the change grants Claude (chapter 5), and the UAT
handoff — what to go and click, plus the reminder that `/uat` will walk him
through it. For a prototype-phase change it says instead that the head is on
`main` and unpublished, and which questions the version is meant to answer.
**Nothing follows the merge report**: it is the message that hands the turn
back.

### Post-merge verification: the checks only the live environment can run

A production-phase feature's pull request carries a *Post-merge verification*
section, written alongside the code and reviewed with it in the same Codex
pass. Its job is narrow: check what **only the running environment** can
check — that a migration actually applied to the live database, that the app
behaves correctly against real configuration. It never re-runs suites CI
already ran, and "none needed" is the right content for a change with nothing
environment-specific.

David never runs commands, so this section is how any command a change needs
reaches the environment. Claude runs it through the Replit connector at
close-out in two calls — one that asks Replit to run the named checks under an
explicit read-only instruction, then, a few minutes later, one that asks for
the results — and reports pass or fail in the merge report. A failure keeps
the workstream at its verification stage while the fix goes through the
normal channel.

The format of the section and what earns a check are set by each product's
`docs/tests/test-run-contract.md`, in that product's repository.

### The UAT: where David checks the change is *right*

For a product-visible feature in production phase, the pull request also
ships a UAT document — a click-through acceptance script — added to the same
pull request before it merges. After the sync, David runs it, but not alone:
`/uat` turns the document into a conversation. Claude does the setup (seeding
data, putting configuration in a known state, confirming the app is up),
presents one step at a time, records each result, and puts back everything it
changed — including before a pause, since a paused run can sit for days.

When a step fails, Claude captures the exact evidence, files the bug while the
context is fresh, records the way back to this run on the workstream, and asks
David whether to continue or pause. It does not diagnose the bug inside the
UAT session; diagnosis belongs to a bugfix session with a real branch and a
real review.

When David confirms a run complete, Claude deletes the UAT document in the
same close-out — so a UAT file still present on `main` always means a run
still owed. The one reason to keep one is that it is the only written
description of some behaviour, and then that description is harvested into
the product's manual first.

### Closing the workstream

**Close-out is a moment, not a resting state.** Whoever moves a workstream to
close-out finishes what remains — the harvest-notes comment, anything else its
issue lists — then marks it done and closes the issue in the same pass,
naming the pull request that did the work. A workstream waits at close-out
only while a named item genuinely cannot be finished yet. The full rules are
in [`workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md),
*Closing an issue*, and chapter 10.

### When something goes wrong after the merge

- **A failed UAT is a follow-up pull request, not a crisis.** Claude fixes
  forward on a fresh branch. A revert is only for a `main` that is actually
  broken.
- **A Codex outage is a full stop.** If Codex's code review is genuinely
  down — not the separately metered security-review limit — Claude stops
  building production-phase code, tells David at once with a
  [blocking ask](./glossary.md#blocking-ask) naming which pull requests are
  stuck and where, and waits. Noticing that Codex has recovered is not
  permission to restart. Prototype-phase work owes no Codex review, so it
  carries on.

## Why it works this way

- **CI and Codex catch *broken*; David's UAT catches *wrong*.** The merge bar
  is entirely automatic and agent-checked because it guards against defects.
  Whether the change does what David meant is a different question, answered
  by David in the running product — which is why the merge exists to make the
  change testable rather than to declare it finished.
- **No pull request waits for David's click.** There used to be a carve-out
  holding back changes that widened Claude's own guardrails or authority until
  David merged them himself. It was retired (David, 2026-09-14) because the
  click was never once withheld, it cost a round trip every time, and
  everything here is reversible. What replaced it is visibility rather than
  another gate: the pull request body and the merge report each name the
  latitude a change grants, so a widening is *read* rather than clicked
  through. The one pull request that still comes to David is a change to the
  review loop that still carries findings after its second review (chapter 6).
- **The Repl syncs after every merge, with no exceptions Claude reasons its
  way into.** "The project is paused", "this change has no product surface",
  "it will catch up next time" — each is a reasonable judgement about one
  commit, and drift is the sum of all of them. A Repl left far enough behind
  stops being a sync and becomes a pile of merge conflicts, while syncing a
  commit that did not need it costs nothing. The rule exists because Claude
  once skipped it on a settings-only merge and explained why (David,
  2026-09-04).
- **Two checks on the sync, not one.** Being on the right commit does not
  mean the working copy is clean, and a clean working copy can sit on the
  wrong commit. Either failure leaves David testing something other than
  what merged.
- **Verification is written with the diff.** The checks used to ship as a
  separate test-run file with its own lifecycle. Moving them into the pull
  request body means Codex reviews them in the same pass as the code they
  check, and Claude executes them at the moment they are meaningful.
- **No receipt proves the bar.** A script that minted a merge-readiness
  receipt was removed in [the #89 cut](./glossary.md#the-89-cut) after it
  never once ran in the loop it was built for. The four items are reads
  Claude does; the one that GitHub can enforce, it does.
- **The UAT is a conversation, not a document.** David used to keep his own
  place in a markdown file in one window and the app in another. Now Claude
  owns setup, the place, the record and the bug intake, and David does only
  the judging. Deleting a finished document keeps the folder honest: anything
  left in it is a run still owed.
- **A Codex outage stops work rather than being worked around.** Codex's
  review of product code is David's safety net. Continuing to build without
  it would mean either merging unreviewed code or piling up unreviewed work —
  so the safe response is to stop and tell him.

## Boundaries & known limitations

- **Close-out never publishes.** Publishing to production is David's, per
  use, every time.
- **The bar is read by eye.** Nothing mechanical checks that every requested
  round returned or that the review covers the merging head; the core names
  both as Claude's to check, and that is the whole defence.
- **Codex's clean-pass signals have changed shape before.** A review Claude
  cannot recognise is treated as a parser that has fallen behind, not as proof
  no review ran — and a genuinely new shape goes to David rather than into a
  guess.
- **Setup Claude cannot do falls to David.** Claude holds no admin session in
  a product, so admin-gated UAT setup is handed to David as exact click steps.
- **Bugfix pull requests do not inherit the verification-plus-UAT pairing.**
  Their documentation is set per [bugfix tier](./glossary.md#bugfix-tier) in
  [`working-modes.md`](../../core/docs/ai-context/working-modes.md); a fix may
  ship neither half and still close.
- **In this repository** there is no product and no database, so nearly
  every pull request owes no UAT and closes its workstream at close-out
  ([`workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md)
  says as much of AI-Handbook).
  Whether a Repl tracks this repository, and so whether step 3 applies here,
  is not stated in the repo's own files — **Needs David confirmation**.

## Going deeper

- The rule: [`claude-core.md`](../../core/.agents/core/claude-core.md),
  *Close-out is mine, end to end*, and *Connectors → Replit* for what the
  connector may and may not do.
- What a feature pull request owes before it is done:
  [`pr-docs`](../../core/.claude/skills/pr-docs/SKILL.md).
- Running the acceptance test:
  [`uat`](../../core/.claude/skills/uat/SKILL.md).
- How close-out moves the workstream's labels:
  [`pr-watch`](../../core/.claude/skills/pr-watch/SKILL.md), *Keeping the
  workstream issue's labels current*, and
  [`workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md).
- What the harvest-notes comment feeds:
  [`documentation-workflow.md`](../../core/docs/ai-context/documentation-workflow.md).
- How a prototype-phase merge differs:
  [`prototype`](../../core/.claude/skills/prototype/SKILL.md).

**Next:** chapter 8 — [`8-talking-to-david.md`](./8-talking-to-david.md), how
Claude communicates at every step: banners, notifications, numbered questions
and quoting.

*Verified against `118e076` (2026-10-03).*
