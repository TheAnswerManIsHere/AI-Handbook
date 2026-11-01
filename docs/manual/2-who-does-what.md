# Chapter 2 · Who does what

> Every product in the [fleet](./glossary.md#fleet) is built by the same cast: David decides, Claude
> builds and owns the work end to end, [Codex](./glossary.md#codex) reviews code on GitHub, [Astra](./glossary.md#astra) and
> a [Fable assessor](./glossary.md#fable-assessor) advise on what review [findings](./glossary.md#finding) are worth, a Fable
> [build report](./glossary.md#build-report) explains each finished piece of work to David in plain English, and Replit
> hosts the running product. This chapter says what each is for, what each
> may decide, and what is reserved for David alone.
>
> Deep rules: [`claude-core.md`](../../core/.agents/core/claude-core.md)
> (Claude's own contract),
> [`agents-core.md`](../../core/.agents/core/agents-core.md) (what binds
> every agent),
> [`agent-working-rules.md`](../../core/docs/ai-context/agent-working-rules.md)
> (the shared working rules, which win on conflict),
> [`review-proxy.md`](../../core/.agents/roles/review-proxy.md) (the
> assessors' brief).

## What it does

KITT's process is a division of labour between one person and
several AI agents, and most of its rules exist to keep that division clear:
who is allowed to decide a thing, whose opinion is only advice, and who checks
whom. The short version is that **David owns intent and approval, Claude owns
everything between intent and a working product, and every other agent exists
to give Claude an independent second opinion** — on the code, on the plan, on
what a review finding is worth, or on how a review round would look to
someone who cannot read code.

## How it works

### David — product owner and final approver

David defines what each product should do and approves the plan before
anything substantial is built. He has strong technical instincts but does not
write code, and the process is built around two things he never does: **he
never reads diffs or commits, and he never runs commands.** He verifies work
by using the product and comparing it with the intent agreed *before* the plan
was made — not against the plan, the pull request, or the code.

That shapes how everyone else behaves. Anything that needs a command is run
by an agent (through the Replit connector, when it must run in the product's
environment). Checkpoints brought to David are product intent, real
decisions, or something he can click — never a code milestone. And the
default when an agent is unsure about what the product *should* do is to ask
him, because a guess about product intent is wrong by definition.

### Claude Code — the product engineer

Claude is the builder, and owns each piece of work **end to end**: backend,
frontend, schema, infrastructure, documentation and tests, through to
merging the pull request, [syncing](./glossary.md#repl-sync) the running product, verifying it, and
reporting back. "Done" means David can exercise the intended behaviour in the
product, not that the code compiles.

Within that ownership Claude decides the routine engineering silently —
naming, file layout, structure, test approach, library choices. It routes each
request to the right amount of process, holds the plan during planning, runs
the review loop, and decides from the assessors' advice what to do about each
review finding. **A choice that is Claude's to recommend and that a corrective
commit would undo proceeds on Claude's own recommendation**, wherever it
arises — inside a plan, a bugfix, a review round, a merge or close-out —
rather than waiting on David. He takes the recommendation about nine times in
ten, and in his words *"asking me is futile"*: until 2026-10-21 this held only
inside an approved plan, and he widened it to everything. He hears about each
one the same turn, as an FYI naming the choice and how to undo it (chapter
8), and every pull request lists those choices. What still asks is short: a
closed [irreversible list](./glossary.md#irreversible-list) of actions that
reach outside the repository — publishing and production data among them,
and paid AI runs past a budget David set for the whole fleet — a plan before
it is enacted, and what only David holds or can do. A bugfix's regression test is never such a
choice; only the bugfix loop's own carve-out waives it. The rule is
[`agent-working-rules.md`](../../core/docs/ai-context/agent-working-rules.md#a-reversible-choice-proceeds-on-the-recommendation-david-2026-10-10).
Its own contract is
[`claude-core.md`](../../core/.agents/core/claude-core.md); the rules it
shares with every other agent are in
[`agent-working-rules.md`](../../core/docs/ai-context/agent-working-rules.md).

**Which Claude model runs the session is David's switch, not Claude's.**
David deliberately runs the exploratory, conversational work — possibilities,
the pre-plan conversation, the plan itself — on Fable, and moves the session
to Opus when building starts. Claude cannot change the model itself, so its
job is to name the boundary when it is crossed and not start writing product
code until the switch is made. (Chapter 11 covers this.)

### Codex — the code-review safety net on GitHub

Codex reviews pull requests on GitHub through the Codex connector. A pass
runs automatically when a pull request opens; Claude requests further rounds
after it pushes fixes. Codex returns findings —
comments anchored to lines of the change, each with a severity badge.

For product code in [production phase](./glossary.md#production-phase), Codex
review is **David's safety net, and that is the one thing never in
question**: no such pull request merges until Codex has reviewed the exact
commit that would merge. A genuine Codex outage stops production-phase building
entirely until it recovers. The exceptions are deliberate and declared, not
discretionary — certain classes of change and features David has declared
[prototype phase](./glossary.md#prototype-phase) are outside the loop (chapter
3).

Codex's findings are weighed on their merits rather than obeyed. It labels
everything as needing revision because that is its job; whether a finding is
worth writing code for is a separate judgement (below, and chapter 6). Its
opinions about branches, git or shipping mechanics carry no authority at all,
because it cannot see the environment those choices are made in. Codex reads
the agents [core](./glossary.md#core) through each product's `AGENTS.md` and is increasingly
expected to build features as well as review them, under the same rules.

### Astra — the strongest reasoning model, reached through the Codex CLI

Astra is not a separate product; it is the name for
whatever the strongest available OpenAI model is, run through the Codex
command-line tool inside Claude's own session. Which model that is comes from
a single [machinery pin](./glossary.md#machinery-pin) file, so a model upgrade
is one edit and Astra still means "the strongest reviewer of that family".
It runs read-only: it can read the repository and cannot change it.

Astra has two jobs:

- **Planning partner.** In the [plan review loop](./glossary.md#plan-review-loop),
  Astra and Claude develop the plan together as peers, reading the same
  contract. Claude holds the plan, and a purely technical disagreement that
  survives investigation and discussion is Claude's to settle, with the
  reasoning recorded. Anything about intended behaviour or scope goes to
  David (chapter 4).
- **One of two assessors on a review round.** When Codex returns findings on
  a pull request, Astra writes an independent assessment of what they mean
  and whether acting on them is worthwhile (below).

Astra needs a sign-in each session, which is David's step, and since
2026-10-29 it is **the first thing every session does, in any repository**,
before any other work — so the code goes out while he is still at the screen
that started the session. Claude starts it and sends him a short device code,
alone in a code block so it copies with one tap, to approve on his phone.
Without a sign-in,
the Astra review is reported as not run — never replaced by Claude reading its
own work.

### The Fable assessor — the second assessment, and the tie-break

The Fable assessor is a Claude [subagent](./glossary.md#subagent),
running on the strongest Claude model, that reads the same findings, the same
agreed intent and the same version of the code as Astra, and writes its own
assessment without seeing Astra's. Together they form the **[shared
judgement](./glossary.md#shared-judgement)** on a review round: both advise, and
Claude decides from the two.

Where Astra and the Fable assessor still disagree on a purely technical point
after Claude has investigated the facts, **the Fable assessor settles it**,
with its reasoning recorded; Astra is not obliged to agree. That tie-break
covers technical questions only. It cannot settle anything reserved for
David.

Both assessors work from one brief,
[`review-proxy.md`](../../core/.agents/roles/review-proxy.md), and the Fable
assessor's few extra instructions — chiefly that it has the repository and
should check premises itself rather than take Claude's word — are in its
[agent definition](./glossary.md#agent-definition),
[`fable-review-assessor.md`](../../core/.claude/agents/fable-review-assessor.md).

### The Fable build report — a second account for David

David cannot read the technical exchange between Claude and Codex, so the only
account of a build he would otherwise get is the builder's own. The
[build report](./glossary.md#build-report) is a second account: a Claude
subagent that fetches one finished unit of work from GitHub itself — the
workstream issue and its plan, every pull request and review round — and
explains it to David in plain English, in fixed sections he can scan: what
was built, the decisions taken on Claude's recommendation with their undo,
the ramifications, what ships unfixed, where it disagrees with how Claude
handled it, and what the build cost. Its account reaches him unedited, in chat
and as a comment on the workstream issue, alongside Claude's own if Claude
writes one.

**It decides nothing.** Nothing in the build or merge path reads its answer;
it writes to David, not to the loop. It is also honest about its limits:
Claude launches it and relays its output, so it guards against Claude being
*wrong*, not against Claude being deliberately misleading. It runs once per
unit of work, at close-out, and replaced a per-round translation on
2026-10-21 (chapter 6). Its definition is
[`fable-build-report.md`](../../core/.claude/agents/fable-build-report.md).

### Replit — where the product runs

Each product runs on Replit. The running copy (the Repl) tracks the main
branch, which is why merging is what makes work testable: code on Claude's
branch exists nowhere David can click. Claude reaches Replit through a
connector, and the rules for using it are narrow:

- **Syncing the Repl after a merge is Claude's job; publishing to production
  is not.** Publishing is production-facing and happens only when David
  explicitly asks.
- **The connector is for operations, diagnostics and verification, never for
  building features.** Anything meant to last goes through Claude's normal
  path of branch, pull request, review, merge and sync. Replit's own agent
  tends to start building when asked a question, so every request through the
  connector says what it must not touch.
- **David's own small display tweaks made in Replit arrive as pull requests**
  like every other change to the main branch, and take whatever review their
  content earns.

How Replit itself works — publishing, its two databases, secrets, rollback,
and the Agent's billing modes — is fleet knowledge, recorded once in
[`replit-platform.md`](../../core/docs/ai-context/replit-platform.md) and read
before any publish (2026-10-29). One finding there shapes every connector
call: an Agent request bills at the mode of the last message David typed in
that Repl's Agent chat, not at whatever the dropdown shows. How each
product's own Replit environment is set up — its database, its deploy path —
is product truth, kept in each product's repository rather than here.

### Other subagents

Beyond the two Fable roles, Claude may hand bounded, self-contained work to a
cheaper subagent — a codebase investigation, a
mechanical edit from an approved plan, a research sweep — and announces every
such dispatch. It never hands off a review loop, verification of its own
work, or anything where the judgement is its own. A few security-review
[skills](./glossary.md#skill) also bring their own specialist subagents. Chapter 11 covers routing.

### What is reserved for David

No agent agreement substitutes for David on any of these:

- **Approving a plan.** Only an explicit approval in words counts — not
  agreement between Claude and Astra, not an ambiguous nudge, and not an
  automated "continue".
- **Intended behaviour, and any shortfall a user (or David himself, using
  the agents) would feel**, where no decision he has already made covers it.
  During planning these reach him as numbered items in the plan's approval
  readout, never as a separate interrupt; a scope addition is taken as *next*
  and reported, and asks only when the plan cannot be correct without it.
- **Declaring a change [Trivial](./glossary.md#trivial), or a feature prototype phase.** Both remove
  review, and only he can grant that, in words, for that change or feature.
- **Publishing to production.**
- **Overrides.** He may overrule Claude's advice; the override is explicit,
  ends the argument, and is recorded when it settles something durable.
- **The session model and the Astra sign-in**, which only he can perform.

## Why it works this way

- **David verifies outcomes, not code, so the process is built around what he
  can actually check.** An agent that leaned on him to read a diff would be
  leaning on a check that does not happen. Independent agents provide the
  technical scrutiny; David provides the judgement about whether the product
  does what was meant.
- **Advice is independent, or it is worthless.** David's stated view is an
  input, never the answer: Claude forms its own assessment first, says what it
  rests on and how sure it is, and then reconciles. A manufactured objection is
  as useless as a manufactured agreement — the test is whether Claude said
  what it actually thinks. Every question to David carries a recommendation,
  because a question without one is deference with extra steps.
- **Authority follows evidence, not role.** David knows the product and its
  history; an agent often knows the general engineering better. Neither fact
  settles a checkable question — checking it does. The same principle runs
  through the assessors' brief: the [oracle](./glossary.md#oracle) sets the intent, while Codex's
  severity labels, Claude's explanations and each assessor's conclusions are
  arguments to weigh, not facts to accept.
- **Two assessors, because one judge failed in both directions.** Triaging
  alone, Claude once wrote code for every one of forty-one findings on a single
  pull request, because declining was harder to write than fixing. The first
  correction told a judge to decline most findings — the same quota facing the
  other way. Two independent assessments, with Claude deciding and no target
  rate either way, replaced both.
- **Neither assessment commands, so no phrase in one can authorise work.**
  Claude states what happens next explicitly. An earlier design let an
  external adjudicator's verdict decide; it went in the large simplification
  of September 2026 (the [#89 cut](./glossary.md#the-89-cut)), and the shared
  judgement replaced it as advice rather than a ruling.
- **A build report exists because the builder should not be the only
  narrator.** It is a second account, not a guarantee, and saying so plainly
  is part of what makes it useful.
- **Replit never builds, so every lasting change has one path.** A fix made
  through the connector would reach the product without review; routing
  everything through a pull request means every change to the main branch has
  the same record and the same checks. As of 2026-10-03 that includes David's
  own tweaks, after he removed the admin bypass from every branch protection.

## Boundaries & known limitations

- **Model identity is disclosed, not observed.** The Fable roles declare which
  model they should run as, and Claude also requests it on each dispatch, but
  nothing independently confirms which model actually answered; a mismatch is
  reported by the role itself. David ruled that building an independent check
  was not worth it.
- **The build report cannot protect against a misleading builder.** It defends
  against error, not deceit, because the builder launches it.
- **Astra depends on a per-session sign-in** that only David can complete,
  and the code expires quickly. A missed sign-in, like any failed dispatch,
  stops the round and is reported; it is never quietly run on the one
  assessment that did arrive.
- **Claude cannot switch its own model.** The Fable-to-Opus handover relies on
  Claude naming the boundary and David acting on it.
- **"Codex" names two different things.** The GitHub reviewer is the Codex
  connector; Astra runs through the Codex command-line tool. They resolve to
  different jobs and different rules, and only the GitHub reviewer is the
  [merge bar](./glossary.md#merge-bar).

## Going deeper

- Claude's contract — interaction rules, independent advice, review loops,
  connectors: [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md).
- What binds every agent:
  [`core/.agents/core/agents-core.md`](../../core/.agents/core/agents-core.md)
  and [`core/docs/ai-context/agent-working-rules.md`](../../core/docs/ai-context/agent-working-rules.md).
- The assessors' shared brief:
  [`core/.agents/roles/review-proxy.md`](../../core/.agents/roles/review-proxy.md);
  the judgement they apply:
  [`core/docs/ai-context/review-judgment.md`](../../core/docs/ai-context/review-judgment.md).
- The planning partnership:
  [`core/docs/ai-context/planning-contract.md`](../../core/docs/ai-context/planning-contract.md).
- The Fable roles:
  [`core/.claude/agents/fable-review-assessor.md`](../../core/.claude/agents/fable-review-assessor.md)
  and [`core/.claude/agents/fable-build-report.md`](../../core/.claude/agents/fable-build-report.md).
- How Replit works:
  [`core/docs/ai-context/replit-platform.md`](../../core/docs/ai-context/replit-platform.md).

**Next:** chapter 3 — [`3-routing-a-request.md`](./3-routing-a-request.md),
how a request becomes a feature, a bugfix or a prototype, and how much process
each earns.

*Verified against `3692e9d` (2026-11-01).*
