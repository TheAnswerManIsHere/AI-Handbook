# Porting notes — the first extraction

What was taken from Overhype.me on 2026-08-31, what was left behind, what was
changed on the way, and what is knowingly unfinished. Kept as a record because
the next extraction (or the first argument about where a file belongs) will
want the reasoning, not just the result.

## The test used to split

For each file: **would this still be true, unchanged, in a repo about a
different product?**

- Yes → handbook.
- No → stays with the product.
- "Yes, but it cites the product as an example" → handbook, example intact.
  Worked examples are how these documents teach. `known-failure-patterns.md`
  says so in its own header: each pattern is stated generally, then grounded
  in something that actually happened. Stripping the grounding to make the file
  look portable would remove the half that makes a pattern recognizable.
  Cross-product examples read fine — a DojoOS session benefits from knowing an
  Overhype migration is what proved the rule.

Where the call was genuinely close, the file **stayed with the product**. A
missing generic file is a small, fixable gap; a product-specific file synced
into an unrelated repo is noise that erodes trust in everything around it.

## What came across

| Group | Count | Note |
|---|---|---|
| Skills | 36 | Everything except the six `overhype-*` skills and `domain-modeling`, which encode product knowledge |
| Contracts (`docs/ai-context/`) | 8 | Working rules, modes, planning, plan review, documentation, workstream tracking, failure patterns, web research |
| Engineering practice | 1 | `code-review.md` |
| Memory entries | 34 | Of 65 — see below |
| Machinery scripts | 11 (+9 test files) | Review loop, readiness, project sync, guard |
| Agent definitions | 3 | Including the review-loop adjudicator |

Counts are as they stand after the review corrections below — the first cut
took two agent-environment docs and a migrations doc that had to go back, and
gained one memory entry the core links to.

## What was changed on the way

Only structural couplings — references that would be *wrong* in another repo,
as opposed to merely mentioning Overhype:

- **Named product skills → the role they play.** `overhype-plan-review` →
  "the product's plan-review skill"; likewise for the design and implementation
  skills. A consumer repo has a skill in that role under its own name.
- **"Overhype.me adaptations" → "Local adaptations"**, and
  "Local calibration (Overhype.me, …)" → "(fleet, …)". These calibrations were
  never about the product — they are about how the agents behave, and they
  apply everywhere.
- **Sensitive-subsystem list → a pointer to the overlay.** The core's ceremony
  rule said "migrations/auth/payments/visual-pipeline"; the visual pipeline is
  one product's subsystem. It now reads "any subsystem the overlay marks
  sensitive", and each repo names its own.
- **Relative links repointed** for the core files' new depth
  (`.agents/core/` is two levels down from the repo root).

Everything else — every `**Overhype:**` worked example, every cited file path
inside an example, every dated measurement — was left exactly as written.

## What stayed with Overhype, and why

**Product docs** — brief, direction, roadmap, architecture map, glossary,
`decisions.md`, and every subsystem doc (visual pipeline, taxonomy, moderation,
token rendering, accounts, security model, membership, public site, admin
console, community, legal/safety, the Stripe audit pair). These are the
product.

**Product skills** — the six `overhype-*` skills, plus `domain-modeling`, which
is about sharpening one product's domain model.

