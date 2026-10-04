# Chapter 3 · Routing a request

> Before any work starts, Claude decides what kind of work a request is and how
> much process it earns. There are three routes — **feature**, **bugfix** and
> **prototype** — and, inside the review loop, two lighter **classes** of
> change that David can put outside it. The route is always announced or
> declared before any code moves, so David can veto it. The guiding principle
> is that **[ceremony](./glossary.md#ceremony) is sized to what could go wrong
> with the thing being built, not to how the request was phrased**, and that
> when in doubt Claude asks instead of reaching for the heavier path.
>
> Deep rules: [`working-modes.md`](../../core/docs/ai-context/working-modes.md)
> (the shared contract every agent reads),
> [`claude-core.md`](../../core/.agents/core/claude-core.md) *Two modes* and
> *Two classes and a phase that leave the loop* (Claude's enactment), the
> [`bugfix`](../../core/.claude/skills/bugfix/SKILL.md) and
> [`prototype`](../../core/.claude/skills/prototype/SKILL.md) skills.

## What it does

A request from David can mean very different things. "Build a screen for X"
is new behaviour that nobody has agreed on yet. "This button throws an error"
is behaviour that *was* agreed and is now broken. "Let's try a rough version
of X and see how it feels" is a design question that a working prototype
answers better than any plan could. Each of those deserves a different amount
of process, and getting the amount wrong is expensive in both directions: too
little and a wrong approach gets built; too much and a two-file change spends
days in review.

Routing is the step that picks the workflow. It answers three questions in
order:

1. **Is this about a feature David has declared to be in
   [prototype phase](./glossary.md#prototype-phase)?** If so, it goes to the
   prototype workflow, whatever it looks like.
2. **Otherwise, is it a feature or a bug?** That picks
   [feature-building mode](./glossary.md#feature-building-mode) (the default)
   or [bug-fixing mode](./glossary.md#bug-fixing-mode).
3. **How much ceremony does the artifact itself earn?** A [skill](./glossary.md#skill) file, a
   product screen and a database migration all start as "let's build X", and
   they get very different treatment.

Separately, when the change reaches review, David can place it in one of two
[review classes](./glossary.md#review-class) — **[Trivial](./glossary.md#trivial)** or
**[Documentation](./glossary.md#documentation-class)** — that skip most of the
[standard loop](./glossary.md#standard-loop). Those are covered at the end of
*How it works*.

## How it works

### First, the phase registry

Every product feature is in one of two phases, **prototype** or
**[production](./glossary.md#production-phase)**. The phase is a property of
the *feature*, not of the repository: a product routinely has some features
in each. The phases are recorded in a registry in each
[consumer repo](./glossary.md#consumer-repo)'s own declarations file, and a
feature that is not listed there is treated as production phase. That default
is deliberate — if the registry is missing an entry, the failure is more
ceremony, never less.

Every agent reads the registry **before** choosing a mode. A request about a
prototype-phase feature — "build this" and "fix this" alike — goes to the
`prototype` skill. A defect in a prototype is never a bugfix, because bugfix
mode exists to restore behaviour that was agreed, and nothing about a
prototype is agreed yet.

### Feature or bug: routing by the shape of the request

For everything else, Claude classifies the request by its shape:

- **Bug-shaped** — something that already worked as agreed is broken: an
  error, a wrong output, a symptom someone can observe. Claude enters bugfix
  mode and says so in one line, along the lines of *"Treating this as a
  bugfix — tier after diagnosis; say the word if you want feature ceremony."*
  That line is David's veto. He never has to pre-declare anything, but he
  always sees which contract is in force before code moves.
- **Feature-shaped** — "let's build / add / change X", any behaviour change,
  and any database schema change. Feature mode is the default.
- **Genuinely ambiguous** — "fix the ranking, it feels wrong" could be a
  defect or a product change. Claude asks **one numbered question**.

David can force the light path by typing `/bugfix`. Even then it is a
hypothesis, not a verdict: if diagnosis shows the "bug" is really a
behaviour change, the work leaves bugfix mode regardless of how it entered.
Classification is per request, with no sticky mode — "here's another one" is
simply classified again.

[Codex](./glossary.md#codex), which has no skill system to route with, reads
the same contract but takes the mode from David's prompt (a prompt beginning
"Bugfix mode:", for example). With no signal, Codex is in feature mode.

### How much ceremony a feature earns

Feature mode's full ceremony — a pre-plan conversation, a written plan, the
[plan review loop](./glossary.md#plan-review-loop) with
[Astra](./glossary.md#astra), David's approval, then the build, tests,
post-merge checks and a [UAT](./glossary.md#uat) script — is the right amount for **product code**.
It is far too much for some things the same phrase can ask for.

So the contract sorts artifacts into classes by **blast radius**, using one
question: *if this goes subtly wrong, will code review or David's own testing
catch it before it does damage?* Roughly:

- **Agent-facing markdown** — a skill, a contract, a prompt — gets **no plan
  document and no plan review loop.** Claude writes the real file and ships
  it. A skill's approach is legible from the file itself, so the file *is* the
  plan; reviewing a description of it would only add a second thing to get
  wrong. Its review is normally the Documentation class (below).
- **Short-lived process documents** that are thrown away after one use get
  the lightest treatment of all.
- **Product code in production phase** gets the full ceremony.
- **Migrations, backfills, auth, payments**, and any subsystem the product's
  [overlay](./glossary.md#overlay) marks sensitive get the full ceremony
  **plus** a specialist review, because their mistakes are often
  irreversible and invisible until the damage is done.

The exact classes and their wording live in the ceremony table in
[`working-modes.md`](../../core/docs/ai-context/working-modes.md); this
chapter does not restate them. What matters is the shape: the phrase "let's
build" triggers feature mode, and the **artifact** then decides how much of
feature mode applies.

**When the class is unclear, Claude asks one numbered question and does not
default upward.** The contract is explicit that "the heavier path to be safe"
is not safe: over-ceremony is the failure that has actually happened.

### Bugfix mode and its tiers

Bugfix mode drops the **planning** ceremony — no plan file, no pre-plan
conversation, no plan review loop — and keeps the **verification**. Each bug
gets its own branch off the current `main`, its own commit and its own pull
request, opened as soon as the fix is verified. Bugs are never batched, and a
fix that depends on another unmerged fix waits for it rather than stacking on
top.

The fix is classified into a [bugfix tier](./glossary.md#bugfix-tier) **after
diagnosis, never at intake**, because every risk that matters belongs to the
fix, not the symptom — what it touches, how many callers share it, whether it
changes stored data — and none of that is known until the cause is found.

- **Tier C is checked first, and it means "this is not a bug fix."** When
  the "fix" turns out to be a behaviour change or a design flaw, or it
  touches the database schema in any way, Claude stops and brings it to David. It goes to feature mode,
  except for one narrow path — a genuinely trivial database schema fix that
  David green-lights goes straight to the migration ceremony.
- **Tier B — an elevated fix.** A checklist asks *where* the fix lands — in a
  sensitive subsystem or not — and *what shape* it is: shared code rather
  than a leaf, a changed condition, concurrency, stored data, an uncertain
  diagnosis and similar signs of reach. If anything on the list trips, it is
  Tier B. Claude writes a Tier B fix itself — it is never
  handed to a cheaper [subagent](./glossary.md#subagent) — on Opus, the model
  reserved for building, and adds a UAT script when the fix
  has product-visible behaviour.
- **Tier A — a contained fix.** Nothing tripped. With that checklist, Tier A
  is the exception, and that is intended.

Tiers A and B both keep a regression test that fails on the old code, a
blast-radius check of what else shares the path, and a bugfix
[oracle](./glossary.md#oracle) in the pull request body — the reported
symptom quoted, what correct looks like, what must not change, and the root
cause — so the reviewer has something to judge the fix against besides the
diff itself. Tier C is different by construction: it has left bugfix mode,
and its one continuing path — a trivial schema fix David green-lights — uses
its own oracle block. Codex still reviews every bugfix.

### Prototype phase

A prototype-phase feature exists to answer a design question with the
product owner's own reactions to something he can use. Its **first version**
still goes through planning — a pre-plan conversation, a short plan, Astra's
review and David's approval (chapter 4) — because the point is to prototype
the *right* thing. After that, what the phase removes is the code-review loop
and every production bar: no requested Codex review, no tests, no UAT script.
Later versions are built straight from David's feedback, with no plan, unless
he asks for the planning loop again in words.

Where the prototype lives depends on whether anyone is downstream of `main`.
In a product with no users yet it lives on `main` and its pull request merges
in the same turn. In a product with live users it lives on its own branch with
its own environment and its own database, and opens no pull request at all.
In both cases publishing stays David's decision, every time.

A prototype leaves the phase only when **David declares it production**, per
feature, in words. The shortcuts recorded along the way then become the
scope of a hardening increment that runs through the full standard loop.

A pull request that touches **any** production-phase feature is in the
standard loop for the whole pull request. The stricter rule wins, because a
mixed change is exactly where a prototype shortcut would reach production code
unread.

### Two classes outside the review loop: Trivial and Documentation

These apply at review time rather than at intake, but they are part of the
same "how much process" decision.

- **Trivial** — David's "just do it" lever. **Only
  David can declare it**, in words, for one specific change, and the pull
  request quotes him. No review is requested; the change merges when CI is
  green. Codex's automatic first pass still runs and is read for one thing
  only: a top-severity [finding](./glossary.md#finding) holds the merge and goes to David.
- **Documentation** — for changes whose
  substance is prose: contracts, skills, memory notes, sweeps, and chapters
  like this one. Instead of a Codex review loop, Astra and a
  [Fable assessor](./glossary.md#fable-assessor) each read the change once,
  against the decision the prose records (quoted), and each also weighs the
  findings from Codex's automatic first pass as one input. One batch of
  corrections follows and the change merges on green CI.

**Neither class covers machinery or authority**: a script, a check, CI, a
setting, a permission, an agent's role definition, anything that widens what
Claude may do, or the review loop itself. Those stay in the standard loop
unless David declares that specific change Trivial.

### The internal tier: asking what is downstream

Changes to the process itself — scripts, checks, and any skill or contract
change that is not in the Documentation class — run the standard loop at the
[internal tier](./glossary.md#internal-tier) by default. The tier does not lower the bar for care. It only says that nobody's
money or data sits downstream, so a finding is
weighed by its effect on David's ability to direct the agents and understand
the results. A clean automatic Codex pass is the whole ceremony.

**The default is not the answer.** Before the first review Claude asks what is
downstream of *this* change. Machinery that governs approvals, publication,
credentials or destructive operations is weighed by its consequence and its
recoverability, whatever folder it lives in. If its effect could not be
trivially undone, it falls outside the
[two-review limit](./glossary.md#two-review-limit) (chapter 6) and gets the
ordinary loop.

**In this repository**, almost everything is process, so almost everything is
internal tier — but the handbook's own [`CLAUDE.md`](../../CLAUDE.md) singles
out the two things that are not automatically so: the machinery that
publishes to every product, and the settings template that carries the
permission denials. A change to either that alters what gets published or
denied is weighed on what it does; a fix to a message or to formatting is not.

## Why it works this way

- **The phrase is not the risk.** In one product, a request to build a
  status skill — two markdown files — went through the full plan and review
  loop and reached six [review rounds](./glossary.md#review-round) and a 660-line plan before anyone asked
  whether that ceremony fitted the thing being built. Sizing ceremony to the
  artifact is the correction.
- **Asking beats defaulting upward.** A one-question confirmation is cheap.
  Defaulting to the heavy path "to be safe" sounds prudent, but heavy review
  on a low-risk artifact generates new surface to review, round after round.
- **The tier waits for the diagnosis.** The earlier design picked the bugfix
  ceremony from the symptom. "Simple-seeming" describes a bug report, never a
  blast radius; only the cause tells you what the fix will touch.
- **One bug per pull request.** Batching kept half-verified fixes in flight
  and meant no reviewer saw any fix until the whole batch landed. The measured
  worst case was a "bugfix" that was really eleven leftover review findings in
  one pull request: twenty-one review rounds, most of the findings caused by
  the fixes themselves. Leftover findings are separate defects, each owed its
  own classification.
- **Routed, not declared, but always visible.** Bugfix entry used to require
  David to invoke it explicitly. What actually mattered was that he always
  knows which contract is in force and can veto it; the one-line announcement
  preserves that without asking him to pre-classify his own requests.
- **Prototypes keep planning and drop code review.** David's words: *"We want
  to prototype the RIGHT THING, but we don't want to code review it until
  we're sure it really is the right thing."* An earlier reading of the phase
  dropped the planning loop too; he corrected it within days.
- **Trivial is David's alone** because a class an agent could assign to its
  own work would be a way around review. Documentation exists because Codex
  reviews prose adversarially — a word choice marked as severe, then fixes
  and guards built around it — while Astra and Fable judge prose better.
- **Codex is an input to the Documentation pass, not left out of it.** The
  class began as a trial with Codex unread. Over seven pull requests Codex
  raised seventeen findings neither assessor did, including factual errors in
  this manual and an instruction that would have let a stranger's issue text
  reach the session that merges, while the assessors raised every question
  that was David's to answer. Each reading caught what the other missed, so
  David kept the class and gave the assessors both (2026-10-04).

## Boundaries & known limitations

- **Classification is judgement.** Nothing checks that Claude routed a
  request correctly; the announcement and David's veto are the safeguard,
  and Tier C's exit and the pause-and-ask rule catch a misroute after entry.
- **The phase registry must be current.** Routing reads it first. A missing
  entry fails safe (production phase), but a stale entry pointing the wrong
  way would route work down the lighter path.
- **The Documentation pass waits for Codex's automatic review**, up to a
  fixed time; if that review has not come back by then, the pass runs without
  it and the merge report says so.
- **The internal-tier question is asked per change**, so two changes to the
  same file can earn different treatment. That is intended, and it is also a
  judgement no script makes.
- **Codex's mode depends on David's prompt.** Codex cannot route by shape;
  without a prefix it runs feature mode.
- **Several things in the routing are judgements without a clock** — whether
  a database schema fix is "genuinely trivial", for example. The contract's
  instruction when unsure is to treat it as the heavier case and ask.

## Going deeper

- [`working-modes.md`](../../core/docs/ai-context/working-modes.md) — the
  ceremony table, bugfix tiers and their checklist, the two classes, the
  prototype phase, and how each agent enters a mode.
- [`claude-core.md`](../../core/.agents/core/claude-core.md) — *Two modes*,
  *Two classes and a phase that leave the loop*, and *Internal tooling: what
  is downstream*.
- [`bugfix` skill](../../core/.claude/skills/bugfix/SKILL.md) and
  [`live-diagnosis.md`](../../core/.claude/skills/bugfix/live-diagnosis.md) —
  Claude's bugfix procedure, including evidence-gathering from the running
  product.
- [`prototype` skill](../../core/.claude/skills/prototype/SKILL.md) — the
  questions file, the feedback rail, and what happens at the flip.
- [`agent-working-rules.md`](../../core/docs/ai-context/agent-working-rules.md)
  — the plan-before-implementation rule and when to ask rather than decide.
- This repository's tier: [`CLAUDE.md`](../../CLAUDE.md), *Ceremony*.

**Next:** chapter 4 — [`4-planning.md`](./4-planning.md), how a feature's
intent is agreed and turned into a plan David approves.

*Verified against `118e076` (2026-10-03).*
