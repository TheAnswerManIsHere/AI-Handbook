# Chapter 9 · Memory and documentation

> How what a session learns outlives the session. An AI agent forgets
> everything when its chat ends, so the handbook treats memory as something
> written into versioned files rather than held in a conversation, and splits
> that writing into two kinds on two schedules: lessons about **how the agents
> work together**, persisted the moment they are learned, and knowledge of
> **how the product works**, harvested in one batch at the weekly
> [maintenance pass](./glossary.md#maintenance-pass). Around those two sit
> three supporting tools: a [handoff](./glossary.md#handoff) that moves a
> live session's context to a fresh one, a [prose sweep](./glossary.md#prose-sweep)
> that keeps the rules consistent after one of them is retired, and a
> catalogue of failure patterns the [fleet](./glossary.md#fleet) has already
> paid for.
>
> Deep rules: [`documentation-workflow.md`](../../core/docs/ai-context/documentation-workflow.md)
> (the documentation contract),
> [`prose-sweep.md`](../../core/docs/ai-context/prose-sweep.md) (the sweep
> method), and the *Memory lives in files, not a marathon chat* section of
> [`claude-core.md`](../../core/.agents/core/claude-core.md).

## What it does

Every session starts cold. Whatever was settled in yesterday's chat — a
decision and its reason, an approach tried and abandoned, a tool that behaves
oddly in this environment — is gone unless someone wrote it into a file the
next session will read. This area of the handbook is the set of habits and
[ceremonies](./glossary.md#ceremony) that do that writing, and that decide *where* each piece of
knowledge goes so it has exactly one home.

It answers four questions:

1. **When David says "remember this", where does it go, and when?** At once,
   into the durable file that owns that kind of rule.
2. **When a feature ships, how does what it taught us reach the product's
   documentation?** Through a short note at
   [close-out](./glossary.md#close-out), then a batched
   [harvest](./glossary.md#harvest) at the weekly maintenance pass.
3. **When a session has to end mid-work, how does its context survive?**
   Through a handoff written onto the work's
   tracking issue.
4. **When a rule is retired, how do the other files that mention it get
   fixed?** Through a prose sweep run by readers
   who did not write the change.

## How it works

### Two kinds of documentation, two schedules

The handbook's documentation contract draws one distinction and builds
everything else on it — [Type 1 and Type 2 documentation](./glossary.md#type-1-and-type-2-documentation):

- **Type 1 — how we work together — is written immediately.** A new rule, a
  process gotcha, a mistake that must never be repeated: anything that changes
  how Claude or [Codex](./glossary.md#codex) operate is persisted the moment it is learned, into the
  working contracts or into a [memory note](./glossary.md#memory-note). It
  rides the pull request already in flight, or a small one of its own. It
  never waits for a batch, because the very next session needs it.
- **Type 2 — how the system works — is written in a batch.** Subsystem
  documentation and the chapters of a product's own manual are harvested in
  one pass during `/maintenance`, covering every feature merged since the
  last pass.

What David sees: a "remember this" gets a one-line confirmation of where the
rule was written. A shipped feature produces nothing visible that day except a
short comment on its tracking issue; the documentation for it arrives in the
weekly maintenance pull request.

### Three memory behaviours that must not be collapsed

The contract names three related behaviours and insists they stay separate:

1. **Targeted persistence — "remember this."** One specific item — a
   preference, a rule, a fact — persisted now to its right file. Claude's
   rule is that "remember" means *write it into the durable docs*, not hold it
   in the chat, and that the result is binding from then on.
2. **Area working notes.** While digging into an area, Claude keeps a running
   notes document — a scratch file or the relevant context doc — capturing
   decisions and gotchas as they happen, and folds the durable parts into the
   shared docs before the work wraps.
3. **The `/document` ceremony.** The heavyweight, whole-feature harvest.

Which one a request triggers is decided by what "this" refers to: one item is
targeted persistence, a feature's worth of learnings is the ceremony, and a
bare "document this" with no clear referent gets one numbered question rather
than a guess. The contract carries a small table of worked examples so a fresh
agent sorts these the same way every time.

### The bridge: a harvest-notes comment at every close-out

Batching only works if the context a build session held is still available a
week later. So when a [production-phase](./glossary.md#production-phase)
product feature reaches close-out, Claude posts a
[harvest-notes comment](./glossary.md#harvest-notes-comment) on its
[workstream](./glossary.md#workstream) issue: the decisions made and why, the
alternatives rejected, the gotcha candidates. It costs a comment, not a pull
request. A feature in [prototype phase](./glossary.md#prototype-phase) posts
none, because nothing about how it works is settled yet; it is harvested only
after the hardening work that follows its promotion to production has closed
out.

### The harvest itself

At the maintenance pass, the [`document`](../../core/.claude/skills/document/SKILL.md)
[skill](./glossary.md#skill)
runs the contract's five steps — harvest, route, update the manual chapter,
cross-check, report and commit. In outline:

- **The window is derived, not chosen.** The pass enumerates every eligible
  feature merged since the previous maintenance pull request and reads each
  one's harvest-notes comment first, then the merged diff, then any working
  notes. Skipping a feature whose notes exist counts as a miss.
- **Each learning goes to exactly one home.** A settled decision goes to the
  product's decisions log, a change in a subsystem's shape to that
  subsystem's context doc, an environment gotcha to a memory note, a new term
  to the glossary, a human-readable account to the manual. Everywhere else
  links to that home. Existing documents are edited in place to describe
  current truth; nobody appends a "learnings from PR #N" section.
- **Output scales to what was learned.** A feature that taught nothing
  durable produces nothing, and the pass says so rather than generating
  churn.
- **Every claim is checked, not just every cross-reference.** The
  cross-check asks of each claim whether it is a true fact, a correctly scoped
  one, internally consistent, a faithful citation, a counted number and a
  correct routing. An unverifiable product claim is marked **Needs David
  confirmation** instead of being stated.
- **Delivery is one pull request per pass**, in the
  [Documentation class](./glossary.md#documentation-class): one independent
  review pass over the prose, one batch of corrections if warranted, then
  merge.

David can also invoke `/document` directly for one feature; the contract
describes that ad-hoc path, which gets its own small pull request and its own
tracking.

### Memory notes and the failure-pattern catalogue

Two shared stores hold the fleet's accumulated experience, and both ship to
every product with the [payload](./glossary.md#payload):

- **[`core/.agents/memory/`](../../core/.agents/memory/)** — one short note
  per environment or tooling gotcha: what happened, what worked instead, and
  how to recognise the situation next time. A file name that states the
  lesson is what makes the folder scannable. Examples range from
  "GitHub's REST API is unreachable from the shell here" to "a CI guard that
  silently skips on missing inputs looks identical to one that passed."
- **[`known-failure-patterns.md`](../../core/docs/ai-context/known-failure-patterns.md)**
  — mistakes agents have repeatedly made or nearly made, each stated
  generally (what it looks like, why it is dangerous, how to avoid it) and
  then grounded in a concrete example from whichever product hit it. The
  example is evidence, not scope: a pattern found in one product applies to
  all of them.

**A pattern that recurs stops being a note.** One of Claude's standing
rituals says that when a catalogued failure happens again, the response is a
deterministic check in CI, not a better-worded entry. The maintenance pass
runs the same idea in the other direction: each pass picks one
judgement-shaped rule from Claude's contract and proposes either converting it
into a mechanical check or deleting it.

### Handoff: moving a session's context to a new session

Sometimes the session itself has to end — the next piece of work belongs to a
different workstream, or the conversation has grown so long that returning to
it is expensive. The [`handoff` skill](../../core/.claude/skills/handoff/SKILL.md)
handles that, and its first job is to decide whether a handoff is needed at
all:

- **It stays put** when the session is mid-way through a stateful loop (a
  plan review between exchanges, a pull request being watched before
  close-out), when it holds live state no file can carry, or when what
  matters fits in a few lines. In that case it says so in one line and stops.
- **It hands off** when the next work belongs to a different workstream, or
  when the transcript has grown large enough that carrying it costs more than
  moving it.

When it does hand off, it first makes sure everything worth keeping is pushed
(a new session gets a fresh container), lists what does not transfer (pull
request subscriptions, scheduled check-ins), refreshes the workstream issue's
*State of Play* block, adds a fixed-shape handoff comment, and gives David a
copy-pasteable prompt for the new session. The two sections that earn their
keep are **settled — do not re-open** and **ruled out**: without them a cold
session re-derives a closed decision and presents it as a fresh idea.

What David sees: a one-line verdict, and, if the verdict is to move, an issue
link and a prompt block to paste.

### Prose sweep: keeping the rules consistent after one is retired

The handbook's rules are prose, spread across dozens of files that cite one
another. When a rule is retired or reshaped, every sentence elsewhere that
still asserts the old version becomes a live contradiction, and an agent
reading either one may act on it. The [`prose-sweep` skill](../../core/.claude/skills/prose-sweep/SKILL.md)
is how those sentences are found:

1. **A spec first.** Before any file is opened, Claude writes down the rule
   being swept for, its one authoritative home, the distinct *shapes* an
   out-of-date assertion of it can take, and what readers must not return.
2. **The scope is the whole payload**, enumerated by a script from git's
   tracked files — deliberately including the [role briefs](./glossary.md#role-brief)
   and [agent definitions](./glossary.md#agent-definition) the reviewers read,
   which a documentation-shaped search misses.
3. **Cold readers do the reading.** The files are fanned out to
   [subagents](./glossary.md#subagent) who did not write the change. Each one
   declares, per file, whether it read the file in full or swept it, and
   returns every candidate with a confidence level and every declined
   candidate with the exclusion that resolved it.
4. **Claude verifies each candidate, fixes it by citing the home, and runs the
   sweep again** — because each batch of fixes seeds new instances.

The trigger is fixed: a prose change that retires or reshapes a rule runs the
sweep before its review is requested, and never a hand-run search instead.

### This repository is the exception

The fleet contract gives process pull requests no Type 2 harvest, since in a
product the process is not the product. In the handbook the process *is* the
product, and every pull request is a process pull request — so applied as
written, nothing would ever update this manual. The handbook therefore runs
one harvest of its own: its `/maintenance` pass reads the pull requests merged
since the last pass and updates the chapters they touched, as a Documentation
class pull request. That rule lives in the repository's own
[`CLAUDE.md`](../../CLAUDE.md) and in this manual's [README](./README.md), and
nothing about it ships to a product.

## Why it works this way

- **Memory lives in files because a long chat is expensive and a closed one
  is gone.** A session David returns to re-reads its entire transcript on
  every return, while versioned files cost nothing to keep. `/compact`
  relieves a session in the moment; it is not memory.
- **Type 1 is immediate because the next session needs it.** A rule about how
  agents behave that waits a week for a batch is a rule broken for a week.
  Knowledge of a subsystem can wait, because the code still works while its
  description catches up.
- **Type 2 is batched because the per-merge version was mostly ceremony.**
  Before David moved it to the weekly pass (2026-08-20), the harvest ran after
  each merge, and harvest pull requests had grown to roughly a quarter of all
  merged pull requests, several of them harvests of harvests. The
  harvest-notes comment is what makes the batch safe: it captures the build
  session's reasoning while it still exists, so the weekly pass is not
  reconstructing intent from cold diffs.
- **The harvest never runs in a subagent.** Its richest source is the build
  session's own decisions and the alternatives it rejected, which a fresh
  worker does not inherit. The same reason keeps `/handoff` in the main loop:
  its whole subject is the session's own context, and noticing what matters
  is the task.
- **One home per learning, because two copies drift.** The handbook's most
  catalogued failure is the duplicate source of truth: two places that both
  claim to define something, a fix landing in one, and nobody knowing which is
  authoritative. Linking to a single home keeps a correction from having to
  find all its copies.
- **Per-claim checks, because a harvest written right after a merge
  over-claims.** Several harvests shipped claims that were plausible but
  wrong — a mechanism that did not exist, a narrow result generalised, a rule
  contradicted two lines later. The existing cross-check guarded claims about
  the *product*, and none of these were; they were claims about the
  repository's own tooling and process. So the cross-check now questions
  each such claim by kind.
- **Sweeps use cold readers, because the author cannot see the old rule.**
  This was measured: after one redesign of the review loop, three
  author-side clean-ups each declared the job done, and a fourth pass by cold
  readers still found 27 stale statements across 13 files. The author reads a
  leftover clause as consistent because they know what was meant, and every
  known miss sat within a screen of an edit the author had just made. A later
  case on a prototype-phase change made the same point: a hand sweep across
  twelve files missed the one file that wins on conflict, and the miss cost a
  [review round](./glossary.md#review-round).
- **A sweep is not a phrase search.** Some of the most consequential stale
  statements carried none of the retired rule's vocabulary — a file wrong by
  omission, or one citing the right file but the wrong rule inside it. A text
  search can serve as a cross-check for a reader, never as the method.
- **Recurring failures become checks because memory does not hold.** A note
  asks a future agent to remember; a CI check fires whether anyone remembers
  or not. The converse matters as much: a rule nobody can enforce reads as
  coverage it does not provide, which is why the maintenance pass also deletes
  rules.

## Boundaries & known limitations

- **Process pull requests get no Type 2 harvest in a product.** Anything
  durable they produce is a Type 1 lesson and was persisted when learned. The
  handbook's own manual is the one exception, described above.
- **A prototype-phase feature waits for its harvest** until the hardening work
  after its promotion closes out; until then there is no settled behaviour to
  document.
- **`/document` is docs-only.** A code problem found while harvesting goes to
  David as a report item, never a drive-by fix. An unresolved product
  question found the same way is reported, not quietly settled into the
  decisions log.
- **A handoff cannot carry everything.** Pull request subscriptions and
  scheduled check-ins are bound to the old session; the handoff lists them so
  the new session can re-establish them, but nothing transfers them
  automatically.
- **A sweep's "swept" clearance is weaker than a full read.** Readers declare
  which mode they used so that weakness is visible, but a file only swept can
  still hide a statement that uses none of the expected vocabulary.
- **The memory-note index is each product's, not the payload's.** The
  documentation contract asks for an index line beside each new note, and
  that index lives in each product's `.agents/memory/MEMORY.md`, because it
  lists the product's own notes beside the fleet's. So a fleet note the sync
  delivers gets its index line added by hand in that sync's pull request
  ([`docs/consuming-repos.md`](../consuming-repos.md)). Only some notes open
  with a name-and-description header.

## Going deeper

- The contract: [`documentation-workflow.md`](../../core/docs/ai-context/documentation-workflow.md)
  — trigger semantics, the routing table, the quality bar for manual chapters,
  the per-claim cross-check.
- Claude's enactments: the [`document`](../../core/.claude/skills/document/SKILL.md),
  [`handoff`](../../core/.claude/skills/handoff/SKILL.md) and
  [`prose-sweep`](../../core/.claude/skills/prose-sweep/SKILL.md) skills.
- The sweep method and its measured history:
  [`prose-sweep.md`](../../core/docs/ai-context/prose-sweep.md).
- The shared stores: [`core/.agents/memory/`](../../core/.agents/memory/) and
  [`known-failure-patterns.md`](../../core/docs/ai-context/known-failure-patterns.md).
- Where the batched harvest runs: step 6 and the contract-diet step of the
  [`maintenance` skill](../../core/.claude/skills/maintenance/SKILL.md).
- The handbook's own harvest rule: [`CLAUDE.md`](../../CLAUDE.md) and this
  manual's [README](./README.md).

**Next:** chapter 10 — [`10-tracking-work.md`](./10-tracking-work.md), how
every piece of work is tracked on GitHub so David can see what needs him
without opening each session.

*Verified against `118e076` (2026-10-03).*