**32 memory entries** whose subject is Overhype's own code or stack: the Stripe
entries, taxonomy and canvas entries, `api-zod` codegen, `lib/db` staleness,
the test-isolation quartet (they describe Overhype's specific test database
setup), the Replit-push and Repl-install entries, admin-config typing,
auth cookie fallback, the CodeQL entry (it is about *this repo's* hand-rolled
controls), and the two Manual entries (the in-app help system is Overhype's).

**Four `scripts/check-*` guards** — `check-budget-gate-thunk`,
`check-budget-gate-unconditional`, `check-record-cost-unconditional` and
`check-return-to-parity`. These look like process machinery by name but are
product-code guards: they scan `artifacts/api-server/src` or import Overhype
source directly. They would fail on any other repo.

## Knowingly unfinished

**The machinery and guard groups are `staged` — they do not sync.**

**The identity coupling is RESOLVED** — PR #7, over ten review rounds. This
paragraph described `REPO_OWNER`/`REPO_NAME` literals in `review-budget.mjs`
and six call sites verifying snapshots against them; none of that exists any
more, and a maintainer reading the old text got two contradictory accounts of
what remains before unstaging. (Codex, PR #7 round 9 — the ninth instance in
this repo of prose outliving the change it described, which is why issue #6
exists.)

What replaced it, in one line each:

- **Identity and policy are declared** in `.agents/machinery.json`
  (`machinery-config`, mode `seed`), read from the working tree through one
  function, and stamped into every artifact the machinery mints.
- **Every artifact it consumes is compared back** — to the config, or on the
  guard path (which cannot afford a throw) to the budget that was stamped
  from it. GitHub snapshots are compared to config too, so the wrong PR's
  snapshot is refused.
- **There is no trust hierarchy.** Ten rounds built one — base commit over
  durable ref over working tree — defending against the person running the
  scripts. The threat model is a mistake, not an adversary
  (`.agents/memory/machinery-threat-model-is-my-own-mistakes.md`).
- **Every touchpoint is enumerated** in `identity-sources.yml` by what it
  reads, and `scripts/check-identity-sources.mjs` fails CI on any new or
  vanished one until a human classifies it.

The fail-closed requirement still holds and is tested in every direction: a
missing config, a malformed one, an empty checks list, an unedited template
placeholder and an unbindable record all refuse rather than default.
`.agents/memory/ci-guard-must-fail-loud-on-missing-inputs.md` is the entry that
says why, and it came across in this port.

**What still blocks `machinery` and `guard` from `ready`** is no longer
identity. It is the per-group **unstaging audit**: the instruction-vs-evidence
test applied file by file, reference canonicalization, and the runtime-import
audit — a reading of all 14 files that has not happened — plus the
`check-contract-consistency` corpus-layout assertion below.

**A second coupling, found by running the payload's own tests here.** Of the
599 machinery tests, 598 pass in this repo; the one that fails is
`check-contract-consistency`'s assertion that its scanned corpus includes
`CLAUDE.md`. That guard assumes the contract sits in one file at the repo root
— true in a consumer, false the moment the contract is split into a vendored
core plus an overlay, which is the split this repo introduces. So the guard
needs to learn about both surfaces, and that belongs in the same reviewed
change as the repo identity. Recorded rather than patched here: a one-line
path tweak to a consistency guard, made in passing inside a 180-file move, is
exactly the kind of edit that gets waved through.

The other two failures seen on the first run were not findings — they were the
receipt scaffolding gap above, and they went green once it was ported and
committed. Worth noting for the shape of it: they failed while the files
existed in the working tree and passed only after the commit, because the
machinery reads that path out of a committed ref. The suite was demonstrating
the very rule the receipts README states.

## Corrected after review

Codex's first round found four real problems, three of them one problem wearing
different hats. Recorded here because the underlying mistake is easy to repeat.

**Readiness is transitive, and the first cut ignored that.** Groups were marked
ready or staged by *what the files were* rather than by *what they depend on*.
So `contracts` shipped ready while prescribing procedures that invoke the
staged machinery; `agent-definitions` shipped the adjudicator whose only
permitted input is a record the staged machinery generates; and worst,
`settings-template` shipped ready with three hooks invoking a guard from the
staged `guard` group **and** `defaultMode: bypassPermissions` — a consumer
would have been seeded with permission bypass and no guard, strictly worse than
being seeded with nothing.

Fixed as a mechanism rather than three relabelings: groups now declare
`requires:`, and the manifest check refuses a `ready` group that requires a
staged one. The relabeling then follows from the rule instead of from judgment,
and the same mistake cannot be made silently again. The honest consequence is
that 7 of 12 groups are now staged behind the machinery — which makes the
repo-portability work a **prerequisite** for the sync rather than a preference,
not a nice-to-have to schedule later.

**The two agent-environment docs were wrongly taken.** `codex-environment.md`
instructs the Codex UI to run `scripts/codex-setup.sh` — a file that was never
in the payload — and hardcodes Overhype's pnpm packages and suite counts;
`replit-environment.md` names Overhype's session hook and its `heliumdb`
database. Both were included on the strength of a low count of the string
"Overhype", which measured the wrong thing: **product coupling is not the same
as product mentions.** They are now consumer-owned, listed as required consumer
documents in `consuming-repos.md`, and the synced files that link to them
resolve in a consumer.

**The destination-uniqueness check did not check what it claimed.** It compared
declared roots, so `dest/` and `dest/x.md` looked distinct while both wrote
`dest/x.md`; the sync would have let copy order pick a winner under a gate
asserting uniqueness. It now resolves and compares per-file destinations.

One more, self-inflicted while fixing the above and worth the same treatment:
the manifest reader took `requires: [machinery]` as the *string* `"[machinery]"`
and iterated it character by character, producing eleven confident, wrong
problems. It now refuses flow syntax outright. The test that was supposed to
cover this had been passing on a bad indent in its fixture rather than on the
flow sequence — a reminder that a passing test proves nothing until you know
which assertion carried it.

## The second round, and what it says about the first

Round 2 returned nine findings. Two were my own round-1 fixes being incomplete;
five were more payload files with the same portability problem round 1 had
already found once. That repetition is the finding worth recording.

**The portability pass was shallow, and iterating through review rounds is an
expensive way to discover that.** So the response was an audit rather than five
more edits: every payload file was grepped for references to paths, packages
and commands that do not exist in the payload, and each hit judged by one
question — **does this file tell the reader to DO something with that path, or
cite it as evidence of something that happened?** Evidence stays; instruction
does not, because an agent follows instructions.

That test would have caught all of them the first time, and it is the test to
use on the next extraction. What it removed:
`docs/engineering/migrations-and-backfills.md`, whose opening lines say schema
lives in `lib/db/src/schema/*.ts` and to apply it with
`pnpm --filter @workspace/db push-force`. What it left alone: the memory
entries citing `artifacts/api-server/src/...` in a write-up of something that
went wrong, which are grounding, not orders.

Three more files had **normative** text naming the product rather than
prescriptive commands, which is the same error in a quieter register:
`plan-review-contract.md` said the contract applies when reviewing a plan "for
Overhype.me" — read literally in DojoOS, that says the plan-review procedure
does not apply there; `workstream-tracking.md` hardcoded one product's Project
board; `documentation-workflow.md` defined the harvest as writing the
Overhype.me Manual. All three now name the consuming repo's product.

**The ownership banner is now real.** `consuming-repos.md` promised that every
synced file carries a header warning that local edits are lost. Two files had
one. 140 now do, inserted after YAML front matter where skills have it, so a
skill's `name`/`description` still parse. A promise in documentation that the
artifacts do not keep is worse than no promise: it is what an agent relies on
before editing.

## The decision that ended the loop (David, 2026-09-01)

Three review rounds returned 5, then 9, then 7 findings, with the
portability class holding at 3, 5, 5. Each pass caught a *category* and the
next round found a different one — first product names, then paths and
commands, then normative scope clauses and unconditional environment
assertions buried in retrospective notes. Two pre-registered flip conditions
tripped, and the loop stopped rather than attempting a fourth sweep.

**David's call: merge the structure with every group staged, then unstage
group by group.** Nothing syncs to any consumer on this merge. What lands is
the repo, the manifest, the check, and the payload — parked, with each group
naming the portability work that has to happen before it can travel.

The reasoning, kept because it generalizes: **179 files of prose written for
one product over months do not become portable by sweeping them.** A sweep
finds the category it was designed to find. Each file becomes portable by
being read and rewritten with one question in mind, and that is per-file work
with a finish line — not a pass over a corpus. Staging converts an
open-ended review loop into discrete, reviewable units.

### How a group gets unstaged

One PR per group. It does three things:

1. **Applies the instruction-vs-evidence test to every file in the group** —
   does this file tell an agent to DO something with a path, command, package,
   board, workflow or subsystem that may not exist in the consuming repo, or
   does it cite one as evidence of something that happened? Evidence stays.
   Instruction is rewritten to name the consuming repo's equivalent, made
   conditional, or moved out of the payload entirely.
2. **Canonicalizes the group's references, in the same read** (David,
   2026-09-01). Every reference that is an *instruction* is rewritten to the
   consumer-path form the skills already use — `` `{baseDir}/path/to/file.md` ``
   — and every `mentions` entry for a file so converted is deleted, because a
   marked instruction is a declared dependency and needs no exemption. The
   marginal cost is near zero: step 1 already reads every file in the group and
   already decides instruction-vs-evidence per reference, which is the same
   judgment call.

   **Why this is worth doing rather than leaving the checker to infer.**
   Detecting a reference in unmarked prose is guesswork, and its cost is on
   record: five review rounds went into "is this string a reference?", each
   finding a case the last rule missed (extension list, character alphabet,
   import-guard extensions, placeholder spelling, whitespace spelling), plus
   four rounds narrowing the exemption scope from a group pair down to one
   spelling's occurrence count. A canonical form makes detection exact string
   matching, and the whole `mentions` sidecar — 39 entries, each scoped five
   ways to stay honest — shrinks toward nothing, because intent is declared at
   the reference site where the author actually knows it.

   **The prose scan does not go away; it demotes.** "Not marked, therefore not
   a dependency" fails open — a future file writing `read docs/x.md for the
   method` in plain prose would sail through. So dependencies come from the
   markers, detected exactly, and the inference scan becomes a lint: *this
   looks like an unmarked reference; mark it or say it is prose.* A miss there
   is a style slip, not a lost edge. That is the point — the checker stops
   needing to be perfect, which is what made it expensive.
3. **Audits the group's runtime imports by hand** — every `import(...)` and any
   other specifier the checker cannot see (gap 2 below), confirming each
   target's group is already `ready` or is being flipped in the same PR. This is
   a checklist item rather than a convention because it is the one reference
   class canonicalization cannot reach: an executable import is code, not prose,
   so no marker can be written over it, and the checker will actively exempt it
   if a `mentions` entry happens to match.
4. **Clears the group's `blocker:` in the manifest and flips it to `ready`** —
   the check refuses `ready` while a required group is staged, so the
   dependency order enforces itself.
5. **States what was inspected**, so the next group's PR is not re-deriving
   the test.

The blockers in `sync-manifest.yml` are the queue, and the manifest's own
header defines what one is — read that first, because this paragraph
contradicted it until round 10 caught the disagreement. A blocker names the
**category** of work with enough specificity to start from, illustrated by
specific files and specific problems. Those named instances are examples, not
the boundary.

**The practical consequence, which is the thing the contradiction endangered:**
clearing a blocker means auditing the whole group against the category it
names, not fixing the passages it happens to cite. A maintainer who fixed only
the named instances and flipped the group to ready would ship every remaining
instance to every consumer — with the manifest asserting the work was done.

### The order that falls out of the dependencies

**This order is generated, not written.** `check-manifest` derives the whole
dependency graph from the payload's own references and fails when a group
references another it neither requires nor classifies. Everything below is read
off that graph; if it and the manifest ever disagree, the manifest is right and
this section is stale.

Earlier versions of this section were written by hand, corrected by hand four
times, and wrong every time — including in the specific way that matters most:
three of them opened with "machinery first, it depends on nothing," which was
false, because two corpus-wide gates were filed under `machinery` and dragged
contracts, skills and planning in behind them.

Make that **five** hand-corrections. The sentence "machinery — depends on
nothing" was true again for one PR, and PR #7 falsified it the same day by
adding `machinery-config`. A paragraph whose whole subject is having got this
wrong four times got it wrong a fifth, which is the argument for
[issue #6](https://github.com/TheAnswerManIsHere/AI-Handbook/issues/6) in a
sentence: this ordering is DERIVABLE from the manifest, and every version of it
written by hand has been wrong. Until the check generates it, treat what
follows as commentary and `node scripts/check-manifest.mjs` as the authority —
it is the thing that actually refuses a bad order.

1. **`machinery` + `machinery-config`, in ONE PR.** A two-group cycle: the
   scripts open `.agents/machinery.json`, and the seeded file is inert with
   nothing to read it. They are two groups only because a group carries a
   single mode, and the scripts are `sync` while the config is `seed`. Neither
   flips alone — the check rejects the first step if you try.
2. **`agent-definitions` + `contracts` + `engineering` + `memory` + `planning` +
   `skills`, in ONE PR.** Six groups, one dependency cycle, ~151 files. Not a
   sequence and not decomposable: each member carries mandatory references into
   the others, so any subset ships with a route into a group still staged. The
   check evaluates the manifest's final state, so flipping all six in one commit
   passes and any subset fails — the cycle behaving as a constraint rather than
   as a bug. **This is the large piece of work in the whole plan.**
3. **`guard`** — requires `machinery` and `memory`. `guard-decision.mjs`
   statically imports `pr-ready.mjs` and `review-budget.mjs`; delivered without
   them the hook exits `ERR_MODULE_NOT_FOUND` before evaluating any command, so
   it fails instead of guarding. It requires `memory` because its refusal
   message ends by naming a memory entry to read — an instruction, not evidence
   (issue #4). That dependency is what moved this step from second to third.
4. **`agents-core`** — requires `contracts` and `planning`.
5. **`receipt-scaffolding`** — requires `machinery`.
6. **`claude-core`** — requires eight groups, which is everything except
   `settings-template`. It also now delivers the two corpus-wide gates, since
   they only make sense once the contract is whole.
7. **`settings-template`** — requires `guard`, and is seeded rather than synced.

### Why a file's group is a claim about its dependencies

Three times a sharper check produced a dependency that turned out to be an
artifact of **where a file was filed** rather than anything in the code, and
three times the fix was to move one file:

| Round | File | Was in | Moved to | Manufactured |
|---|---|---|---|---|
| 9 | `guard-decision.test.mjs` | machinery | guard | machinery ↔ guard |
| 10 | `review-loop-adjudicator.md` | agent-definitions | machinery | machinery ↔ agent-definitions |
| issue #2 | the two corpus-wide gates | machinery | claude-core | machinery → contracts, skills, planning |

The rule that falls out: **when a group's dependency is surprising, check
whether the grouping is describing the code or fighting it.** The third case is
the one that cost most — it invalidated the plan's opening line for four rounds
without anything contradicting it, because the claim lived in prose and the
check could not see the references that disproved it.

## Not yet built

- **The sync workflow itself.** This PR establishes the payload and the
  manifest that describes it; the automation that reads the manifest and opens
  pull requests in consumers is the next PR.
- **Repo-portable machinery.** As above.
- **Consumer overlays.** DojoOS's `CLAUDE.md`/`AGENTS.md` overlay, and
  Overhype's migration from local copies to vendored ones. Overhype goes last
  deliberately: it is the running contract, and its diff has to be provably
  content-identical before its local copies are deleted.

## The third round of the same lesson (round 5, 2026-09-01)

Round 5 returned fourteen findings on a head that rounds 1–4 had already
worked over. Every one was verified against the files before being acted on,
and every one was correct. They fell into four groups, and the split is the
useful part of the record:

- **Five findings on the manifest's dependency graph.** `planning` needed
  `contracts` and `engineering`; `contracts` needed `planning`; `engineering`
  needed `contracts`; `agents-core` needed `planning`; `skills` needed
  `contracts`. These were not hardening — they were the load-bearing content of
  this PR being wrong, and they rewrote the unstaging order above.
- **Four on the check.** `posix.normalize("..")` is `".."`, which never matched
  the `"../"` prefix test the escape guard was built around. A key on a list
  item's dash line was invisible to the duplicate-key guard, so `- id: original`
  followed by an indented `id: overwritten` merged silently — on the one field
  that decides group identity. Emptiness was measured before exclusions, so a
  group excluding every leaf could be marked ready and satisfy a `requires`
  while delivering nothing. And a misspelled `requires` was kept by the reader
  and ignored by the gate.
- **Four on this repo's own docs**, all the same shape: describing the intended
  system as though it were the running one. The README advertised agent
  environments as shared payload and the sync as current behaviour; the
  enrolment steps ran the sync before the flip that makes a repo a sync target.
- **One on CI**, which was the largest gap: 599 payload tests existed and none
  of them ran. 581 now run on every PR. The one genuinely unrunnable file is
  excluded by name with a step that fails when the exclusion stops being
  earned, so the carve-out cannot outlive its reason.

**The pattern across five rounds, which is the thing to carry forward:** each
round found a *new category* rather than more of the last one — product names,
then paths and commands, then normative scope clauses, then unconditional
environment assertions, then a dependency graph inferred from labels instead of
links. A sweep finds the category it is looking for. What actually closed each
one was a mechanical check that could not be talked out of its answer, which is
why four of round 5's findings became parser rules and tests rather than a note
saying to be careful.

## Round 6, and the sweep that recurred one level up (2026-09-01)

Eight findings on `0a5236a`. Four were recorded against blockers rather than
fixed — payload content, staged, not shipping — and four were fixed here. Two
of the fixes are worth the record because both were defects in the *previous
round's* fixes:

- **The expiry guard did not verify what it claimed to.** Round 5 added a CI
  step that runs the one excluded payload test and fails if it *passes*, so the
  carve-out could not outlive its reason. But it branched on the exit code
  alone, and a nonzero exit proves only that something failed — an unrelated
  regression in that file would take the same branch and the step would report
  the exclusion as earned. Demonstrated with a throwaway failing test before
  fixing. It now asserts the exact shape: one failure, carrying the documented
  `not scanned: CLAUDE.md` assertion.
- **The required-consumer-documents table was a sweep.** Round 5 added three
  missing entries and I wrote that the sweep "found no fourth missing target."
  Round 6 named three more. A mechanical pass over the payload's outbound
  references finds more still. The claim was false because the oracle behind it
  was three greps for three named files — a completeness claim resting on a
  check that could only ever confirm what it was handed.

The second is the round-5 lesson recurring one level up. Rounds 1–5 established
that *payload portability* does not yield to sweeps. Round 6 shows that the
*inventory of what a consumer must own* does not either — and for the same
reason, which is that both grow as the corpus does. The fix was therefore not a
longer table but a stated rule ("any path the payload references that `core/`
does not ship is consumer-owned"), the table demoted to examples of it, and a
link-resolution check recorded as an unstaging requirement on the two groups
whose files carry the references.

**Generalised, since it has now cost six rounds:** when a finding's fix is "add
the missing entries," the next round finds more entries. The disposition that
converges is to state the invariant and queue the check that enforces it. A
list is a snapshot of a sweep; a check is the sweep run continuously.

## Round 7: deriving the graph instead of correcting it (2026-09-01)

Three findings, all on this repo's own artifact rather than the payload — the
first round with none of the payload-portability class.

Two were undeclared dependency edges (`contracts` → `skills`, `guard` →
`machinery`), which is the third consecutive round correcting this graph by
hand. Round 6's recorded lesson said what to do about that: when the fix is
"add the missing entries," state the rule and build the check. So the check got
built. It resolves every markdown link and static import in the payload, maps
each target to the group that delivers it, and fails when a group references
another it does not require, treating transitive edges as satisfied and cycles
as legitimate.

It found five undeclared edges. Two were the ones reported; three —
`contracts` → `memory`, `engineering` → `memory`, `memory` → `contracts` — had
survived every round to that point.

**And it changed the plan.** With the full graph declared, `contracts`,
`engineering`, `memory`, `planning` and `skills` are one strongly-connected
component: five groups, ~75 files, that can only go ready together. The
staging design assumed the corpus decomposed into independently shippable
units; for its middle, it does not. That is a fact about the corpus which no
amount of care in writing the manifest would have surfaced, because the
manifest is where the assumption lived.

The third finding was that `check()` validated `groups` and never `consumers`
— so a misspelled `enroled: true` would leave every consumer un-targeted, the
sync silently delivering nothing, and the build green. Now validated: known
keys, `owner/name` shape, boolean `enrolled`, no duplicates, non-empty.

**The self-inflicted bug worth recording**, because it is the same shape as the
false completeness claim in round 6: the derivation's first version skipped any
link containing `#`, and the single reference proving `planning` depends on
`engineering` carries a heading anchor. A check written to find missing edges
was silently dropping one — caught only because the prototype's output was
compared against what the rounds had already established by hand. **A new check
is not evidence until something independent agrees with it.**

