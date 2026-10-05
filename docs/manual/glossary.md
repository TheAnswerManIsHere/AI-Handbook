# Glossary

> Fast lookup for the handbook's vocabulary — what each term means **here**,
> with a pointer to the file where the rule or thing it names is defined. The
> glossary defines; it does not restate rules. When a term's meaning changes,
> the rule's home changes first and this entry follows.
>
> **Every term is a `###` heading**, so each has a stable anchor that the
> [manual's chapters](./README.md) link to on first use. Renaming a heading
> breaks those links — rename deliberately, and update the chapters in the
> same commit.
>
> Many entries are ordinary words that mean something narrower here:
> *payload*, *core*, *oracle*, *round*, *finding*, *ceremony*, *phase*,
> *tier*, *class*. Several name more than one thing — a *bugfix tier* is not
> the *internal tier* — so those are the entries worth reading even when the
> word looks familiar.

## Contents

- [The handbook and the sync](#the-handbook-and-the-sync)
- [People and agents](#people-and-agents)
- [Kinds of work](#kinds-of-work)
- [Planning a change](#planning-a-change)
- [Reviewing a change](#reviewing-a-change)
- [Merging and verifying](#merging-and-verifying)
- [Memory and tracking](#memory-and-tracking)
- [Talking to David](#talking-to-david)
- [Machinery and guardrails](#machinery-and-guardrails)

---

## The handbook and the sync

### Payload

Everything under the `core/` directory of this repository — the rules,
skills, agent definitions, memory notes and scripts that the sync copies into
every product. "Payload" is the shipped *content*; the repository around it
(this manual, the sync script, the checks that guard the payload) never
leaves. A file added to `core/` ships on the next sync, and a file removed
from it is taken back.
Home: [`CLAUDE.md`](../../CLAUDE.md)

### Core

Two related senses. Narrowly, **the two portable cores**: `claude-core.md`
(rules for Claude Code) and `agents-core.md` (rules for every agent), the
fleet-wide files a product's own instruction files import or link to. Loosely,
the `core/` directory as a whole, which is the [payload](#payload). Either
way, the core is owned by the handbook and is never hand-edited inside a
product; its counterpart is the [overlay](#overlay).
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Overlay

A product's own, hand-written instruction files — its `CLAUDE.md` and
`AGENTS.md` — that sit on top of the vendored core and say only what is
specific to that product: its domain, its subsystems, its environment. The
sync never touches an overlay. An overlay restating a fleet rule is a smell:
the rule belongs in the core, with the overlay pointing at it.
Home: [`docs/consuming-repos.md`](../consuming-repos.md)

### Consumer repo

A product's repository that receives the payload through the sync — the
handbook's "consumer". It owns its overlay, its product documents and the
handful of documents the payload refers to but cannot share, and it never
edits the vendored copies it receives. This repository is not a consumer; it
reaches its own payload by import and symlink instead.
Home: [`docs/consuming-repos.md`](../consuming-repos.md)

### Fleet

Every product David builds with AI agents, taken together — every consumer
repo. A "fleet rule" is one that would still be true, unchanged, in a repo
about a different product, which is the test for whether it belongs in the
core or in an overlay. "The blast radius is the fleet" is why an edit here is
weighed by everything downstream of it, not by the size of the diff.
Home: [`CLAUDE.md`](../../CLAUDE.md)

### Sync

The script that copies the payload into a consumer repo. Its rule is that
each payload file lands at the same path in the consumer, with one exception
for [seed files](#seed-file). It also deletes a consumer's copy of a file the
payload has stopped shipping, recognising that copy by its
[sync banner](#sync-banner) rather than by any record of past syncs. Not to
be confused with the [Repl sync](#repl-sync), which brings a product's
running environment up to date after a merge.
Home: [`scripts/sync.mjs`](../../scripts/sync.mjs)

### Sync banner

The `SYNCED FROM AI-Handbook` header every non-seed payload file carries in
its own text. It tells a reader in a consumer not to edit the file there, and
it is how the sync knows a file is managed and may be taken back once the
payload no longer ships it. A payload file without it could be delivered and
never removed, so a check refuses one.
Home: [`scripts/check-payload-banners.mjs`](../../scripts/check-payload-banners.mjs)

### Seed file

A payload file the consumer is meant to own after receiving it — marked by
`.template` in its name and delivered under its real name **only when the
consumer does not already have it**. The settings template and the
[machinery pin](#machinery-pin) are seeds. After seeding, the file is the
consumer's to edit; one seed can have missing keys topped up, but nothing in
it is ever overwritten. Seeds carry no sync banner, since the sync must never
take them back.
Home: [`scripts/sync.mjs`](../../scripts/sync.mjs)

### Skill

A packaged procedure Claude Code loads on demand — `/bugfix`, `/document`,
`/uat` and so on — each a folder under `core/.claude/skills/`. A skill is the
*enactment* of a rule, not its home: it points at the contract that states
the rule rather than restating it. In this repository the skills are live,
reached by a symlink per skill.
Home: [`core/.claude/skills/`](../../core/.claude/skills/)

### Agent definition

A file under `core/.claude/agents/` that defines a subagent role Claude Code
can dispatch — the Fable assessor and the round translator among them. It
fixes the role's instructions, the tools it may hold, and the model and
effort it runs at, so Claude passes only a round's coordinates rather than
writing the role's instructions itself. Its tool list is a real upper bound
on which tools the role has. Compare a [role brief](#role-brief), which is
instructions handed to a dispatched reviewer as text.
Home: [`core/.claude/agents/`](../../core/.claude/agents/)

### Role brief

The standing instructions handed verbatim to an independent reviewer on every
dispatch, kept under `core/.agents/roles/`. The review-proxy brief tells
[Astra](#astra) and the [Fable assessor](#fable-assessor) what their job is
on a review round — David's independent technical adviser, advising rather
than commanding. Unlike an [agent definition](#agent-definition), a brief
does not choose a model or bound tools; it is text the dispatch carries.
Home: [`core/.agents/roles/review-proxy.md`](../../core/.agents/roles/review-proxy.md)

---

## People and agents

### Codex

OpenAI's code reviewer, reached through its GitHub connector: it reviews a
pull request automatically when it opens and again on request, returning
[findings](#finding) as review threads with severity badges. For production
code its review is David's safety net, the one part of the loop never in
question. Its findings are weighed on their merits; its opinions on branches
and shipping mechanics carry no authority. Not the same thing as
[Astra](#astra), which runs through Codex's command-line tool but plays a
different role.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Astra

The name for whatever model the `strongestCodex` tier of the
[machinery pin](#machinery-pin) currently resolves to, run by Claude through
the OpenAI Codex command-line tool inside the session, after David signs it
in from his phone. It is the peer reviewer in the
[plan review loop](#plan-review-loop) and one of the two assessors on a code
[review round](#review-round). Both uses advise; neither decides, and
neither is the merge bar.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Fable assessor

The second independent assessment of a code review round, beside Astra's: a
Claude subagent running at the strongest Claude tier, reading the same
findings, intent and revision without seeing Astra's view. It advises like
Astra, with one extra job — a purely technical disagreement that survives
discussion is its to settle. "Fable" alone is also the Claude model David
uses for exploratory conversation; this entry is the review role, not the
model.
Home: [`core/.claude/agents/fable-review-assessor.md`](../../core/.claude/agents/fable-review-assessor.md)

### Round translation

A plain-English account of one code review round, written for David by a
separate Claude subagent that reads the round from GitHub itself and whose
words reach him unedited. It is owed on the rounds where an
independent reading is most likely to catch something, and before anything
merges; the exact triggers live in its home's rules. It holds no authority: nothing in the review or merge path
reads it.
Home: [`core/.claude/agents/fable-round-translation.md`](../../core/.claude/agents/fable-round-translation.md)

### Subagent

A separate Claude worker that Claude Code dispatches for a bounded job and
whose report it reads back. Some subagents are fixed roles with an
[agent definition](#agent-definition) (the assessors); others are ordinary
delegations of stateless work to a cheaper model. A judgement that is
Claude's own — running a review loop, verifying its own work, a harvest — is
never routed to one (a named set of independent judgements, such as the
assessments, is dispatched deliberately, at the strongest tier), every dispatch is announced, and delegation is
capped.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

---

## Kinds of work

### Workstream

One piece of work tracked end to end by **one GitHub issue**, from the first
conversation to close-out. Its labels say what stage it is in and who it is
waiting on, a project board shows them, and the PRs that serve it name it
in their body. Not every PR belongs to one: a display-only Replit tweak of
David's is recorded by its PR alone. It is how David sees where many concurrent sessions stand
without opening each one.
Home: [`core/docs/ai-context/workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md)

### Feature-building mode

The default way work runs: a pre-plan conversation, a plan reviewed and
approved before building, the build itself, review, and the verification
and UAT that follow. It covers anything that adds or changes behaviour,
including any database schema change. How much of that ceremony a given
change earns is set by the artifact, not by the phrasing of the request.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Bug-fixing mode

The path for restoring behaviour that was already agreed — entered by a
request's shape or by `/bugfix`. It drops the planning ceremony (no plan, no
plan review) but not the verification, and runs one bug per branch per pull
request. A "bug" that turns out to need a behaviour change leaves this mode
for feature-building.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Bugfix tier

The A / B / C classification inside [bug-fixing mode](#bug-fixing-mode),
chosen **after** diagnosis from what the fix touches, never from how the
symptom looked. A is a contained fix, B an elevated one that carries more
verification, and C means it is not a bug fix at all and goes back to David.
Not related to the [internal tier](#internal-tier), which says what is
downstream of a change rather than how a fix is verified.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Prototype phase

A phase David declares **per feature**, in words, for work meant to answer a
design question through his own feedback. Its first version keeps the
planning loop; after that it has no code review, tests, UAT doc or hardening
bar until he flips it to production. Each product records its features'
phases in its own repository, and a feature not listed there is in
production phase.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Production phase

The phase every feature is in unless David has declared it
[prototype](#prototype-phase) — and the safe default, since its failure is
more ceremony rather than less. Production-phase work runs the full
contract: planning, the standard review loop, verification and UAT. A
repository is never in one phase as a whole; features flip one at a time.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Ceremony

The process steps a change goes through — plan, plan review, code review
rounds, UAT doc, harvest. It scales to the artifact and what is downstream
of it, not to how the request was phrased: agent-facing prose gets far less
than product code. When the right level is unclear, the rule is to ask
rather than default upward, because over-ceremony has been the expensive
mistake.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Review class

Which review a change gets: the [standard loop](#standard-loop), or one of
the two classes that leave it — [Trivial](#trivial) and
[Documentation](#documentation-class). A Trivial PR's body quotes David's
declaration; a Documentation pass is named on its review request. A
prototype-phase feature also sits outside the standard loop, but as a
*phase* of a feature rather than a class of change.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Trivial

A review class **only David can assign**, in words, to one specific change —
his lever for quick changes. No review is requested; the PR merges on green
CI, and Codex's automatic pass is read only for a top-severity finding,
which holds the merge until David answers. Here the word is a ruling, not a
description, so Claude never calls a change "trivial" in this sense on its
own judgement.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Documentation class

The review class for a change whose substance is prose — contracts, skills,
memory notes, harvests, manual chapters. It gets one pass by Astra and the
Fable assessor against the decision the prose records, with Codex's
automatic first pass handed to both as one input, one batch of corrections,
and no Codex review round. It does not cover scripts, checks, settings,
permissions, agent role definitions or the review loop itself, even when they
are mostly words. It began as a trial with Codex left out; seven pull requests
showed each reading catching what the other missed (David, 2026-10-04).
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Standard loop

The ordinary code review loop every change runs unless it is Trivial,
Documentation, or a prototype-phase feature: Codex reviews, two assessors
advise on any findings, fixes are re-reviewed, and the merge waits for the
full [merge bar](#merge-bar). Most review rules — the write-gate, shared
judgement, translation — are rules of this loop specifically.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Internal tier

The label for changes to the agents' own tooling — scripts, skills,
contracts, process docs — as opposed to `product` or `sensitive`
(auth, payments, migrations). Since 2026-09-17 a tier says only **what is
downstream** of a change, not how strictly to read a finding. Whether a
change counts as internal for the [two-review limit](#two-review-limit) is
asked of that change, by its consequence and recoverability, not read off
its directory. Unrelated to the A/B/C [bugfix tier](#bugfix-tier).
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

---

## Planning a change

### Oracle

What a piece of work is judged against — agreed with David **before** the
work is reviewed. For a feature it is the approved plan's intent, what must
not change and the settled decisions; for a bug fix, the tier's oracle (the
reported symptom, the intended behaviour, and so on). A copy goes in the PR
body for Codex, with a one-line `Oracle source:` saying where it came from;
the assessors take it from where it was agreed, never from that copy.
Home: [`core/docs/engineering/code-review.md`](../../core/docs/engineering/code-review.md)

### Plan review loop

How a plan is developed before building: Claude and [Astra](#astra) work on
it as peers reading one contract, inside the session, with every exchange
relayed to David in plain English and the plan delivered in chat. Astra
advises; Claude states each next action; David's explicit approval is the
only thing that ends the loop. It opens no PR and publishes nothing.
Home: [`core/.claude/skills/plan-review-loop/SKILL.md`](../../core/.claude/skills/plan-review-loop/SKILL.md)

### Scope-of-work gate

David's control point at the **front** of planning: the pre-plan
conversation is compressed into a scope of work — direction, intent, what
must not change, settled decisions, the boundaries, the ceremony tier — that
he explicitly agrees to before the plan review loop opens. That agreement is
what lets the loop run without him, and it becomes the oracle the plan is
checked against. Plan approval is the matching control at the back.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Now, next, never

The shape of every mid-flight scope question: should this addition be done
**now** in the current work, **next** as its own follow-up, or **never**.
Always three options with their consequences, defaulting to next; a
two-option scope question is treated as a badly framed question. The calls
already made are part of the agreed scope of work.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Settled over dissent

The status of a purely technical planning disagreement that Claude decided
after discussion while Astra kept its own recommendation. It is recorded in
full with both arguments, so new evidence has something to argue with, and
it is named to David when approval is asked. It differs from a concern that
was resolved, and it never applies to questions of intended behaviour or
scope, which go to David.
Home: [`core/.claude/skills/plan-review-loop/SKILL.md`](../../core/.claude/skills/plan-review-loop/SKILL.md)

---

## Reviewing a change

### Review round

One pass of review over one head commit of a pull request, and everything
done in response to it. A round that comes back clean costs little; a round
that returns [findings](#finding) is the unit of spend — two assessments,
Claude's replies, possibly a translation — whatever the finding is about.
Never asked twice of an unchanged head, and always owed by a changed one in
the standard loop.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Finding

One item a reviewer raises in a round — an observation, not a verdict. Codex
marks every finding as needing revision because that is its job; whether a
finding is worth writing code for is decided separately, by the
[Worth rule](#worth-rule), and a correct observation does not by itself
justify a change. A finding names one instance; a fix owes the whole class
it belongs to.
Home: [`core/docs/ai-context/review-judgment.md`](../../core/docs/ai-context/review-judgment.md)

### Shared judgement

How a review round with findings is weighed: Astra and the Fable assessor
each assess the same findings independently, both assessments are posted on
the PR verbatim, and Claude decides from the two — investigating disputed
facts itself. Neither assessment commands; a surviving technical tie goes to
the Fable assessor, and intended behaviour stays David's. It replaced an
earlier design in which one adjudicator's verdict decided.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Write-gate

The rule that **code written is code reviewed**. After a round returns
findings, the decision is made before anything is written: if fixes are
written, another review round is automatic; if nothing is written, the loop
ends right there. So no commit in the standard loop merges unreviewed, and
every loop ends on a reviewed head.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Worth rule

The single test for whether acting on a finding is worthwhile: does it serve
the agreed outcome at a cost proportionate to what it prevents? Astra, the
Fable assessor and Claude all apply the same words, from one file, and there
is no target rate of accepting or declining in either direction.
Home: [`core/docs/ai-context/review-judgment.md`](../../core/docs/ai-context/review-judgment.md)

### Two-review limit

The bound on how long Claude may keep **editing** without David, where the
limit applies: a small, fixed allowance of reviews and corrections, after
which iteration stops — the allowance itself is stated only in its home. It caps editing, never reviewing, and
ending iteration is not "merge regardless" — a head that still falls short
goes to David with a choice. It exists because chains of individually
sensible fixes kept producing the next round's findings.
Home: [`core/docs/ai-context/working-modes.md`](../../core/docs/ai-context/working-modes.md)

### Ship gate

The point in a review loop where the question changes from "is this finding
worth fixing?" to "is the agreed oracle met at this head?". Once both
assessors say yes, findings default to recorded gaps unless they would break
the oracle or reach beyond the pull request. It exists because per-finding
filters never watched the sequence, and loops ran on over wording after the
work was done.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Flip condition

A condition written into a review request **before** the round runs, naming
what result would make Claude stop or change course. It must name something
observable off the round — a count, a kind of finding — never a judgement
Claude would make after reading it, because a condition that needs
interpreting gets reinterpreted.
Home: [`core/.claude/skills/pr-watch/SKILL.md`](../../core/.claude/skills/pr-watch/SKILL.md)

---

## Merging and verifying

### Close-out

Everything from "ready to merge" to handing the turn back to David, and it
is Claude's end to end: re-checking the live PR, squash-merging, syncing the
running environment, running the post-merge checks, posting the harvest
notes and sending the merge report. Merging is not shipping — it is what
makes the work testable; publishing to production is a separate, explicitly
requested step.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Merge bar

What must be true before a pull request merges. For the standard loop it is
green CI, a Codex review returned for the exact head commit, every thread
resolved, and the owed translations delivered; the Trivial and Documentation
classes and prototype-phase work each carry a lighter bar of their own. No
script proves it — Claude reads it off the PR — except thread resolution,
which GitHub itself enforces.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Repl sync

The close-out step that brings a product's running Replit environment up to
the new `main` commit, then confirms both that the checked-out commit matches
and that the working tree is clean. It runs after **every** merge, with no
exception Claude reasons its way into, because drift is the sum of skipped
syncs. Not the [sync](#sync), which copies the handbook into a product.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Post-merge verification

A section of a PR body listing checks that can only run in the product's live
environment — real data, live configuration — or saying explicitly that none
are needed. Claude runs them itself through the Replit connector at
close-out, since David never runs commands. What the section must contain is
defined in each product's own repository.
Home: [`core/.claude/skills/pr-docs/SKILL.md`](../../core/.claude/skills/pr-docs/SKILL.md)

### UAT

User acceptance testing: David clicking through a change in the running
product to confirm it does what was agreed — CI and Codex catch *broken*,
UAT catches *wrong*. Product-visible production-phase features (and Tier B
bug fixes with product-visible behaviour) ship a UAT doc in the same PR, and `/uat` walks David
through it step by step in chat rather than leaving him to read it alone.
The doc is deleted once he confirms the run complete.
Home: [`core/.claude/skills/uat/SKILL.md`](../../core/.claude/skills/uat/SKILL.md)

---

## Memory and tracking

### Type 1 and Type 2 documentation

The two kinds of documentation, kept on two schedules. **Type 1** is how the
agents and David work together — a new rule, a process gotcha — and is
written down the moment it is learned. **Type 2** is how the product works —
subsystem docs and manual chapters — and is written in a batched
[harvest](#harvest). Keeping them apart is what makes batching the heavy half
safe.
Home: [`core/docs/ai-context/documentation-workflow.md`](../../core/docs/ai-context/documentation-workflow.md)

### Harvest

The batched pass, run as part of a [maintenance pass](#maintenance-pass),
that folds what was learned building recent features into a product's
durable docs and manual. It reads the [harvest-notes
comments](#harvest-notes-comment) and the diffs. Process PRs get no harvest
in a product; this repository keeps its own exception, because here the
process is the product.
Home: [`core/docs/ai-context/documentation-workflow.md`](../../core/docs/ai-context/documentation-workflow.md)

### Harvest-notes comment

A short comment posted on a workstream issue at the close-out of a
production-phase product feature: decisions and why, alternatives rejected,
candidate gotchas. It is the bridge that lets the harvest wait for a weekly
pass without reconstructing intent from cold diffs. A prototype-phase PR
posts none, since nothing about how its feature works is settled yet.
Home: [`core/docs/ai-context/documentation-workflow.md`](../../core/docs/ai-context/documentation-workflow.md)

### Memory note

A short file under `.agents/memory/` recording a narrow gotcha an agent hit —
an environment trap, a tool that misbehaves — so the next session avoids it.
Memory notes are a staging tier, not the source of truth: one that keeps
being cited, or that encodes real product or architecture truth, is promoted
into the shared docs with a pointer left behind. Not the same as a
conversation's memory, which this process deliberately does not rely on.
Home: [`core/docs/ai-context/agent-working-rules.md`](../../core/docs/ai-context/agent-working-rules.md)

### Prose sweep

The required method for reconciling the payload's prose after a change that
retires or reshapes a rule: fresh readers sweep the whole payload for
statements of the old rule, instead of the author grepping or hand-reading
the files they remember. It runs again after every batch of fixes, because
each batch can seed new instances.
Home: [`core/docs/ai-context/prose-sweep.md`](../../core/docs/ai-context/prose-sweep.md)

### Handoff

Moving a session's working state into a new session, via `/handoff`. It
first decides whether a move is needed at all and stops if not; when it is,
the load-bearing context goes onto the workstream issue and David gets a
prompt to start the new session with. Distinct from a harvest, which records
durable learnings, and from the cross-tool handoff folder some products
keep.
Home: [`core/.claude/skills/handoff/SKILL.md`](../../core/.claude/skills/handoff/SKILL.md)

### Maintenance pass

The roughly weekly `/maintenance` ritual David invokes: dependency updates,
production errors, CI health, a "what shipped" digest, process-health
numbers, and the batched [harvest](#harvest). Claude never schedules it on
its own. In this repository it also updates the manual chapters touched by
the PRs merged since the last pass.
Home: [`core/.claude/skills/maintenance/SKILL.md`](../../core/.claude/skills/maintenance/SKILL.md)

### David-gate

A stage of a workstream that only David can move past — agreeing the scope
of work, approving a plan, and running UAT. It is marked 🛑 in the lifecycle and on the project
board — the same glyph as a blocking ask in chat, so one symbol means
"David" everywhere. Merge is deliberately not one: the agent merges once the
merge bar is met.
Home: [`core/docs/ai-context/workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md)

---

## Talking to David

### Load-bearing claim

A claim something Claude is about to do or say depends on — a design
decision, a recommendation, a review reply, a brief for another agent. Such
a claim is either a quotation of what was actually observed or carries an
explicit `unable to verify:` marker naming what would settle it; "I
believe" is not a third option. A judgement is named as a judgement; only
its premises are claims.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Blocking ask

A message saying Claude needs something from David before work can continue
— information, a decision that is his, or an action only he can take. It
takes a fixed 🛑 banner shape, with numbered options and a recommendation,
is the last text of the turn, and always fires a push notification.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### FYI

The 👀 banner for something David would want to know but need not answer —
a security concern found along the way, a systemic issue beyond one PR, a
scope surprise. Work continues without a reply. Routine correctness findings
do not clear the bar.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

---

## Machinery and guardrails

### Ruleset

A GitHub branch protection configured on the server, which no local tool can
disarm. Rulesets block force pushes on every branch and, on `main`, require a
pull request, passing checks and resolved conversations — the last is what
makes the Merge button inert while a review thread is open. Since 2026-10-03
they bind David too: every change to `main` arrives through a pull request.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)

### Machinery pin

The `.agents/machinery.json` file that names the repository and maps each
model **tier** — the strongest Claude, the strongest Codex — to one exact
model and effort level. A new model release is an edit there and nowhere
else; roles name a tier, and a check holds the agent definitions equal to
the pin. A consumer receives it as a [seed file](#seed-file) and owns it
from then on; this repository's own copy is at the root.
Home: [`core/.agents/machinery.template.json`](../../core/.agents/machinery.template.json)

### The #89 cut

The audit David ran in September 2026 that deleted most of the process's
machinery — round budgets, an external adjudicator whose verdict decided,
committed receipts, a merge-readiness checker, and the local shell guard.
Measured over a ten-round loop, none of it had changed a decision. Many
rules still say what the cut removed and what, if anything, replaced it, and
the contract warns explicitly against undoing it piecemeal by adding ledgers
or receipts back.
Home: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)
