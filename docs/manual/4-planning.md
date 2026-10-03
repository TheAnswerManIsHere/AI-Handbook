# Chapter 4 · Planning

> How a feature's intent becomes a plan David approves. The plan is developed
> by Claude together with [Astra](./glossary.md#astra), an independent reviewer
> running on a different model family, as peers reading one contract. David
> controls the loop at two points: at the front, by agreeing the **[scope of
> work](./glossary.md#scope-of-work-gate)** that becomes the [oracle](./glossary.md#oracle) everything is judged
> against, and at the back, by **approving the plan in words**. Between those
> points the loop runs on its own, and every exchange is relayed to him in
> plain English before Claude revises anything. It all happens in chat; no
> plan is ever published.
>
> Deep rules: [`planning-contract.md`](../../core/docs/ai-context/planning-contract.md)
> (the one contract both parties read),
> [`plan-review-loop`](../../core/.claude/skills/plan-review-loop/SKILL.md)
> (Claude's procedure), [`PLANS.md`](../../core/.agents/PLANS.md) (the plan
> template and its preflight), and [`claude-core.md`](../../core/.agents/core/claude-core.md)
> *Planning*.

## What it does

Planning exists for work whose **approach** could be wrong in a way David
cannot see from the result. He verifies work by using the product against the
intent agreed before the plan was made, not by reading code. So the cheapest
place to catch "we are about to build the wrong thing", or "we are about to
build the right thing the wrong way", is before anything is built.

It applies to [feature-building mode](./glossary.md#feature-building-mode) for
product code in [production phase](./glossary.md#production-phase), and to the
first version of a feature in [prototype phase](./glossary.md#prototype-phase).
It does not apply to [bug fixes](./glossary.md#bug-fixing-mode), which drop planning entirely, or to
agent-facing markdown such as a [skill](./glossary.md#skill), where the file itself is the plan
(chapter 3).

The output is an approved plan whose intent sections — the direction it
serves, what this increment makes true, what must not change, and the
decisions already settled — are later pasted verbatim into the pull request
as the reviewer's oracle.

## How it works

The [plan review loop](./glossary.md#plan-review-loop) runs in stages. Each
stage has a job, and David is asked for something at only two of them.

### 1. The pre-plan conversation

Planning starts as a conversation, not a document. David describes what he
wants; Claude asks questions, forms its own view, and says where it disagrees.
Two working rules shape this stage:

- **"What do you think?" means planning, not building.** A message that
  sketches something buildable is still a conversation until there is an
  explicit go-ahead or an approved plan.
- **The first question about anything new is whether it needs to exist.**
  Before *how*: is it already handled, could something be deleted instead, is
  there a smaller thing that solves it? Every question Claude asks carries its
  own recommendation, and questions the repository can answer are not asked.

The intent agreed here is the **source of truth** for everything after it —
more than the plan, the PR title or the code. If the conversation said users
should be able to do A and B and the plan only covers A, with B recorded
nowhere, the plan is wrong.

### 2. The scope-of-work gate

Before the plan is written, Claude compresses the conversation into a
scope of work and asks David to agree it,
as a [blocking ask](./glossary.md#blocking-ask) with a push notification. It
names the direction the work serves, the intent for this increment, what must
not change, the decisions already settled, the scope boundaries already
decided, and the [ceremony](./glossary.md#ceremony) tier. For a prototype's
version, the short plan's four items stand in for the intent and settled
decisions, since nothing about a prototype is settled yet.

David's agreement does two things:

- **It authorises the loop to run without check-ins.** It is his control
  point at the front, paired with plan approval at the back.
- **It becomes the oracle.** Claude writes the agreed scope to a file, and
  the planning script refuses to run without one. A plan measured only
  against itself can be perfectly coherent and still have dropped a
  requirement.

The [workstream](./glossary.md#workstream) issue that tracks the work is
opened or promoted at this point, if it does not exist yet (chapter 10).

### 3. The scope exchange: should this exist at all?

Before any plan exists, Astra is given the oracle alone and asked one
question: should this be built, and is the boundary in the right place? David
sees Astra's answer **beside Claude's own view** — Claude's first, in its own
words, then Astra's, then where they differ — before he says go. If Astra says
the work should not exist, or not yet, that is a product question for David,
not something Claude quietly absorbs.

It costs one exchange against a document a page long, and it is the cheapest
place in the whole system to catch building the wrong thing.

### 4. The preflight and the draft

Before drafting, Claude runs every check in the preflight of
[`PLANS.md`](../../core/.agents/PLANS.md). In plain terms, they ask:

- **Is this a plan or a direction?** A *direction* describes an end state
  ("one screen governs everything an account may do") and lives with the
  product's shared docs. A *plan* builds one bounded increment toward it and
  cites the direction it serves. The increment test asks what this increment
  makes true, what bounds it, and how completion will be recognised. Wording
  like "all" or "every" is a reason to look at the boundary, never an
  automatic split.
- **What else shares the pattern?** If the change touches a pattern rather
  than one place, the affected-surface inventory finds every instance with a
  search before the scope is drawn, rather than from memory.
- **Is each completeness claim backed?** Any sentence saying a set is
  complete or a state cannot happen must name what enforces it — a check that
  was actually run, or something in the shipped system that refuses the bad
  case. Otherwise it is written down as an open uncertainty.
- **Does each line earn its place?** The specification test asks, of every
  line: *if the plan never mentioned this, what would catch it?* If the
  compiler, the tests or code review would, it stays out. A plan states
  invariants, not implementation.

Claude then writes the plan to a file in its working tree, from the template
in `PLANS.md`, with the oracle at its head. A prototype's first version gets a
short plan instead — the design question, the hypothesis, the surface it
shows, and what it leaves out — and only the increment test applies to it.

Claude tells David the draft exists and **keeps going without waiting**. The
first version always changes, and pausing on it buys nothing; David can
interject at any time.

### 5. Exchanges with Astra

Astra is the strongest [Codex](./glossary.md#codex) model, run through the Codex command-line tool in
a read-only sandbox, so it can read the repository but cannot edit what it is
discussing. Which model that is comes from the [fleet](./glossary.md#fleet)'s
[machinery pin](./glossary.md#machinery-pin), not from the script.

**One contract, two roles.** Both Claude and Astra read the same
[`planning-contract.md`](../../core/docs/ai-context/planning-contract.md),
word for word. The only thing that differs is a short role block saying who
holds the plan and who may settle a purely technical tie. If the two disagree,
it is a difference of judgement, not of briefing.

**What Astra does.** It challenges unsupported assumptions, finds missing
requirements and affected paths, proposes alternatives, and says when each
recommendation should be acted on: before approval, during implementation, as
an optional improvement, or as a decision for David. It answers in prose for
a person to read. Nothing parses it, so no phrase in an assessment can
authorise work.

**What Claude does.** Claude holds the authoritative plan, argues where it
disagrees, and investigates disputed facts itself rather than asking David to
settle something a few searches would answer. When it thinks a revision would
be built on a wrong assumption, it can ask Astra one focused question first —
no plan edit and no new assessment.

**Continuity lives in a concern ledger**, a file Claude maintains beside the
plan. Every concern keeps its original reasoning and names where it came
from, and each has a state — still open, resolved in one of several named
ways, waiting on David, or
[settled over dissent](./glossary.md#settled-over-dissent). Settled is not
closed: any entry can be pulled back into a discussion.

**After every exchange, four things happen, in this order:**

1. **Relay to David, before revising.** In plain English: what Astra
   disagrees with, and one line per concern saying what Claude is doing
   about it — act on it, leave it and why, or bring it to him. A clean
   exchange still gets its readout, because that independent opinion is what
   he would otherwise be reading blind without. An assessment that says it
   could not do the job is not a clean exchange.
2. **Update the ledger.**
3. **State the next action explicitly** — investigate, run the scope
   exchange, assess, discuss, revise, or present to David. "Approve" is not on
   the list. The next step is something Claude states, never something
   inferred from the wording of an assessment.
4. **Do it.** A revision fixes the class of problem a concern points at, not
   just the example that exposed it.

### 6. What escalates, and what does not

The loop has authority to develop the plan inside the agreed scope, and no
further.

- **David's, always:** anything that changes intended behaviour, the scope, or
  a user-facing shortfall being knowingly accepted. These go to him as
  numbered questions carrying Astra's view and Claude's side by side — never
  absorbed into a revision.
- **A scope addition** — a new table, role, endpoint, configuration area — is
  put to David as a **[now, next or never](./glossary.md#now-next-never)**
  question, defaulting to *next*. It joins *now* only when the current plan
  cannot be correct without it. A two-option scope question is a defect in
  the question.
- **A purely technical fork is not his.** Two approaches that serve the same
  agreed behaviour are for the loop to settle. If a technical disagreement
  survives investigation and discussion, Claude decides, records the
  reasoning, and marks the concern *settled over dissent*. Astra does not
  have to agree. The concern stays in full view and is named in the approval
  ask, so new evidence has something to argue with.

### 7. Approval

When the plan is ready, Claude posts the approval ask **in chat**: a short
readout — what will be built and what is excluded, why the approach fits, how
success will be recognised, remaining uncertainty and accepted trade-offs,
anything still needing his decision, and any tie settled over a dissent —
followed by **the complete plan**. There is no page, no link and no pull
request for the plan.

**Approval is explicit, in words, and nothing else counts** — not Astra's
agreement, not an empty concern list, not a harness "continue" message after
a tool error. When Claude is unsure whether it has been approved, it assumes
it has not. The scope gate authorised the loop to *develop* the plan, never to
build.

What survives the loop by default is small. The plan file stays in Claude's
working tree and reaches `main` only if David asks (after a check that it
discloses nothing sensitive). The approved plan's intent sections are quoted
verbatim into the implementation pull request, together with a line naming
the plan file and a fingerprint of its exact text at the moment David
approved it (chapter 5). The number of exchanges run goes into the
[harvest-notes comment](./glossary.md#harvest-notes-comment) on the
workstream issue. If the plan ships in phases, every phase is listed in the
workstream issue at approval, so none can be forgotten later.

### Underneath

One script, `plan-review.mjs`, runs each exchange. It assembles the package —
role block, contract, the [Worth rule](./glossary.md#worth-rule) and the oracle — launches Astra, and
saves the Markdown answer. Its machinery protects things other than a verdict:

- **The oracle is pinned** on the first exchange and checked on every one
  after, so the plan cannot be measured against an intent Claude quietly
  rewrote. A deliberate change has to be stated, with what David agreed.
- **The reviewer is pinned.** Overriding the model, effort or sandbox is
  refused unless a reason is given, and the reason is stamped on the record;
  full write access is refused outright.
- **Astra must be signed in, every session.** Sign-in is a device code David
  approves on his phone. Without it, the review is reported as not run — never
  replaced by Claude reviewing its own plan. An exchange that produced no
  assessment did not happen and is never relayed as "nothing to report".

## Why it works this way

- **Peers, not a verdict.** Until 2026-09-18 Astra returned a structured
  verdict, and the loop's stopping rule was computed from it. That made
  Astra's output the thing driving the loop. David replaced it, after working
  the question through with Astra: the two are peers, the response is prose,
  and the party holding the plan says what happens next.
- **Both read the same contract** so that disagreements mean something. If
  each party had its own briefing, a difference in conclusions could be a
  difference in instructions.
- **The relay comes before the revision** because that is the moment David can
  stop a revision he disagrees with. A readout after the fact is a report, not
  a control.
- **Chat, not a page.** The plan was once reviewed on a pull request, then on
  a private page. The plan loop now follows the same rule as the code review
  loop, where a page turned out to be something David had to go and open
  rather than something he read: he reads chat and uses it well, so the plan
  comes to him there, complete.
- **The plan is never published**, which is why the old disclosure gate on
  plans was retired. What remains is the check before a plan file is ever
  committed, if David asks for that.
- **"Next" is the default for new scope.** On one product a plan grew from
  877 lines to roughly 1,370 during its own review, because its intent was a
  sweeping end state, so every discovery was in scope by definition. The fix
  was a third destination for a discovery — not *in* and not *rejected*, but
  *next plan* — and the split between directions and plans. Notably, not one
  of that loop's [findings](./glossary.md#finding) overturned a decision from the pre-plan
  conversation; the front of the process worked.
- **The scope exchange is the cheapest round there is.** It reviews a page,
  not a plan, and it is the one place that asks whether the thing should
  exist rather than how to build it.
- **Technical ties are settled in the loop** because sending David every
  design fork would put questions on his desk the loop exists to keep off it.
  Recording the decision as *settled over dissent*, rather than *addressed*,
  keeps it honest: a concern resolved and a concern overruled are different
  facts.
- **Approval is explicit** because every other signal is ambiguous. A
  harness nudge, or two agents agreeing, can look like a go-ahead; only his
  words are one.

## Boundaries & known limitations

- **There is no stop rule and no round budget.** The loop ends when Claude
  judges that nothing more is worth writing, stated in an action block. That
  keeps the loop from ending on an arithmetic accident, and it means its
  length rests on Claude's judgement and David's attention.
- **The ledger's honesty is Claude's.** Nothing checks for a concern that was
  never written down, or detects a ledger accidentally emptied.
- **The plan's fingerprint does not prove approval.** It records which text
  the pull request claims was approved; nothing mechanical checks it.
- **An independent reviewer is only as good as its inputs.** A false premise
  in what Claude supplies produces a confidently wrong assessment, and an
  incomplete list is invisible to the assessor. That is why Claude marks
  every factual premise as checked or unverified, and why Astra is told to
  verify [load-bearing](./glossary.md#load-bearing-claim) premises itself.
- **Exchanges are slow.** Each one is a long-running process run in the
  background rather than a quick call. Astra's sign-in code also expires
  within minutes, so David has to approve it on the spot.
- **If Astra is unreachable**, Claude says so as a blocking ask and stops.
  A manual fallback — pasting the plan into ChatGPT by hand — exists, and
  Claude says plainly when it is on it.
- **Planning does not end the questions.** If something ambiguous turns up
  during the build that the plan did not cover, Claude stops and asks rather
  than guessing and flagging it later.

## Going deeper

- [`planning-contract.md`](../../core/docs/ai-context/planning-contract.md) —
  the whole authority for both parties: turning intent into a plan, early
  scope assessment, how revisions are judged, evidence, and the handoff.
- [`plan-review-loop` skill](../../core/.claude/skills/plan-review-loop/SKILL.md)
  — Claude's procedure: the scope gate, the ledger, the exchanges, approval,
  and the workstream issue's labels.
- [`PLANS.md`](../../core/.agents/PLANS.md) — the plan template and its
  preflight checks.
- [`working-modes.md`](../../core/docs/ai-context/working-modes.md) — the
  scope-of-work gate, directions versus plans, the increment test and the
  affected-surface inventory.
- [`agent-working-rules.md`](../../core/docs/ai-context/agent-working-rules.md)
  — ask versus decide, every question carrying a recommendation, and pre-plan
  intent as the source of truth.
- [`plan-review.mjs`](../../core/scripts/plan-review.mjs) — the script that
  runs each exchange; its header explains what it protects and why.

**Next:** chapter 5 — [`5-opening-a-pr.md`](./5-opening-a-pr.md), how the
approved work is built and shipped as a pull request.

*Verified against `118e076` (2026-10-03).*