## Round 8, and what a blocker is for (2026-09-01)

Seven findings. Four fixed, three recorded — and the split is now stable enough
to name as a rule rather than a per-round judgement.

**The fixes were all self-inflicted, and one of them is the useful lesson.**
Round 6 moved the enrollment flip earlier, to fix a deadlock where the sync
skipped a repo still marked `enrolled: false`. Round 7 then added two steps —
verify the branch ruleset, merge the guard hooks into an existing settings file
— and placed them *after* the flip, because that is where new steps naturally
go. The result was worse than the original bug: a repo eligible for a
merge-triggered sync before the controls constraining it existed, able to
receive `bypassPermissions` without the ruleset and an inert guard without its
hooks. Neither change was wrong on its own; the ordering invariant was
invisible because nothing stated it. It is stated now — **the flip is what
makes the sync fire, so anything that must be true before delivery goes above
it, and a step added later belongs above it too.**

The other three: the derived-dependency check read only double-quoted static
imports, so the gate's answer depended on the author's formatting; consumer
slugs were compared by raw spelling while the payload compares them
case-insensitively; and `receipt-scaffolding` carries a non-Markdown file
without owing the ownership warning its sibling groups owe.

**The three recorded findings prompted a change to the manifest's header**,
because rounds 5, 6 and 8 have each read the blockers as exhaustive inventories
and reported that a group's blocker "does not name" some further non-portable
passage. That reading is wrong, and leaving it uncorrected would grow the
blockers without bound while the payload stayed exactly as unportable as it is.
A blocker names the **category** of work with enough specificity to start from.
The payload is 179 files; enumerating every instance in the manifest would be
the sweep that staging exists to replace with per-file work.

