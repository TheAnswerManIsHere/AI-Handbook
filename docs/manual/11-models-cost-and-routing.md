# Chapter 11 · Models, cost and routing

> Which model does which piece of work, how hard it thinks, and what that
> costs. Three ideas carry the whole chapter: **the session's model follows
> the kind of work** (a thinking model to explore, a building model to build);
> **every dispatched judgement runs at the strongest tier available**, named in
> one file; and **bounded, stateless chores go down to a cheaper model while
> anything stateful or judgement-dense stays in the main loop.** Over all of
> it sits one cost rule: a review round has a price, and it is stated before
> the round runs.
>
> Deep rules: [`claude-core.md`](../../core/.agents/core/claude-core.md)
> (*Model, cost, and routing* and *Subagent delegation is capped*), the
> [`model-routing`](../../core/.claude/skills/model-routing/SKILL.md) skill
> (the measurements and their history), and the pin itself,
> [`machinery.template.json`](../../core/.agents/machinery.template.json).

## What it does

Claude Code can run on several Claude models, and the handbook also calls on a
model from another family entirely — [Astra](./glossary.md#astra), OpenAI's
strongest Codex model, reached through a command-line tool. These differ in
strength and in price per token, and a session that used one model for
everything would either overspend on chores or underspend on the moments that
decide whether a change is right.

So this part of the handbook answers four questions:

1. **Which model is the session itself on?** That depends on whether the work
   is thinking or building.
2. **Which model runs a judgement that is handed off?** Always the strongest
   available, from one pinned place.
3. **What work may be handed down to a cheaper model, and what never may?**
   The dividing line is state, not difficulty.
4. **What does a review loop cost, and who sees the bill?** Claude states it,
   in one line, before each round.

## How it works

### The session: Fable to explore, Opus to build

David deliberately runs a session on **Fable** — the strongest, most
expensive Claude model — for the thinking half of the work: exploring
possibilities, asking "how or why do we do it this way", the pre-plan
conversation. That is the intended use, not a misconfiguration to flag.

When the work turns to **building**, the session should move to **Opus** —
for all development work, the riskiest bug fixes included; nothing is reserved
for a stronger tier (David, 2026-10-03). The
catch is mechanical: **only David can change the session model.** There is no
tool, hook or setting through which Claude can switch it, so the rule is
written as something Claude *can* keep — at the moment the conversation
crosses from discussing into building, Claude names the boundary, asks David
to switch, and does not start writing product code on Fable while it waits.

A few details shape how that plays out:

- **The ask is mandatory before product code, and only there.** Talking,
  planning and editing a doc or a process file need no switch; asking at every
  small step is exactly the overhead this rule was written to avoid. A feature
  in [prototype phase](./glossary.md#prototype-phase) is still product code:
  the phase removes review ceremony, not the model tier.
- **Staying on Fable to build needs a real reason**, and David saying so is
  one. Claude's own sense that "this looks small" is not — cheap-looking
  changes are exactly where the tier has mattered.
- **The pinned setting is not proof of the running model.** A product's
  `.claude/settings.json` pins `opus`, but a session has been measured running
  Fable with that pin in place, and sessions inside the Replit environment run
  on a cheaper model by their own local settings. So before work the contract
  reserves for Opus — a migration, a high-risk bug fix, a security review —
  Claude verifies the tier actually in play rather than inferring it.

### Effort: the second dial

Separate from *which* model is *how hard it thinks*. Effort is a level, and
it applies to every Claude model. Most levels can be persisted as a setting in
a repository's `.claude/settings.json`, which makes it a real cost lever that
needs no ask of David; the very highest level is session-only and cannot be a
repository default. Which levels exist, and which persist, is in the
[`model-routing`](../../core/.claude/skills/model-routing/SKILL.md) skill.
Effort can also be set per
[subagent](./glossary.md#subagent) in that subagent's own definition. The one
session-level dial Claude asks David to move is the model, at the build
boundary; effort is not something Claude asks him to type.

### Judgements that are handed off run at the strongest tier

Some judgements are deliberately given to a reader that did not produce the
work being judged. Today there are two live cases, and both run at the
strongest tier available:

- **The plan reviewer** — Astra, in the [plan review
  loop](./glossary.md#plan-review-loop) (chapter 4).
- **The two assessors of a [review round](./glossary.md#review-round)** —
  Astra and the [Fable assessor](./glossary.md#fable-assessor), who advise on
  Codex's findings (chapter 6). The [round
  translation](./glossary.md#round-translation) that explains a round to David
  runs on the same Claude tier.

**"Strongest" is named in exactly one place**: the [machinery
pin](./glossary.md#machinery-pin), a small configuration file
(`.agents/machinery.json`) with two entries — the strongest Claude model and
the strongest Codex model, each as a full model id and an effort level. Every
role and every reviewer refers to a *tier*, never a version, so when a better
model ships, adopting it is a one-value edit. The ids must be full ids rather
than short aliases, because the dispatch compares the model it asked for
against the one that answered, and an alias cannot be compared.

**A Claude role is bound to its tier twice, on purpose.** Its [agent
definition](./glossary.md#agent-definition) declares the model and effort in
its own header, and the dispatch also passes the model on each call. The call
outranks the header, and the header outranks the session, so each covers the
other's failure: the header catches a forgotten argument, and the argument
catches a stale, cached definition and carries a [consumer
repo](./glossary.md#consumer-repo)'s own pin. The header is also the *only*
route for effort, since the dispatch tool takes no effort argument. The
header values are never typed by hand: `scripts/check-agent-models.mjs` fails
in this repository's CI when a role's declaration drifts from the pin, and can
rewrite them from it (chapter 12).

**What actually served a dispatch is disclosed, not observed.** The dispatch
states what it asked for; the role states what it believes it is running as;
the two sit side by side, and a mismatch prints as a loud warning rather than
blocking. Nothing in the handbook claims a match it measured.

**Astra needs a sign-in each session, and that is David's phone step.** The
Codex tool authenticates by device code: Claude starts the sign-in and sends
David the code as a blocking ask, because it expires within minutes. Without a
sign-in the Astra review is reported as not run — never replaced by Claude
reading its own work.

### Routing work down: stateless and bounded only

The cost concern runs the other way too. Work that is **bounded and
stateless** — a "how does X work" investigation of the codebase, a mechanical
multi-file edit from an already-approved plan, a self-contained research
sweep, drafting from a handoff that is already complete — may go to a
**Sonnet** subagent, which is cheaper.

The test is **state, not difficulty**. A piece of work is routable when it can
be handed over cleanly and reported back in one self-contained answer. It is
not routable when it depends on what this session has accumulated. So these
never go to a subagent:

- **A review loop, or any long-running stateful loop.** Watching a pull
  request looks like the ideal chore to hand off, and was considered and
  rejected: each round carries state (what was declined and why, which threads
  are resolved) that a subagent would rebuild on every event while the main
  loop stays engaged anyway.
- **Anything where the judgement is Claude's own**, including verifying
  Claude's own work.
- **A high-risk ([Tier B](./glossary.md#bugfix-tier)) bug fix**, which Claude
  writes itself.
- **A `/document` [harvest](./glossary.md#harvest).** Its first source is the
  build session's own decisions and rejected alternatives, which a fresh
  subagent never saw — so it would drop precisely what the harvest exists to
  capture.

A judgement nobody has yet classified as dispatchable or not **does not
dispatch**: it runs in the main loop, and meeting one is a prompt to classify
it in a pull request rather than decide on the spot.

### Every dispatch is announced, and delegation is capped

Claude says when it dispatches a subagent and why — upward to a stronger
model, which spends more without David touching anything, and downward to a
cheaper one, because "which model did that work run on" is something David
cannot see and should not have to ask.

Delegation is also capped. Every subagent re-establishes context, explores,
and writes a report Claude must then read, so delegation is not free. Claude
does not delegate what it could finish in a handful of tool calls, prefers one
subagent to several, commits to a delegation rather than redoing its work,
and keeps a ceiling on how many run in parallel unless David asks for more.

### What a review round costs

The [ship gate](./glossary.md#ship-gate) (chapter 6) carries the handbook's
cost model, and its central point is simple: **a review round that returns
findings is the unit of spend, and its cost does not depend on which finding
it returns.** Two assessments that each re-read the repository, a translation
when one is owed, and Claude's own turns to package, post, reply and resolve —
the bill is the same for the wording of a label as for a real defect, and the
question of whether a finding is worth fixing is only asked after the bill is
paid. A clean round is much cheaper, because neither assessor is dispatched
when there is nothing to assess.

**Claude's main loop is the larger half of the bill, and the invisible one.**
Everything read into the session's context is paid for again on every later
turn, so a loop's cost grows faster than its round count. Two habits follow:
material bound for GitHub is not read into Claude's context when a subagent's
short summary decides the question, and **every review request states, in one
line, what the round will cost and what it protects** — the token counts are
already reported to Claude, and putting them beside what they bought is the
whole mechanism.

## Why it works this way

- **The session tier follows how David works.** An earlier rule fixed one
  model for a whole session, on the reasoning that since only David can switch
  it, nothing should depend on his switching. That stopped matching reality:
  the thinking half and the building half of a session want different models.
  Putting the boundary on Claude to *name* is what makes it survive a long
  conversation — the turn to building is visible to Claude and easy for a PM
  mid-thought to miss.
- **One tier for every handed-off judgement removes a question nobody should
  answer.** An earlier design sent some judgements to Opus and others to
  Fable, sorted by how consequential they looked. That sorting was itself a
  self-assessment by the context whose conclusions were being checked. Routing
  every dispatched judgement to the strongest tier removes the question, and
  it is cheap: the judgement moments are a small fraction of a loop's tokens
  and carry nearly all of its consequence.
- **Independence and strength are two different properties.** The point of
  handing a judgement off was always a reader that did not produce the
  conclusion; the strongest model adds a second property on top. Neither
  substitutes for the other — a dispatch that passes along Claude's own
  reasoning is not rescued by running on a stronger model.
- **Bound in two places because one place failed, repeatedly.** For as long as
  the Fable roles existed they declared no model, and when the dispatch
  forgot its argument they ran as whatever session launched them — measured
  over seven consecutive rounds on one pull request. The second assessor
  exists to be a *different* model from the one that wrote the code, so that
  was the design failing while reporting success. A check now holds the
  declarations to the pin, because an instruction that has to be remembered
  is one the repository has watched fail.
- **The pin is a tier, not a version,** so the instruction "for judgements,
  use the strongest possible model" survives the next model release as a
  one-line edit.
- **Disclosed rather than observed, by David's choice.** Reading the serving
  model independently is possible; David ruled it not worth building, since
  a wrong model here is small, easily recovered, and the self-report gives
  almost all of the tracking value. The rule that follows is about honesty in
  wording: no report says "ran on X" when all it knows is what was asked for.
- **Cost is disclosed, not ledgered.** [The #89 cut](./glossary.md#the-89-cut)
  removed round budgets, receipts and accounting that had made the loop
  measurable without making it shorter. What replaced them is a single line of
  disclosure per round, put where the decision to spend is made.
- **Read the schema, not the docs page.** The effort setting was once written
  into the contract as not existing, because the settings documentation page
  omitted it; the settings schema carried it all along. The lesson is kept
  with the routing skill: a documentation page can silently hide a key, so its
  silence is not evidence of absence.

## Boundaries & known limitations

- **Claude cannot move the session model.** Every tier other than the
  session's own is reached through a subagent. The build-boundary ask depends
  on David acting on it.
- **A model setting is read once, at session start.** Changing it affects the
  next session, not the current one.
- **Agent definitions are cached.** A newly added role may not be dispatchable
  for a while, and an edit to a loaded one may be served in its old form — so a
  test of a definition change carries a freshness marker planted in the same
  edit, or it may silently measure the old version.
- **The self-report has blind spots.** An assessor has been unable to name its
  own effort level, since its context shows effort as a number; that is stated
  once as a limit rather than raised every round. A content-safety refusal can
  fall a Fable request back to Opus mid-task, and a self-report is the only
  thing that would show it. On the Codex side there is no report at all: the
  tool exposes the model only on the request, so Astra's header claims nothing
  about what served it.
- **The pin check runs only in the handbook.** A product receives the role
  definitions carrying the handbook's pin and must not edit them, so a check
  shipped there would be permanently red for any product pinning differently.
  A product's own tier reaches its dispatches through the call argument; its
  effort for a Claude role is whatever the synced definition declares.
- **A product's pin is seeded once.** The sync creates a product's
  `.agents/machinery.json` from a template and then leaves it alone, so a later
  change to the handbook's pin does not reach an already-enrolled product
  (see [`docs/consuming-repos.md`](../consuming-repos.md)).
- **Stale references to a "tier table".** Several skills — `model-routing`,
  `bugfix`, `next` and `status-all` — point at a task-shape tier table said to
  live in `CLAUDE.md`; the portable core contains no such table. **Needs David confirmation** whether the table was retired
  deliberately and those references are stale.
- **The advisor tool** — a stronger model Claude consults at decision points —
  could not be configured with Fable when the routing skill last recorded it.
  **Needs David confirmation** whether that is still true.

## Going deeper

- The rules: [`claude-core.md`](../../core/.agents/core/claude-core.md),
  sections *Model, cost, and routing*, *Subagent delegation is capped*, the
  ship gate's cost paragraph under *Review loops*, and *Connectors → Astra*.
- The measurements, resolution order and history:
  [`model-routing`](../../core/.claude/skills/model-routing/SKILL.md).
- The pin a product is seeded with:
  [`core/.agents/machinery.template.json`](../../core/.agents/machinery.template.json);
  how a product fills it in: [`docs/consuming-repos.md`](../consuming-repos.md).
- The check that holds role declarations to the pin:
  [`scripts/check-agent-models.mjs`](../../scripts/check-agent-models.mjs).
- Running the Codex tool in a container:
  [`codex-cli-in-container.md`](../../core/.agents/memory/codex-cli-in-container.md).

**Next:** chapter 12 — [`12-the-machinery.md`](./12-the-machinery.md), the
scripts, checks and settings files underneath everything described so far.

*Verified against `118e076` (2026-10-03).*
