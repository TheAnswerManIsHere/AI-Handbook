# Chapter 6 · The review loop

> What happens between a pull request opening and the judgement that it is
> ready: [Codex](./glossary.md#codex) reviews the code, two independent
> assessors advise on which of its [findings](./glossary.md#finding) are worth
> acting on, Claude decides and writes one batch of
> fixes, and the corrected code is reviewed again. The loop is built around
> two promises — **nothing merges unreviewed, and a loop always ends on a
> reviewed head** — and around one hard-won lesson: a chain of individually
> sensible fixes can run on forever, so the length of the sequence is bounded
> separately from the worth of each fix.
>
> Deep rules: [`claude-core.md`](../../core/.agents/core/claude-core.md) —
> *Review loops* and all its subsections;
> [`review-judgment.md`](../../core/docs/ai-context/review-judgment.md) (the
> [Worth rule](./glossary.md#worth-rule), its only statement);
> [`working-modes.md`](../../core/docs/ai-context/working-modes.md) (the
> [write-gate](./glossary.md#write-gate) and the
> [two-review limit](./glossary.md#two-review-limit)); the
> [`pr-watch`](../../core/.claude/skills/pr-watch/SKILL.md) skill (how a round
> actually runs).

## What it does

David does not read code. Codex's review of product
code is his safety net, and it is the one part of this process that is never
in question for a [production-phase](./glossary.md#production-phase)
product change. Everything in this chapter
is what sits on top of that review: how its findings
are judged, who judges them, how much code gets written in response, when the
loop stops, and how David learns what happened without reading a diff.

The loop has a hard job, because both obvious failure modes are real and both
have been measured here. A builder triaging its own review writes code for
nearly everything — declining takes a paragraph of justification, fixing takes
a commit, so fixing wins. And a reviewer told to be strict about what is worth
fixing becomes a decline machine. The design that survived those two
experiments keeps the per-finding judgement honest by sharing it, and keeps the
loop short by counting rounds rather than trusting anyone's sense that one
more fix is worthwhile.

## How it works

### The shape of a round, end to end

Read this first; every rule later in the chapter is one step of it.

1. **Before the first round, the oracle is agreed.** The
   [oracle](./glossary.md#oracle) — the outcome David agreed the work should
   achieve — is fixed before any review runs, usually from the approved plan,
   an issue discussion or his explicit request. The tooling refuses to build
   an assessment without one, and a pull request that reaches review with no
   agreed oracle goes to David rather than having Claude write one.
2. **Codex reviews.** The first [review round](./glossary.md#review-round)
   fires automatically when the pull request opens. **A clean round ends the
   loop then and there**: nothing was written, so the head is already
   reviewed, and there is nothing to assess.
3. **Claude reads the live state.** Every event — a review, a comment, a CI
   result — prompts a fresh read of the pull request's actual threads, checks
   and commits. Webhook notifications lag, drop and arrive out of order, so
   their text alone is never trusted, and silence is never taken as "all
   clear".
4. **Two independent assessments.** If the round returned findings,
   [Astra](./glossary.md#astra) and the
   [Fable assessor](./glossary.md#fable-assessor) are each given the same
   package — the findings, the oracle, the revision, the labelled history —
   and each writes its own view of what is really wrong and whether acting on
   it is worthwhile. Neither sees the other's answer. Both are posted on the
   pull request verbatim.
5. **Claude investigates and decides.** Disputed facts are settled by Claude
   reading the code and running the tests, not by asking an assessor. A real
   question of reasoning can go back to the assessors as a focused follow-up,
   which costs no commit and no Codex round. Claude then states the next
   action in an explicit `review-action` block — nothing reads an assessment
   and acts on its wording.
6. **Check the limit, then write one batch.** Before any code is written,
   Claude checks whether this round is one the
   two-review limit says must be the last
   (below). If writing is allowed, every finding worth acting on is fixed
   together, in one validated push.
7. **Reply and resolve, thread by thread.** Each finding gets a reply saying
   in its first sentence what was done — fixed in this commit, or declined and
   why — and its thread is resolved immediately after. Declines are also
   recorded in the PR body's *Recorded gaps* table.
8. **Ask for the next review.** The request names the branch head, says what
   the round costs and protects, and carries pre-registered
   [flip conditions](./glossary.md#flip-condition). The trigger itself carries
   no prose; the context goes in a separate comment just before it.
9. **Translate, when owed.** If Claude declined something in the round, if
   something about it smells wrong, or if it is the last round before a merge,
   a separate translator explains the round to David in plain English, in
   chat (below).
10. **Loop or stop.** A changed head goes back to step 2. A round whose
    findings warrant no code — or a limit that says iteration is over — ends
    the loop, and the pull request goes to
    [close-out](./glossary.md#close-out) (chapter 7) or, where
    the rules require, to David.

### The write-gate: code written is code reviewed

The write-gate is the rule the whole loop is
built around. The decision about whether to write happens *before* anything is
written, and anything written is reviewed:

- A round returns findings, and the judgement is made: write, or stop.
- **If anything is written**, it is pushed, and another review round is
  automatic and mandatory.
- **If nothing is written**, the loop ends there, on a head the last round
  already reviewed.

Its two invariants are the point. No commit in the
[standard loop](./glossary.md#standard-loop) merges without having been
reviewed, and a loop never ends on an unreviewed head — because the stop
always comes before a new commit exists. The way out of an endless loop is
deciding nothing more is worth *writing*, never skipping the review of
something that *was* written.

Two corollaries keep the gate from being gamed in either direction: a head that
has changed always gets its review, however small the change (a prose-only
fix included), and a head that has not changed never gets a second one — asking
again just to get a different answer is refused.

### Shared judgement on a round

Every round that returns findings gets both assessments **before** anything is
written for it — whatever the findings look like, nits included. Skipping them
because Claude expects to decline everything would end the round on Claude's
judgement alone, which is exactly what the two assessments replace.

**Who decides what** is the core of the design:

- **The assessments advise; Claude decides** from the two, after checking any
  disputed facts itself.
- **A purely technical disagreement that survives investigation** is settled
  by the Fable assessor, with its reasoning recorded. Unanimity is not
  required.
- **Intended behaviour, and any shortfall David or a user would feel, are
  David's** — as are product forks, scope additions, splits and disclosure
  questions. These go to him as a [blocking ask](./glossary.md#blocking-ask)
  and stay open until he answers. A later clean round does not close them, and
  neither does a default Claude registered in advance: a default says what
  Claude does while waiting, never what David decided.

A few rules protect the inputs. The assessors take the oracle from where it
was agreed, never from the PR body Claude wrote. Both read the live checkout,
so the dispatch refuses unless the working tree is exactly the reviewed commit
and clean — advice about code the assessor never saw is worse than none. And
**a failed dispatch stops the round**: one assessment alone is not permission
to proceed.

### The Worth rule: is this worth doing at all?

The question asked of every finding is not "is it correct?" but **"does acting
on it serve the agreed outcome at a cost proportionate to what it prevents?"**
That is the Worth rule, and it has exactly one
statement,
[`review-judgment.md`](../../core/docs/ai-context/review-judgment.md), which
Astra, the Fable assessor and Claude all apply in the same words. It sets **no
target rate** of fixing or declining in either direction.

In outline, it asks a reviewer to name the *class* of failure the finding
belongs to rather than the line it landed on; to establish what is actually
wrong; to understand where the faulty value comes from, since fixing the
producer often beats guarding every consumer; to name a credible way the
failure happens and what it would cost; to compare responses, including doing
nothing and removing a mechanism outright; to look at the round as a whole;
and, for a decline, to say plainly what remains possible and why that is
acceptable. A decline that would knowingly accept a shortfall David would feel
is his call, not the loop's.

**A fix owes the class, not the instance.** Reviewers cite lines; treating the
cited lines as the scope of a fix is how loops grind, because the next round
finds the siblings nobody looked for. So a fix sweeps for every instance of the
pattern, and a decline answers the worst consequence that class can reach.
Where a command can settle a question, it runs before the reply is written and
its real output goes in the reply.

### The two-review limit

On internal tooling, **autonomous iteration is bounded at two reviews**:
review the head; if corrections are warranted, make one coherent batch; review
the corrected head; stop. Anything still worth doing after that becomes a
recorded gap or a follow-up issue — filed so that it does not enter the work
queue until David has triaged it (chapter 10).

Three things make the limit what it is:

- **It caps editing, never reviewing.** The corrected head is always reviewed.
  To make that structurally safe, the limit is checked *before* anything is
  written in a round, so Claude never produces a head it would be forbidden to
  have reviewed.
- **Ending iteration is not "merge regardless".** If the corrected head still
  breaks an agreed requirement, fails a required check, or carries a finding
  of real harm David has not accepted, it goes to David with the shortfall and
  a choice — continue, cut the scope, or stop — not to the Merge button.
- **Claude cannot award itself a third review.** Only David can reopen the
  work. "Another correction seems worthwhile" is precisely the reasoning the
  limit exists to refuse.

**What counts as internal is asked of each change, by its consequence and how
recoverable it is** — not read off the directory it lives in. A change to
machinery that governs approvals, publishing, credentials or destructive
operations, whose effect could not be trivially undone, falls outside the
limit and runs the ordinary loop; changing a message that machinery prints
does not. Product code is outside the limit altogether. And "this changes how
future agents work" disqualifies nothing, or every line of this repository
would escape every limit.

One class of pull request has its own ending: **a change to the review loop
itself that still carries findings after its second review goes to David**,
findings, declines and all, for him to triage by hand. That is his ruling for
that class (2026-09-23), not a reading of the consequence test. A review-loop
change whose reviews come back clean merges like anything else.

### The ship gate: when "is it worth it?" stops being asked

Both assessments open by answering one yes-or-no question: **is the oracle met
at this head?** Once both say yes, the default flips. Remaining findings
become recorded gaps unless one would make the oracle false — a regression —
or its blast radius reaches beyond this pull request. That is the
[ship gate](./glossary.md#ship-gate). Claude carries out the flip; it does not
judge it alone.

The question is answered against text agreed before the loop began, which is
what stops it becoming one more thing to reinterpret. Where the two-review
limit applies, it caps the gate: reach beyond the pull request can stop the
gate from ending a loop early, but never buys a third review. And on a pull
request that changes the review loop, every finding reaches beyond the pull
request by definition, so the gate cannot end that loop alone and says so.

The gate comes with one named rationalisation that is banned outright: **a fix
worth doing only because a round is already being written is not worth its own
round — and since it causes one, it is not written.** Sunk cost is not a reason
to write.

### Flip conditions and the cost line

Every review request carries **flip conditions written before the round runs**:
what finding, count or change of shape would make Claude stop. Each must name
something *observable* off the round, never a judgement Claude would make in
the moment having just read the finding. A condition that has to be
interpreted gets reinterpreted; one that collides with an event fires.

The same request states, in one line, **what the round will cost and what it
protects**. A round that returns findings costs the same whatever the finding
is — two assessments that each re-read the repository, a translation when one
is owed, and Claude's own turns — and Claude's own turns grow more expensive as
the loop goes on, because everything read into context is paid for again on
every later turn. Putting the bill beside what it buys makes a
disproportionate round visible *before* it is spent. A clean round is cheaper:
no assessor is dispatched when there is nothing to assess.

### Replies and resolved threads

Every finding gets its own reply and its own resolved thread, straight after
the reply, never in a batch and never replaced by one summary comment. A reply
says its outcome in plain words first, names the class of failure it answers,
and cites the assessment it rests on. Any fact it asserts about the code is a
[load-bearing claim](./glossary.md#load-bearing-claim): it either quotes what
was observed or says plainly what could not be checked. There is no fixed form
and no mandatory command on a decline — a heavy decline form once made
declining harder to write than fixing, which is the very imbalance the loop
exists to remove.

Resolving threads is not only tidiness: the `main` ruleset requires every
conversation to be resolved before the Merge button works — a
[ruleset](./glossary.md#ruleset) GitHub enforces on the server.

### The translation for David

The [round translation](./glossary.md#round-translation) is a separate agent
whose only job is to explain a round to David in plain English. It fetches the
round itself from GitHub — the findings, Claude's replies, the diff — and its
account reaches David unedited, pasted into chat exactly as composed. It
decides nothing; nothing in the loop reads it.

It runs **when Claude declined something in the round, when something about
the round smells wrong, and always on the last round before a merge**. Those
are the rounds where an independent reading has actually caught things. It
runs only *after* the next review has been requested, so Claude cannot act on
it mid-round. Its report leads with what the round was about and any
disagreement with Claude's account, then gives one line per finding, flagging
any where Claude wrote more than the finding was worth.

It is a second account, not a gag on Claude's: Claude's own write-up of a
round is welcome beside it, labelled as Claude's. A translation that fails to
arrive is reported in plain English and never blocks the loop.

### The six-hour stop

A loop pauses after six hours and asks David to resume. The clock is measured
from a single quantity readable off GitHub rather than any judgement about how
much of the time was "unattended", because the earlier, arguable wording was
never once consulted across the seven rounds of the pull request that wrote
it. Expiry pauses and asks; it never counts as convergence and never extends
itself.

### Who skips the loop

Not every pull request runs this loop. A change David declares
[Trivial](./glossary.md#trivial) merges on green CI unless Codex's automatic
pass raises a P1-severity finding, which holds the merge and goes to David; a
[Documentation class](./glossary.md#documentation-class) change gets one pass
from the two assessors and no Codex review; and a [prototype-phase](./glossary.md#prototype-phase) feature gets
no code-review loop at all. Chapter 3 explains each. On a Trivial or
Documentation change Codex's threads are still resolved, each with one line,
because the ruleset requires it.

## Why it works this way

- **Reviewing everything written is what makes stopping safe.** Earlier
  designs let a loop end with its last fixes unreviewed and then built
  machinery to make that head mergeable. The write-gate deletes the problem
  instead: if the stop always precedes the next commit, there is never an
  unreviewed head to make safe.
- **Two assessors, because one judge failed in both directions.** Triaging
  alone, Claude wrote code for 41 of 41 findings on one pull request. The
  first correction told a single external judge to decline most findings and
  bound Claude to its verdict — a decline quota, the mirror image of the
  problem. David replaced both on 2026-09-17 with two advisors and no quota.
  The measure now is whether David can see what mattered and why the response
  was proportionate.
- **Nothing parses an assessment.** If a phrase in an assessment could
  trigger work, the assessment would be a command. The explicit
  `review-action` block keeps the decision Claude's and keeps agreement
  between agents from ever passing for David's approval.
- **A count bounds the sequence, because per-finding filters cannot.**
  Measured across five loops on 2026-09-19, 57% of findings from round two
  onward landed on lines an earlier round's fix had just changed, and most of
  them were written for — each fix round produced the next. A filter applied
  to each finding has no view of how long the chain is getting. Two is an
  explicit trade-off rather than a measured optimum: it buys an independent
  look at the work and at its first corrections, which is the least worth
  having.
- **The ship gate consumes a signal that was already there.** On one loop,
  rounds four and five argued over the wording of a label in a comment, cost
  about a quarter of the loop's dispatched tokens, and changed nothing anyone
  would do — while both assessors had been saying for three rounds that the
  work already met its goal. Nothing was listening. Now that answer, given
  first, changes the default.
- **Observables, because judgements get reinterpreted.** Flip conditions
  phrased as judgements were crossed without Claude noticing (once it was the
  translation that caught it); conditions phrased as
  observable events fired and decided without Claude's judgement entering. The
  same lesson shaped the six-hour clock.
- **The class, not the line.** One early loop fixed exactly the cited lines,
  and the next round found three more instances a single search would have
  caught. A round per sibling is the most expensive way to find siblings.
- **A translation only where it earns its cost.** Translating every round was
  the single largest token cost in one loop, and the translator's real
  disagreements all came on rounds carrying a decline. Translating the last
  round always means nothing merges unaccounted for.
- **Chat, not a page.** The translation once rendered to a web page — which
  turned out to be a file written where nobody could open it. David reads
  chat; a page is something he would have to go and fetch.
- **The [#89 cut](./glossary.md#the-89-cut) removed more than it added.** A
  declared round budget, an external adjudicator whose verdict decided, an
  extension arithmetic, receipts and a merge-readiness check all stood here
  once. Over one ten-round pull request, not one of them changed a decision.
  What survives is small: the write-gate, the shared judgement, flip
  conditions, and the two-review limit added afterwards for the one thing the
  cut left uncounted.

## Boundaries & known limitations

- **The translation defends against Claude being wrong, not against Claude
  being deliberately misleading.** Claude launches it, chooses what round it
  reads and pastes the result. Its value is that it says what it checked and
  what it took on trust.
- **Which model answered is self-reported.** Each assessor states what it is
  running as, and a mismatch with what was requested is flagged to David as an
  [FYI](./glossary.md#fyi). The platform does record the serving model, so a
  real observation could be built; David judged it not worth building
  (2026-09-19).
- **The two-review limit leaves real defects on the table sometimes.** The
  rule's own home records two genuine defects a capped loop would not have
  surfaced in time. The trade is deliberate and recorded rather than
  discovered later; the shortfall path to David is what catches the serious
  ones.
- **If the limit routinely produces requests to reopen, it has failed**, and
  the answer then is smaller changes or simpler machinery, not more
  exceptions. That failure signal is named in advance.
- **The ship gate cannot end a review-loop pull request by itself**, because
  every finding on such a change reaches beyond it. Those loops run on the
  Worth rule and end with David.
- **The translator can write files.** Its tool list includes a write tool
  that cannot be narrowed to a path, and it reads comments from anyone on the
  pull request. What bounds it is that its output directory is never
  committed, the container is temporary, and Claude checks the working tree
  after every translation.
- **There is no checker for load-bearing claims in replies**, and none is to
  be built. Review noticing is the enforcement.
- **In this repository**, almost every pull request is
  [internal tier](./glossary.md#internal-tier), so the
  two-review limit is the normal ending — weighed per change, since this
  repository also holds the machinery that publishes to every product
  ([`CLAUDE.md`](../../CLAUDE.md), *Ceremony*).

## Going deeper

- [`claude-core.md`](../../core/.agents/core/claude-core.md) — *Review loops*:
  the write-gate, the ship gate, internal tooling, shared judgement, what the
  #89 cut removed, and watching pull requests.
- [`review-judgment.md`](../../core/docs/ai-context/review-judgment.md) — the
  Worth rule, in full.
- [`working-modes.md`](../../core/docs/ai-context/working-modes.md) — the
  write-gate, the two-review limit and its measured costs, and why findings
  owe their class.
- [`pr-watch`](../../core/.claude/skills/pr-watch/SKILL.md) — the round as
  Claude runs it, step by step, including the translation.
- [`review-proxy.md`](../../core/.agents/roles/review-proxy.md) — the brief
  both assessors read.
- [`fable-review-assessor.md`](../../core/.claude/agents/fable-review-assessor.md)
  and
  [`fable-round-translation.md`](../../core/.claude/agents/fable-round-translation.md)
  — the two Fable roles.
- [`core/scripts/review-proxy.mjs`](../../core/scripts/review-proxy.mjs) and
  [`core/scripts/round-translation.mjs`](../../core/scripts/round-translation.mjs)
  — the machinery; their opening comments explain the design.

**Next:** chapter 7 — [`7-close-out.md`](./7-close-out.md), how a reviewed pull
request becomes something David can click on.

*Verified against `118e076` (2026-10-03).*