So the rule, now in the manifest itself: **an instance is worth adding only
when it names a different category, or fails in a different way than what is
already listed.** All three of this round's were kept on exactly that test —
`working-modes.md` is normative where the recorded item was illustrative; the
lock sweeper is a script that silently never runs where the recorded items are
prose that misleads; the two skill identities fail in code, and the Sentry one
fails by *succeeding* against another product's data, which is the worst
failure shape in the set.

## Round 9: when refining the regex became the wrong move (2026-09-01)

Three findings — one fixed, two recorded.

The fixed one was that the derived-dependency check could not see multiline
named imports or `export ... from` re-exports. Round 8 had already extended the
same regex once, for single quotes. **Two consecutive rounds growing one
pattern is the signal**, and it is the same signal this repo has now recorded
three times in different clothes: enumerating cases is a list, and lists of this
kind do not converge.

So the approach changed rather than the pattern. Every static form — single or
multiline, `import ... from`, `export ... from`, `export * from`, a bare
side-effect import — puts the module specifier in exactly one place. Matching
the **specifier position** and ignoring the statement shape covers all of them
at once, and the seven forms are pinned by test.

Two things came out of that change:

- **The check had been blind on the live payload, not hypothetically.**
  `pr-ready.mjs` already imports `review-loop-record.mjs` with a multiline named
  import. Both are in `machinery`, so no edge was wrong — but the gate had been
  reporting OK while unable to see real imports in the corpus it was gating.
