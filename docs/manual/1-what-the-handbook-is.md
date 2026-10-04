# Chapter 1 · What the handbook is

> The AI-Handbook is one shared rulebook for how David's products get built
> with AI agents — how work is planned, reviewed, shipped and remembered —
> kept in one repository and copied into each product, so that a lesson paid
> for on one product is not paid for again on the next. This chapter covers
> what is in it, how it reaches a product, how it takes back what it stops
> shipping, and how this repository lives under its own rules.
>
> Deep rules: [`README.md`](../../README.md) (the overview),
> [`docs/consuming-repos.md`](../consuming-repos.md) (how a product takes it),
> [`CLAUDE.md`](../../CLAUDE.md) (how this repository governs itself),
> [`scripts/sync.mjs`](../../scripts/sync.mjs) (the copy itself, explained in
> its own header).

## What it does

David builds more than one product with the same cast of AI agents —
Overhype.me and DojoOS today, with more expected. The process they run is
substantial: how a request is classified, how a plan is agreed, how a pull
request is reviewed and when the review stops, what has to be true before a
merge, what gets written down afterwards, and dozens of environment gotchas
the agents have already hit and paid for. Before this repository existed that
process lived inside one product's repository, so the second product either
started from nothing or from a copy that began drifting the day it was made.

The handbook exists to end that. It ships no product of its own. Its whole
output is a directory, `core/` — the [payload](./glossary.md#payload) — which
is copied into each product's repository, where it sits beside that product's
own code and documents and is read by every agent working there.

**A copy that drifts is worse than no copy.** Two files that both claim to be
the rule, and are both plausible on their face, give an agent no way to tell
which one is current. One source and a mechanical copy is the cure.

## How it works

### Two layers: the core and the overlay

Every product repository that takes the handbook — a
[consumer repo](./glossary.md#consumer-repo) — holds two layers at every level:

- **The [core](./glossary.md#core)**, owned by the handbook: how agents work,
  true for every product. It arrives by copy and is never edited in the
  product.
- **The [overlay](./glossary.md#overlay)**, owned by the product: what the
  product *is* — its brief, users, roadmap, architecture, subsystems,
  environment, and settled decisions. It is hand-written there and the
  handbook never touches it.

The split shows up most visibly in the two files an agent reads first. A
product's `CLAUDE.md` (Claude Code's instructions) is its overlay, and its
first line imports the vendored Claude core, so the [fleet](./glossary.md#fleet) rules load
automatically at the start of every session. A product's `AGENTS.md` (the
instructions [Codex](./glossary.md#codex) and other agents read) is its other overlay; it cannot
import anything, so it links to the vendored agents core instead. That
difference has one practical consequence the handbook is careful about: a rule
that must bind Codex has to live in the agents core, where the link leads, not
only in the Claude core.

Beyond those two portable cores, the payload carries the shared contracts
(working rules, working modes, planning, review judgement, documentation,
workstream tracking, failure patterns), the [skills](./glossary.md#skill) —
procedures Claude Code loads on demand, such as `/bugfix` or `/uat` — the
[agent definitions](./glossary.md#agent-definition) for the [subagents](./glossary.md#subagent) the
review loop dispatches, the shared [memory notes](./glossary.md#memory-note)
about the environment, and the scripts that run the review and planning
machinery.

What it deliberately does **not** carry is anything true of only one product.
A handful of documents that look shared — the description of a product's
Replit setup, its decision log, its test-run contract, its pull-request
template — are written per product because their contents are per product.
The payload refers to them, and each product supplies its own.

### Which file to edit when something changes

The two-layer split exists so that this question always has one answer:

- A rule about **how the agents work**, true for every product → the core,
  edited here, in the handbook.
- A rule about **one product** — its domain, its users, its environment → that
  product's overlay.
- A settled decision and **why** it was made → that product's decision log,
  which is read on demand rather than loaded into every session.

The test for the first two, from
[`docs/porting-notes.md`](../porting-notes.md), is short: **would this still
be true, unchanged, in a repository about a different product?** If yes, it
belongs here. A worked example that names one product is fine — the failure
patterns teach by example, and a DojoOS session benefits from knowing which
Overhype.me incident proved a rule. A *dependency* on one product's code,
paths or subsystems is not.

The smell in each direction is named in the Claude core: a fleet rule being
restated in a product's overlay means it should move here; one product's
domain creeping into the core means it should move out.

### The sync: vendored, not linked

The [sync](./glossary.md#sync) is a single script that copies the payload into
a product. It is run deliberately, by hand, against one product's checkout,
and what it changes in that product is reviewed there as an ordinary pull
request, so nothing reaches a product without the same review the product's
own code gets. There is no schedule that runs it automatically today.

The copies are **vendored, not linked**: they land as ordinary files at their
normal paths, and the product carries them in its own history. Every agent and
every person reads them exactly as if they had always been there, and nothing
depends on the handbook being reachable while a product's session runs.

The routing has **one rule and one exception**:

- **The rule.** Every file under `core/` lands at the same path in the
  product, minus the `core/` prefix.
- **The exception: [seed files](./glossary.md#seed-file).** A file named
  `*.template.*` lands under its real name — the settings template becomes the
  product's `.claude/settings.json`, the machinery template its
  `.agents/machinery.json` — and only if the product does not already have
  one. From that moment the file belongs to the product: it holds the
  product's own permissions and identity, and overwriting it would clobber
  them. (One seed, the machinery file, is additionally topped up with any new
  setting the handbook's scripts have come to require, without changing a
  value the product already holds — so a product seeded long ago does not have
  its review machinery silently disabled by a newer sync.)

The sync copies what is **committed**, not whatever happens to be sitting in
the handbook's working folder, and it refuses to run while the payload has
uncommitted edits — so what a product receives is exactly what was reviewed
here.

### Taking back what is no longer shipped

Copying alone has a slow failure: a file renamed or removed from the handbook
would stay in every product that had received it, still loaded and still
obeyed — a second source of truth. So the sync also deletes, and it decides
what to delete without keeping any record of past syncs.

**Every payload file says, in its own text, that it is managed.** Each carries
a [sync banner](./glossary.md#sync-banner) — a header reading `SYNCED FROM
AI-Handbook` with a warning not to edit it in a product. When the sync runs,
a file in the product is taken back when the product's git history tracks it,
its own text carries that banner, and nothing in the current payload lands at
its path. Seeds carry no banner and are never taken back. A file with
uncommitted edits stops the whole run rather than being deleted.

Because the banner *is* the record, a payload file without one could be
delivered and never recalled. A check in this repository refuses to let one
merge.

### The fleet of products

The products that take the handbook are the fleet.
[`AGENTS.md`](../../AGENTS.md) names two consumers as of its writing,
Overhype.me and DojoOS. Both have been synced: on 2026-10-04 Overhype.me's
`main` carried 154 files with the sync banner and DojoOS's 191.

Enrolling a product is a short ordered procedure in
[`docs/consuming-repos.md`](../consuming-repos.md): write the overlay first,
create the per-product documents, verify the server-side branch protections,
and only then run the sync — adapting the seeded settings and filling in the
machinery file either beforehand, where the product already has them, or
while reviewing the first sync's pull request, where the sync is what creates
them. The order matters because a vendored core that nothing imports looks
governed without being governed.

### How this repository governs itself

The handbook lives under the same rules it ships. Its own
[`CLAUDE.md`](../../CLAUDE.md) imports the Claude core straight from the
payload, so a session working on the handbook obeys the same file every
product does. The intent is stated there in one line: if a rule is
uncomfortable to work under here, that is the cheapest possible signal that it
is wrong everywhere.

A few parts of the payload are live in this repository too, not just shipped
from it. The skills and agent definitions are reached through symbolic links
from this repository's own `.claude/` folder into `core/`, so there is still
only one copy of each. Everything else in `core/` reaches this repository only
through its instruction files: `CLAUDE.md` imports the Claude core, and the
root `AGENTS.md` links the agents core and declares it binding here, which is
how Codex and other agents are governed by the payload too. The settings template is the clearest example of
something that is purely data here: editing it changes what the next product
is seeded with, not how this repository behaves, because this repository keeps
its own separately adapted settings file.

**One rule is specific to this repository: a change here lands in every
product.** The blast radius of a one-line edit to the Claude core is every
session in every product from then on. It is why adding a file to `core/`
counts as shipping it (there is no staging area in which to park something
"not ready"), why removing one counts as recalling it, and why "not ready to
ship" and "not ready to merge" are the same judgement here.

Two differences from a product are worth knowing. Changes here run under the
[internal tier](./glossary.md#internal-tier) of review, since nobody's money or
data is downstream — though each change is still weighed on what it actually
does, and one that alters what the sync publishes or what the settings
template forbids is weighed accordingly. And because the process is this
repository's product, it keeps its own documentation exception: the handbook's
weekly [maintenance pass](./glossary.md#maintenance-pass) updates this manual
from the pull requests merged since the last pass, where a product would give
process changes no write-up at all. Both are stated in
[`CLAUDE.md`](../../CLAUDE.md).

## Why it works this way

- **Vendored rather than linked, so nothing breaks at runtime.** A product's
  agents — including Codex and Replit, which run in their own environments —
  read the rules as files already in the repository. A link to a live
  external source would make every product's session depend on the handbook
  being reachable, and would let a rule change reach a product without that
  product's review.
- **Two layers, so each rule has exactly one home.** The core owns *how we
  work*; the overlay owns *what this product is*. Without the split, every
  rule change would be a judgement about which copies to update, and the
  answer is always "the one you forgot".
- **One routing rule, because the old design proved the rest was [ceremony](./glossary.md#ceremony).**
  The sync was once described by a 1,325-line routing manifest and a
  1,176-line checker. Of the twenty routes it declared, eighteen were "same
  path, minus `core/`" and the other two were the seed files — two rules in
  total. Routing `core/**` by construction makes a forgotten file impossible
  rather than something to check for.
- **No staging, because nothing was live to break.** An earlier design gave
  parts of the payload statuses, dependency graphs and rollout cohorts, to
  sequence a gradual rollout. Sequencing a rollout is only worth doing when a
  rollout can break something live, and none could. It was deleted; if a
  staged rollout is ever genuinely needed, the smallest mechanism that
  delivers it is what to build.
- **The banner is the record, because a record of past syncs went wrong four
  ways.** A first version of the deleting sync kept a list of what earlier
  runs had delivered, and one [review round](./glossary.md#review-round) found four ways that list led it to
  delete the wrong thing — including outside the product and including a
  product-owned seed. With no stored list, every input is read fresh in the
  same run, so there is nothing to go stale or disagree.
- **Committed bytes only, because a product should receive what was
  reviewed.** An unreviewed local edit in the handbook's folder must not reach
  every product; refusing loudly when one is present is better than shipping
  it quietly or silently ignoring it.
- **Self-governance, because it is the cheapest test.** A rule the handbook's
  own sessions find unworkable will be unworkable everywhere, and this
  repository is where that shows up first and costs least.

## Boundaries & known limitations

- **The sync does not rewrite a product-owned file.** The one edit it makes
  is additive: it tops up the machinery seed with any setting the handbook
  newly requires, never changing a value the product holds. That restraint is
  deliberate, and it has a cost: when the handbook starts asking a product a new question, or
  retires a rule that a product's own documents restate, the sync cannot
  update the product's side. The enrollment procedure handles this with an
  explicit step before every re-sync rather than with machinery, and it is a
  human step that fails quietly if skipped.
- **A seed cannot deliver a requirement.** Because a seed is written only when
  absent, a product that already had a settings file never receives the
  template's contents; anything genuinely required must be merged by hand. At
  present nothing in the settings template is non-optional in that sense.
- **Nothing proves the payload's references all resolve in a product.** Some
  payload files deliberately point at per-product documents the handbook does
  not ship. A check that every such reference is either shipped or declared
  per-product does not exist yet; the list in
  [`docs/consuming-repos.md`](../consuming-repos.md) is explicitly not
  exhaustive, and its rule — any path the payload references that it does not
  ship is the product's to supply — is what to rely on.
- **There is no automatic propagation yet.** The intended model is that a
  merge here opens a pull request in each product; today a sync is run by
  hand.
- **This manual does not ship.** It sits at the repository root, outside
  `core/`, because every product has its own manual about itself.

## Going deeper

- Overview and the sync's rules: [`README.md`](../../README.md).
- Enrolling a product, the overlay templates, and the per-product documents:
  [`docs/consuming-repos.md`](../consuming-repos.md).
- Deciding where a rule belongs, and how the first split was drawn:
  [`docs/porting-notes.md`](../porting-notes.md).
- The sync itself, with its reasoning in its header:
  [`scripts/sync.mjs`](../../scripts/sync.mjs).
- This repository's own rules and how it reaches its payload:
  [`CLAUDE.md`](../../CLAUDE.md) and [`AGENTS.md`](../../AGENTS.md).
- The two portable cores:
  [`core/.agents/core/claude-core.md`](../../core/.agents/core/claude-core.md)
  and [`core/.agents/core/agents-core.md`](../../core/.agents/core/agents-core.md).

**Next:** chapter 2 — [`2-who-does-what.md`](./2-who-does-what.md), the cast:
who builds, who reviews, who advises, and what only David decides.

*Verified against `118e076` (2026-10-03).*
