# Chapter 10 · Tracking work

> How David can tell, without opening a single session, what every piece of
> work is, where it stands and whether it needs him. Each unit of work gets
> one GitHub issue; labels on that issue record its stage and who is holding
> it; a narrative block at the top of the issue makes it resumable cold; and
> three read-mostly skills turn that record into answers — where this session
> stands, what needs David across everything, and what to pick up next. A
> weekly maintenance pass keeps the record from decaying, and a small set of
> waiting rules governs how an agent passes the time while GitHub catches up.
>
> Deep rules: [`workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md)
> (the board, the labels and who updates what), and the *Waiting, and
> scheduled check-ins* section of
> [`claude-core.md`](../../core/.agents/core/claude-core.md).

## What it does

David runs many sessions at once — the contract puts it at around ten — and
cannot hold their state in his head. He has said so, and asked the system not
to rely on his memory. This area solves that with GitHub's own project
management rather than a bespoke tracker:

- **One issue per [workstream](./glossary.md#workstream)** — every feature,
  bug fix or documentation harvest that is underway has exactly one issue,
  and every pull request for it names that issue in its body.
- **Labels are the truth** about where the work is and who holds it.
- **A private Project board** displays those labels for visual scanning; each
  product names its board in its own [overlay](./glossary.md#overlay).
- **Skills read the labels back** and answer David's actual questions in
  plain language.

The same system holds work that has been decided but not started (the
backlog), dependencies between pieces of work, and the "way back" to a test
run that a newly found bug interrupted.

## How it works

### The lifecycle and David's gates

Every workstream moves through one lifecycle: discovery, the
[scope-of-work gate](./glossary.md#scope-of-work-gate), planning, plan
approval, coding, code review, merge, test run, [UAT](./glossary.md#uat),
[close-out](./glossary.md#close-out), done. Three of those stages are marked
with 🛑 — scope of work, plan approval and UAT — and they are **David-gates**:
stages only he can move past. The glyph is deliberately the same one Claude
uses for a [blocking ask](./glossary.md#blocking-ask) in chat, so one symbol
means "David" everywhere.

Two variations ride on the same lifecycle. [Bug-fixing mode](./glossary.md#bug-fixing-mode)
skips planning and plan approval, going straight from discovery to coding. A
feature in [prototype phase](./glossary.md#prototype-phase) plans its first
version, then sits in coding and alternates between David's feedback and the
next version, with no code review or UAT until he promotes it to production.

Merge is not a David-gate: the agent driving the pull request merges it once
the [merge bar](./glossary.md#merge-bar) is met. One rough edge is admitted in
the contract: the board's own column for that stage is still named with the
stop glyph, because renaming it is a board-settings change only David can
make, so ordinary self-merged work briefly shows 🛑 there without needing him.

### Three labels per issue, and why two of them are separate

Every workstream issue carries exactly one label from each of three families:

- **`stage:`** — where it is in the lifecycle.
- **`waiting:`** — who is holding it right now: David, Claude, Codex, Replit
  or CI.
- **`mode:`** — what kind of work it is: feature, bugfix, docs or devops.

Stage and waiting are kept apart on purpose. A blocking question in the middle
of a build leaves the stage at coding while the holder flips to David — and
that divergence is precisely the moment David needs surfaced. Folding the two
into one field would hide it. Two labels from the same family on one issue is
treated as a data error to fix, never something to resolve by picking one.

### The State of Play block

Labels are machine-readable; the **State of Play** block at the top of each
issue's body is the human-readable narrative that lets anyone — David, or a
brand-new session with no context — pick the work up cold. It records the
stage and holder spelled out, the last movement, what the work is for, where
it actually stands, what is blocking and what David needs to do (restated from
the real thread, not guessed from the stage name), the relevant artifacts, and
how to resume.

The rule that keeps it honest: **whoever changes an issue's stage or holder
updates the block in the same edit.** A label with a stale story behind it is
worse than an honest gap. Two skills also update the block without a label
change — the [handoff](./glossary.md#handoff), when a session's context moves,
and a UAT run in progress, which records which step is next.

### Nobody owns the board; each step updates its own labels

There is no background job keeping labels current. Instead each
[skill](./glossary.md#skill) updates the labels at a moment it already fires:
the planning skill when a plan goes to David for approval, the bug-fix skill
when it opens a fix, the pull-request watcher at each review round and at
merge, the UAT skill when David accepts or blocks a run. The contract carries
the full table of who owns which transition. The effect is that tracking is a
side effect of doing the work rather than a separate chore that can be
forgotten.

The board itself is fed by a GitHub Action that mirrors labels onto the
board's fields on every label change, using the payload's
`core/scripts/sync-project-fields.mjs`. It resolves the board's columns by
normalised name rather than exact spelling, and fails loudly on anything it
cannot map. **Needs David confirmation:** whether the Action's workflow file
is supplied to each product by the handbook or set up by hand — the contract
names it, but no workflow file for it ships in the payload.

### Large features: one parent, one sub-issue per phase

A feature too large for one pull request is split into phases — proposed to
David, never declared silently mid-build. The parent issue carries the plan
and a **Phases checklist**: one line per phase, ticked when it merges, naming
its sub-issue or saying it is not yet opened. Each phase is a GitHub
sub-issue with its own labels, pull request and merge. Phases merge one at a
time, never stacked on one another, and each product-visible phase ships its
own UAT — there is no deferred whole-feature test at the end that would leave
David unable to verify anything for weeks. The checklist matters because it
is the only place a not-yet-started phase exists; a phase missing from it is
one the system will forget.

### The backlog, and the `gap` label

Work that has been decided but not started is an issue with a **`queue:`**
label and no `stage:` label. Three priorities exist — now, next and later —
deliberately not called P1 and P2, which would collide with Codex's severity
badges. The issue body is where the nuance lives: why it is wanted, what was
already decided, what was ruled out. The moment work starts, the issue gains
a stage, drops its queue label, and becomes an ordinary workstream issue —
and the skill starting the work searches the backlog first, so it promotes
the existing issue rather than opening a duplicate.

A follow-up filed from a review round, recording an imperfection accepted
rather than fixed, carries the **`gap`** label and no queue label. Until David
has triaged it, it is invisible to `/next` by design: a recorded gap is
something to revisit, not a promise of work. The maintenance pass asks
[now, next or never](./glossary.md#now-next-never) of every open gap, and its
answer is what gives the gap a queue label or closes it.

### `Blocked by:` and the descent stack

Any issue may carry `Blocked by: #N` lines in its body. An open blocker makes
the issue non-actionable; closing the blocker releases it, with no edit
needed, because the marker points at an issue whose state is the truth.

This exists for the shape David hits most often. He starts UAT on a merged
feature, hits an error, and the error turns out to be a real bug — sometimes
a small one, sometimes a whole subsystem rebuild. The risk is not chasing the
bug; it is losing the way back to the interrupted test. So whoever takes on
the bug opens its issue, adds `Blocked by:` to the interrupted workstream, and
records which UAT step failed. The chain is a call stack made of issue links:
it can nest to any depth, priority flows down it so the bug at the bottom
outranks fresh work, and when the bottom closes the interrupted UAT surfaces
again as the top recommendation — "resume at step 4", not "start again". If a
descent grows larger than the interrupted test is worth, David can park it,
and maintenance prompts that question for chains that run deep or old.

### Closing an issue

**Close-out is a moment, not a resting state.** Whoever moves a workstream to
close-out finishes what remains — the [harvest-notes comment](./glossary.md#harvest-notes-comment)
for a product feature, anything the State of Play lists — then marks it done
and closes the issue in the same pass, naming the pull requests that did the
work. What keeps a merged workstream open is a UAT still owed, or, for a
prototype-phase feature, the phase itself.

Three guard rails go with that:

- **A pull request never auto-closes its own workstream.** It names it with a
  `Workstream:` line instead, because auto-closing at merge would skip the
  UAT the work may still owe. A *different* issue the pull request completes
  outright is named with GitHub's closing keyword, so it closes at merge.
- **The board's built-in "merged means done" automation stays off**, so the
  board never claims work is verified before David has verified it.
- **An issue closed by mistake is reopened**, never left closed to save face.
  Reopening is one click, which is what makes closing cheap.

### The three questions: `/status`, `/status-all`, `/next`

Three skills read this record, each answering a different question:

| Skill | Question | Writes? |
| --- | --- | --- |
| [`/status`](../../core/.claude/skills/status/SKILL.md) | What is *this session* working on, where does it stand, how does it fit? | Offers to correct stale tracking; writes only after David confirms |
| [`/status-all`](../../core/.claude/skills/status-all/SKILL.md) | Across every open workstream in this repository, what needs David, and what has stalled? | Never |
| [`/next`](../../core/.claude/skills/next/SKILL.md) | What is the single best thing to pick up now, and why? | Never |

`/status` reports one of five states — working, waiting on you, watching,
stalled, done — derived from the labels plus live GitHub. Those states are a
presentation vocabulary only: they are never stored as labels or board
fields. And "watching" is never claimed from memory; it requires a live look
at the pull request in that same invocation.

`/status-all` is the cold-open board, grouped into what needs David, what has
stalled and what is in progress. It is best run from a fresh, cheap session,
because it needs no session memory at all — everything comes from GitHub.

`/next` is the only one of the three that takes a position. It ranks
**closest to done first**, lets priority flow down `Blocked by:` chains, picks
the next phase from a Phases checklist, names which candidates are safe to run
in parallel sessions, and — when the queue is empty — proposes what to build.
It recommends; it never starts the work.

All three answer for **the repository the session is working in, never the
fleet**. They read that repository's declared identity from its machinery
file, cross-check it against the git remote, and stop and ask if the two
disagree rather than reporting confidently on the wrong product.

### The maintenance pass keeps the record honest

The weekly [maintenance pass](./glossary.md#maintenance-pass)
([`maintenance` skill](../../core/.claude/skills/maintenance/SKILL.md)) is
David-invoked and covers dependency updates, production errors, CI health, a
"what shipped" digest written for a product manager, the batched
documentation harvest, process-health numbers counted fresh from GitHub,
stale handoffs, branch hygiene, and one proposed rule deletion or conversion
per pass. One step exists specifically to keep `/next` trustworthy:
**backlog and dependency hygiene**. It finds issues nobody labelled, triages
open gaps, re-checks queue priorities against the roadmap, removes stale
`Blocked by:` markers, flags blocking cycles and deep chains, and checks each
Phases checklist against what actually merged. It delivers all of that as a
numbered proposed diff; David approves, amends or declines each line, and only
then are the approved ones applied.

### Waiting, and scheduled check-ins

Much of the lifecycle is waiting on GitHub — for CI, for a review to land,
for a merge to register. The rules for that are short:

- **Wait by sleeping in the background, ending the turn, and checking the real
  condition on waking** through the GitHub connector. Never poll GitHub from
  the shell: in this environment every shell route to the GitHub API returns
  an error or nothing, and a poll loop built on one does not fail — it sleeps
  forever, looking exactly like "still waiting".
- **A scheduled check-in is allowed only for a named external condition that
  will not wake the agent by itself**, such as stalled CI or a long Replit
  operation — never a general heartbeat, and never a substitute for finishing
  now. Each check-in states its condition, its cadence and its exit, and
  caps on consecutive no-op wakes and on wakes per day end it, with a report
  to David saying what was being waited for.
- **Check-ins are scheduled as one-shot reminders only.** The recurring
  scheduling tools stall an autonomous session at a permission prompt, so
  re-arming means scheduling a fresh one-shot.

## Why it works this way

- **GitHub rather than a bespoke tracker.** Issues, labels and boards already
  exist, survive any session ending, and are visible to every agent and to
  David alike. A tracker of the handbook's own would be one more
  thing to keep in sync.
- **Labels, not the board, are the truth, because nothing can touch the
  board directly.** No tool available to the agents can read or write a
  Project board's fields; this was confirmed twice, independently, while
  building the sync. So agents write labels, an Action mirrors them, and the
  reporting skills recompute the board's view from labels. If the board and a
  report disagree, the board is stale.
- **Labels are also the trust boundary.** The contract treats each
  repository as public, so
  anyone can open an issue or write a pull request body claiming to belong to
  a workstream. Outside accounts cannot apply labels, so an issue without the
  system's labels is ignored, along with any marker in it.
- **Updates ride existing trigger points because standing chores decay.** A
  rule that says "remember to update the board" is a rule that will be
  forgotten; a label change bundled into the step that caused it is not.
- **Closing at close-out, because issues used to pile up.** Until 2026-09-25
  only an accepted UAT closed an issue, so every workstream with no UAT —
  every docs, devops and simple bug fix, and nearly every pull request in the
  handbook itself — parked at close-out waiting for David to mark it done,
  and nothing ever asked him to. An open issue whose work is finished is not
  harmless: the reporting skills keep surfacing it, and it hides the issues
  that are really open.
- **Closest-to-done wins, because unfinished work is the expensive kind.** A
  nearly finished UAT that slips out of view is work already paid for and not
  delivered. Ranking by distance to done, with priority flowing down blocker
  chains, is what keeps a three-levels-deep rebuild correctly ahead of a new
  feature: finishing it unwinds the stack back to an almost-done test.
- **Proposed diffs, never unattended writes, for corrections.** `/status` and
  the maintenance pass both propose and wait for David's confirmation. An
  unattended version was designed and rejected: it would have needed conflict
  detection and write-target checks the GitHub API cannot cleanly provide, for
  the sake of a status report.
- **Never poll from the shell, because a silent failure looks like
  patience.** The handbook's recurring lesson is that a control which cannot
  evaluate must refuse, not report success; a poll loop that returns nothing
  and sleeps is the waiting-room version of that failure.

## Boundaries & known limitations

- **Work with no issue is invisible.** A discovery conversation that has not
  yet opened its issue does not exist as far as GitHub knows, so `/status-all`
  cannot see it. If a report looks short, that is the likely reason.
- **Sensitive work never becomes a public issue.** Anything that fails the
  disclosure check — vulnerability details, credentials, private customer
  data and the like — is tracked as a private draft item on the board instead,
  and is therefore invisible to every tool-based report, deliberately.
- **The board can lag the labels.** It is a projection updated by an Action;
  the labels are authoritative.
- **The board still shows 🛑 on the merge column** until David renames that
  option, as described above.
- **The reporting skills are read-only or confirm-first.** None of them
  starts work or fixes tracking on its own; `/next` in particular only
  recommends.
- **Process-health numbers are counted, not stored.** The maintenance pass
  recomputes them from GitHub each time; a planning loop, which runs in
  session and leaves no GitHub record, is counted from what its harvest
  comment says, and the report says so when that source is missing.

## Going deeper

- The contract: [`workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md)
  — the lifecycle, the label families, the ownership tables, phases, the
  backlog, `Blocked by:`, closing rules, and the disclosure check.
- The reporting skills: [`status`](../../core/.claude/skills/status/SKILL.md),
  [`status-all`](../../core/.claude/skills/status-all/SKILL.md) and
  [`next`](../../core/.claude/skills/next/SKILL.md).
- The weekly pass: the [`maintenance` skill](../../core/.claude/skills/maintenance/SKILL.md),
  especially its backlog-and-dependency hygiene step.
- The board mirror: [`core/scripts/sync-project-fields.mjs`](../../core/scripts/sync-project-fields.mjs).
- Waiting rules: *Waiting, and scheduled check-ins* in
  [`claude-core.md`](../../core/.agents/core/claude-core.md), and the memory
  note [`github-rest-api-blocked-from-bash.md`](../../core/.agents/memory/github-rest-api-blocked-from-bash.md).

**Next:** chapter 11 — [`11-models-cost-and-routing.md`](./11-models-cost-and-routing.md),
which model does each job, what is handed to a subagent, and what a review
round costs.

*Verified against `081ef0c` (2026-10-03).*