- **It immediately found an edge nothing had seen:** `machinery` delivers
  `guard-decision.test.mjs`, which imports the module `guard` delivers. The fix
  was the grouping, not the graph — the test moved into `guard`, where its
  subject already lives. Declaring the edge would have created a
  `machinery` ↔ `guard` cycle manufactured by where a file was filed rather
  than by anything in the code. **A cycle that appears when a check gets
  sharper is worth interrogating before it is accepted.**

The bias in that check is deliberate and now stated in the code: it errs toward
over-detection, since a specifier inside a comment would read as a dependency.
The failure directions are not symmetric — over-declaring makes a group wait for
one it did not strictly need, while under-declaring ships a consumer a module
graph that fails at load.

The two recorded findings were both `machinery`, and both were tested against
the bar the manifest header now states. The worktree bug earned a new item: the
recorded item (4) is that nothing invokes the lock sweeper, this is that the
sweeper is wrong about where locks live in a supported layout, and they need
different fixes. The `check-docs-accuracy.mjs` finding did **not** earn a new
item — it is the same corpus-definition assumption already recorded for
`check-contract-consistency.mjs`, so it extended that item instead. It did add
something: that assumption fails in the *consumer*, not only here, and silently
exempts the two files every overlay routes through.

## Round 10: the last round on the grant (2026-09-01)

Three findings — two fixed, one recorded. Findings per round: 5, 9, 7, 7, 14,
8, 3, 7, 3, 3.

**A contradiction this document was carrying.** Round 8 added a definition of
what a blocker is to the manifest header — a category, illustrated by
instances. This file still said each blocker "names the specific files and the
specific problem, **not a category**," which is the opposite. The danger is
concrete rather than editorial: a maintainer reading only this file would fix
the cited passages, flip the group to ready, and ship every remaining instance
to every consumer with the manifest asserting the work was done. Both documents
now state the same contract, and both state the consequence — **clearing a
blocker means auditing the whole group against the category, not fixing its
citations.**

**A dependency class the derived check could not see.** `skills` needs
`agent-definitions`: the semgrep skill spawns `semgrep-scanner`,
differential-review delegates to `adversarial-modeler`. These are references by
**name**, not by path, so no link resolver would ever find them — which is how
the edge survived nine rounds of review, three of which were specifically about
this graph. The check now derives the set of agent names *from the payload
itself* and treats a word-bounded mention as a reference, so adding an agent
extends the check with no edit to it.

It immediately found two more: `claude-core` names the adjudicator (satisfied
transitively once `skills` declared the edge), and `machinery`'s
contract-consistency test asserts the adjudicator file is in the scanned
corpus.

**That last one produced a cycle, and last round's rule was applied to it.**
`agent-definitions` required `machinery` because the adjudicator's only input
is the record generator; `machinery` now referenced `agent-definitions`. The
cycle was real in the sense that both edges were real — but it existed because
three agents were grouped by *where their files sit* rather than by *what they
depend on*. `review-loop-adjudicator` is machinery; `adversarial-modeler` and
`semgrep-scanner` are skill helpers. Moving one file dissolved the cycle and
left `agent-definitions` depending on nothing.

**Twice now, a sharper check has produced a cycle that was an artifact of
filing rather than of code, and both times the fix was to move a file.** The
rule generalises: when a group's dependency is surprising, check whether the
grouping is describing the code or fighting it.

The recorded finding is `machinery` item (6), and it is the most serious thing
found in the payload across ten rounds: the lock sweeper can delete a *live*
lock. Two overlapping instances can each classify one stale lock as eligible,
the first deletes it, git creates a fresh lock at that path, and the second
deletes the replacement — corrupting an in-flight git operation. The blocker
now orders its own items by that: (4) never runs, (5) runs and does nothing,
(6) runs and does harm.

## Issue #2 — the derivation, and what it could not decide (2026-09-01)

PR #1 merged with three known defects. Fixing them turned out to require one
change of approach and one honest admission about what a check can do.

### The approach change: one extractor, bounded resolution

The derivation had grown **three syntax-specific extractors** — js import
specifiers, markdown links, and nothing at all that could see a backtick-quoted
templated path. Two consecutive review rounds each found a form the previous
one missed. That is the list-shaped failure this repo has now recorded four
times.

The fix was to stop extracting by syntax. There is an unbounded number of ways
to *write* a reference, but a **bounded** number of ways one file can
*identify* another:

1. by a path relative to the referring file
2. by the path it will have in a consumer
3. by a name that is not a path at all

So: one permissive extractor grabs anything path-shaped, and resolution against
those three decides what is real. A token that resolves to nothing costs
nothing.

### The admission: a syntactic check cannot make a semantic call

Turning it on produced **sixteen** undeclared edges — and declaring them all
collapses **ten of twelve groups into one cycle**, which would end the staging
design outright. So the resolver was over-detecting, and the reason is worth
stating precisely, because it is not fixable by a better regex:

```
"The refusal lives in `guard-decision.mjs`"                 <- evidence
"Use `{baseDir}/skills/differential-review/adversarial.md`" <- instruction
```

Identical shape. One is a dependency and one is not, and the difference is the
verb. This is the **instruction-vs-evidence test** the repo already applies to
payload files, applied to references instead — and like the original, it needs a
reader.

Of the sixteen: **two were real** (`agent-definitions` → `skills`, and
`claude-core` → `receipt-scaffolding` through a file the corpus gate actually
reads) and **fourteen were evidence** — doc comments, a test fixture writing a
fake file at a path, error strings pointing a human at a memory entry.

So the manifest gained `mentions:` — the same observation as `requires`, with
the opposite conclusion recorded and a mandatory reason. Unlike the syntax list
it replaced, this list is **bounded by the corpus rather than by imagination**,
it shrinks as payload is rewritten, and nothing can slip past it: an
unclassified reference still fails the build.

### The third misfiled file

`check-contract-consistency.mjs` and `check-docs-accuracy.mjs` were filed under
`machinery`. Both are, by their own headers, gates over the **assembled**
contract — one scans CLAUDE.md, AGENTS.md, PLANS.md, `docs/ai-context/` and the
skills; the other is "a docs-accuracy gate for the repo-native agent context
system." Filed as machinery they made the group everything waits on depend on
`contracts`, `skills` and `planning`.

Round 9 recorded this as a portability defect in the scripts. It was *partly*
that and mostly this — and the first draft of this section said "it was not,"
which overclaimed. Moving them restored `machinery` to dependency-free, making
"machinery first" — the plan's opening line since round 7 and false for every
one of those rounds — true. It did **not** widen what the gates scan: neither
inventories `.agents/core/`, so in an assembled consumer the two vendored core
contracts are exempt from the gates meant to protect them. That is now a
`claude-core` blocker condition.

**The distinction worth keeping:** a file in the wrong group and a file with a
wrong inventory look identical from the manifest, and fixing the first does not
fix the second. Moving a file changes *when* it is delivered, never *what it
does*.

That is the third time (rounds 9, 10, and here) that a sharper check produced a
dependency which was an artifact of filing. The table above records all three.

### What is verified, not asserted

The documented order was walked step by step, flipping each step's groups to
`ready` against the real check:

```
step 1: +machinery                                          -> PASS
step 2: +guard                                              -> PASS
step 3: +agent-definitions+contracts+engineering+memory+planning+skills -> PASS
step 4: +agents-core                                        -> PASS
step 5: +receipt-scaffolding                                -> PASS
step 6: +claude-core                                        -> PASS
step 7: +settings-template                                  -> PASS
```

Four earlier versions of that order were written by hand and every one was
wrong. This one is read off the graph the check derives, and the walk above is
the oracle rather than a reading of it.

### Round 1 on the fix: the exemption was itself too broad

The first review of the fix found four things, and the P1 was the risk the PR
body had already named without taking far enough. `mentions` exempted a
**group pair**, so once `machinery` was classified as merely mentioning
`guard`, a real import of `guard-decision.mjs` added later would be suppressed
too — the classification silently widening itself as the payload changed.

Two changes, because scoping alone does not close it:

- **Entries name the `ref` they exempt** (and optionally the `from` file).
  Scoping immediately surfaced two references the group-wide form had been
  hiding: `memory` and `contracts` each reach `guard` through *two* files, and
  only the first of each had been classified. The mechanism found its own
  under-reporting the moment it got tighter.
- **A static import is never exemptible.** Everything else about a reference is
  ambiguous; `import x from "./y.mjs"` is not. This closes the exact case
  scoping cannot: evidence classified in a file, then a real import of that
  same file added to it.

The other three: the ownership-warning requirement did not travel with the two
moved gates and now does; the gates' inventories still omit `.agents/core/`, so
"moving them resolved it" overclaimed — the *grouping* is fixed, the
*inventories* are not, and that is now a `claude-core` condition; and the
extractor still hardcoded a file-extension list.

**That last one is the one to remember.** The extractor called itself
syntax-independent while omitting `.py`, `.ts`, `.html`, `.dot`, `.gitignore`
and three files with no extension at all — the same list-shaped failure, one
level down from the syntax list it had just replaced. The token shape is now
derived from the payload's own filenames. Replacing a list with a mechanism
does not help if the mechanism contains a list.

### Round 2: the extraction itself was the enumeration

Six findings. The one that mattered was small on its face — the token
extractor's character class omits `+`, so a payload file named `c++.md` is
invisible — and decisive underneath: **that is the second enumeration found
inside the derivation in two rounds.** Round 1 found the extension list; this
found the alphabet.

Patching it would have added `+` and waited for the next character. The
registered stop condition was a *third* such round, and rather than walk toward
it, the approach changed.

**The inversion.** Extracting path-shaped tokens from prose and then resolving
them needs a regex; a regex needs an alphabet; an alphabet is an enumeration.
So stop extracting. **The payload is the search set.** For each candidate
target, compute the strings that would actually name it — the relative path
from the referring file, the destination path, and the destination's unique
trailing segments — and look for those in the text. Nothing is enumerated,
because every form is computed from two real paths. `c++.md` works for free,
and so does whatever the next surprising filename is.

The boundary test came with it, and it too has no alphabet of its own: it asks
what *surrounds* a match. A word character before means a longer name; a slash
before means a longer path — unless what precedes the slash is a `}`, which is
a template segment standing in for an unknown root. A dot after is sentence
punctuation unless a word character follows it, which makes `two.md.bak` a
different file from `two.md`.

**What the tightening cost, and why it was worth it.** Two of the six findings
were that exemptions were still too broad: `group` was never checked against
the ref's actual owner, so a typo would exempt a file that group does not
deliver; and `from` was optional, so an entry whose reason named one file
silently covered every other file in its group. Both are now mandatory. The
classified set went from 14 entries to **34** — every one of the twenty new
ones a reference that a looser rule had been hiding. The last few were third
and fourth files in a group referencing the same target for entirely separate
reasons, which is exactly what a per-group exemption cannot express.

One finding was declined with the reasoning recorded: ambiguous suffixes are
skipped rather than reported as errors. The corpus contains exactly **two**
ambiguous suffixes, `README.md` and `SKILL.md`, and all nine references
matching them are generic prose. Erroring would demand nine exemptions for
things that are not references, which devalues the exemption list. What would
change this: a payload file whose *only* identifying form is ambiguous.

A usability defect surfaced while fixing the rest — the check reported one
problem per group pair while exemptions are per source file, so a maintainer
fixed one and got the next, one round-trip at a time. It now reports every
unclassified reference.

### Round 3: the enumerations were in the parts that ask about syntax

Six findings, all real, all fixed on David's grant of five further rounds.

**Two more enumerations — the third and fourth.** The static-import guard
gated on file extension (`.js/.mjs/.cjs`, omitting the payload's own `.ts`
file), and the boundary rule accepted a preceding slash only before `}`,
encoding this repo's `{baseDir}` spelling as though it were the general case.

Both are now gone rather than extended, and both removals were **measured
free** before being made:

- The import guard no longer asks what kind of file it is looking at, only
  whether the text contains an import naming this form. The cost is that
  documentation showing an import example can no longer be classified as
  evidence — which fails *closed*, and is free here: the one non-JS payload
  file containing import syntax names `./yourModule` and `./factTextEdit`,
  neither of them payload.
- The boundary rule accepts any preceding slash. Removing the rejection
  entirely changes this corpus's reference count by **zero**, so the `}` case
  was the only thing it decided.

That second removal took a real protection with it, which is the part worth
recording: the slash rejection had been *accidentally* excluding URLs. URL
exclusion is now stated deliberately — walk back over the unbroken
non-whitespace run and look for `://`, which is what makes a URL a URL rather
than a list of schemes. **Removing an over-broad rule can remove a correct
behaviour that was riding on it.**

**Two "wrong layout" bugs, one function.** `referenceFormsFor` computed the
relative form between `core/` paths, and `namedEntities` matched agent names
against source paths — both asking where files *sit* when the question is
where they *land*. This is the same error that put two corpus-wide gates in
the wrong group, committed again in the code written to fix it. Both now use
`destOf`. It was not hypothetical: `settings.template.json` becomes
`.claude/settings.json` on delivery, so the precondition was live; nothing
broke only because a second form covered it, which is redundancy rather than
correctness.

**The time axis of an error already closed on three spatial axes.** `mentions`
entries were read only to suppress a detected reference, never checked in
reverse — so an entry whose evidence had disappeared would sit there and,
the day its source gained a *real* reference to the same target, exempt it
with nobody reading the new evidence. Every entry must now match a reference
detected in the same run. Three earlier tightenings closed scope (`ref`,
`from`, `group`); this closes time.

**And a third doc-versus-manifest contradiction:** the blocker said
`claude-core` unstages "last" while the generated order ends with
`settings-template`. Each time, the manifest changed and a sentence describing
it did not. Three instances in two PRs is a pattern, and the pattern's fix is
to derive the prose claim rather than restate it — recorded here rather than
built, because it is a different piece of work.

## Known gaps in the dependency check (round 6, 2026-09-01) — CLOSED HERE

David granted rounds 5 and 6 with the terms stated up front: *"If, after those
two rounds there are still holes, document them and let's move on."* Round 6
found three. All three are recorded here rather than fixed, per that
instruction, and the loop ended on `571a4b0` — a head round 6 reviewed.

**Every one of them fails OPEN.** The check misses a real reference rather than
inventing one, so the failure is a group flipping to `ready` while something it
genuinely needs is still staged. That is stated plainly because it is the worse
of the two directions, and because the unstaging PRs are the compensating
control: each one reads every file in its group by hand, and the unstaging
procedure above now converts references to a canonical form as it goes.

**That canonicalization dissolves gap 1 and does NOT dissolve gap 2.** An
earlier version of this paragraph claimed both, and it was wrong. Canonical
markers are a convention for *prose instructions to an agent*; a runtime
`import("../b/two.mjs")` is executable code, and no prose marker can be written
over it. Gap 2 survives conversion untouched, which is why the unstaging
procedure carries an explicit runtime-import audit as its own step. Recorded
because this is the error that matters most in a gap list: a note claiming a
gap is handled stops the next session looking.

| # | Gap | Live on this corpus? |
|---|---|---|
| 1 | A reference to a **directory** produces no edge | No instance found |
| 2 | A **dynamic** `import()` is invisible AND exemptible | **One instance**, same-group |
| 3 | A **non-normalized** specifier may lose its edge | No instance; needs a second precondition |
| 4 | An occurrence **edited in place** keeps its count, so an exemption survives its evidence changing meaning | Latent |

### Gap 1 — directory references

`Read ../b/ before proceeding` is a real dependency on the group delivering
that directory. Reference forms are computed per *file*, so no form is ever
`../b/`, and the check returns nothing:

```
run("Read ../b/ before proceeding")  ->  []
```

Closing it means adding uniquely-owned consumer directories to the search set.
Bounded work, and the same shape as the `/command` mechanism added in round 5 —
a fourth way a payload file can be named.

### Gap 2 — dynamic imports, the sharpest of the three

`await import("../b/two.mjs")` is a runtime dependency as hard as a static one:
the module loads when that path executes or the code fails. The specifier
pattern requires the quote to follow `import` directly, so a dynamic import
matches nothing — and because `importsIn` returns false, **a standing `mentions`
entry actively exempts it.** Measured:

```
dynamic import, with a scoped exemption for that exact form  ->  []
static import,  with the same exemption (control)            ->  edge reported
```

This is the never-exemptible invariant failing on an input it was written to
cover, and unlike the round-5 escaped-import case it is **not hypothetical**:

```
core/scripts/review-budget.mjs:1695
  const { reviewerPasses } = await import("./review-counting.mjs");
```

Both files are in `machinery` today, so no cross-group edge is currently
missed. The exposure is prospective — and specifically so, because *this PR
moved misfiled files between groups three times*. If those two ever split, the
edge is invisible and exemptible at once.

**Recorded as the one to fix first** if the check is revisited: it is small
(admit `import` followed by `(`), it is the only gap with a live instance, and
it is the only one that breaks an invariant the code states unconditionally.

### Gap 3 — non-normalized specifiers

`import x from "../b/./two.mjs"` is valid and resolves, but is matched by exact
membership in the computed forms, so the canonical relative form does not match
it. On this corpus the edge is still found, via the unique-basename form —
Codex's report understated this, and the correction matters because it is the
difference between a live hole and a doubly-preconditioned one:

```
import x from "../b/./two.mjs"  ->  edge reported, as "two.mjs"
```

Losing the edge needs **both** a non-normalized specifier *and* an ambiguous
basename. Neither exists today: zero non-normalized specifiers in the payload,
and no duplicate `.mjs` basenames across groups. The real fix is to resolve
each specifier against the importing file's destination rather than test
membership — which is what `referenceFormsFor` already does for prose, so this
is an inconsistency between two halves of the same function rather than a
missing mechanism.

### What the six rounds actually bought

Worth recording honestly, because the ratio is the lesson. The check found
**seven real dependency edges** a hand-written list had missed, **three
misfiled files** whose grouping manufactured false dependencies, and **five
real unclassified references** that successive tightenings surfaced
(two from `form` scoping, two `/uat` from `/command` derivation, one from
`from` scoping). Every one of those is a mistake that would have shipped.

Against that: nine review rounds across two PRs, of which **five were spent on
the same class** — a list hidden inside a mechanism that claimed not to have
one. Each was found, each was removed by deriving instead of enumerating, and
after each I stated there were no lists left. I was wrong twice. The third
time, instead of asserting it again, round 5 added a test that *generates* the
general case; it fails on 22 of 24 whitespace characters under the old rule,
where I had found four by hand. **The generated test is the durable artifact
of this whole episode** — not any individual fix, and certainly not my
confidence.

The strategic conclusion is above, in step 2 of the unstaging procedure:
inference was the wrong foundation. The convention should have come first.

### Gap 4 — a same-count replacement (round 7)

The `count` axis notices occurrences being *added*. It does not notice one being
**rewritten**. Change `Historically this lived in two.md` to `Read two.md before
proceeding` and the count is identical, so the exemption written for evidence
now silently covers an instruction, with the stale-evidence check satisfied
because nothing about the from/ref/form/count tuple changed.

Real, and the seventh face of a family already closed on six axes. Direction:
**fails open.**

Recorded rather than fixed, and the reason is a judgment rather than only a
budget. The fix Codex proposed is "bind exemptions to stable context or an
inline marker" — and the inline marker *is* the canonicalization direction. A
seventh axis on the sidecar would be one more turn of a mechanism this repo has
already turned six times, each turn making the sidecar heavier while leaving the
cause in place: the check having to guess what a sentence means. This gap is
best closed by deleting the mechanism that has it, not by extending it.
