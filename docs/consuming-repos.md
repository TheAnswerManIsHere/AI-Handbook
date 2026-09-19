# Consuming the handbook

How a product repo takes the shared contract, and what it keeps for itself.

## The composition model

Each consumer has two layers at every level: a **vendored core** the handbook
owns, and an **overlay** the repo owns. The overlay is hand-written and never
synced; the core is overwritten on every sync and never hand-edited.

| Layer | Owned by | Path in consumer | Edited where |
|---|---|---|---|
| Claude core | handbook | `.agents/core/claude-core.md` | this repo |
| Claude overlay | consumer | `CLAUDE.md` | consumer repo |
| Agents core | handbook | `.agents/core/agents-core.md` | this repo |
| Agents overlay | consumer | `AGENTS.md` | consumer repo |
| Contracts, skills, memory, machinery | handbook | normal paths | this repo |
| Product docs, product skills | consumer | normal paths | consumer repo |

### Why the two files compose differently

`CLAUDE.md` **imports** its core. Claude Code expands `@path/to/file.md` at
session start and loads it exactly as if inline, following imports up to four
hops, with relative paths resolved against the importing file. So the fleet
rules are genuinely always-on: no agent has to remember to go read them.

`AGENTS.md` **links** to its core. AGENTS.md has no import mechanism — an `@`
line in it is just text. That is not a downgrade, because AGENTS.md is already
a routing file whose entire job is sending an agent to the right document, and
Codex follows those links. It does mean `agents-core.md` must read standalone
for someone who arrived from a link with no other context, which is why it
carries its own framing header.

The practical consequence, and the one thing to get right: **a rule that must
bind Codex cannot live only in an import.** Put it in `agents-core.md`, where
the link leads, and let `claude-core.md` defer to it.

## Overlay template — `CLAUDE.md`

```markdown
# Working agreements for <Product> (Claude Code)

@.agents/core/claude-core.md

## What <Product> is

<Two or three sentences: who it serves, what it does, who the business owner
is. Enough that a cold session knows what it is building before it reads
anything else.>

## Product truth lives here

- **Brief / direction / roadmap** — docs/ai-context/product-brief.md, …
- **Architecture** — docs/ai-context/architecture-map.md
- **Glossary** — docs/ai-context/glossary.md
- **Settled decisions and why** — docs/ai-context/decisions.md
- **Subsystems** — <the product's own subsystem docs>

## Product-specific skills

<The repo's own skills: design, implementation, plan review, subsystem work.>

## What the shared rules ask this repo

Answered in [`docs/ai-context/overlay-declarations.md`](docs/ai-context/overlay-declarations.md).

<A ROUTE, not the answers. They live in that one document because `AGENTS.md`
must reach them too — the rules that dereference them are in `agents-core.md`
as well as `claude-core.md`, so an answer living only in this file is invisible
to Codex and to every other agent entering through `AGENTS.md`. Two copies
would be two hand-maintained lists of one thing, which is the drift this whole
repository exists to remove.>

## Environment

<What is specific to this product's environment: its Repl, its database, its
external services, its network allowlist.>
```

The overlay says nothing about review loops, planning ceremony, PR discipline,
close-out or git constraints. Those are in the core. **If an overlay starts
restating a core rule, that is drift beginning** — delete it from the overlay,
and if the core is wrong, fix the core.

## Overlay template — `AGENTS.md`

```markdown
# <Product> Agent Instructions

> Routing file for AI agents. The cross-agent working contract — how to
> behave, plan, review and ship — is in
> [`.agents/core/agents-core.md`](.agents/core/agents-core.md) and applies in
> full. **Read it first.** This file covers what is specific to <Product>:
> where its truth lives and how to build and test it.

## Project context

<The reading routes: which doc to read before which kind of work.>

## What the shared rules ask this repo

Answered in [`docs/ai-context/overlay-declarations.md`](docs/ai-context/overlay-declarations.md).

<The same route the CLAUDE.md template carries, to the same one document.
`agents-core.md` dereferences these answers too, so an agent entering here has
to be able to reach them.>

## Setup, verification, and the CI gate

<The repo's actual commands, and what CI requires.>
```

## Required consumer documents

Some synced files link to documents the handbook deliberately does **not**
ship, because their content is per-repo. The links resolve in a consumer and
dangle in the handbook, which is expected — payload is written for its
destination.

| Document | Why it cannot be shared |
|---|---|
| `docs/ai-context/codex-environment.md` | Describes *this* repo's Codex sandbox: its setup script, its packages, which suites run there |
| `docs/ai-context/replit-environment.md` | Describes *this* repo's Repl: its database, its session hooks, its deploy path |
| `docs/ai-context/decisions.md` | The product's settled decisions and their rationale |
| `docs/engineering/migrations-and-backfills.md` | Written as operational instruction against one product's schema layout and migration commands. Its principles are fleet-wide; its instructions are not, and an agent follows instructions |
| `docs/tests/test-run-contract.md` | What a PR's post-merge verification must contain, in terms of this repo's own test runners |
| `docs/handoff/README.md` | The cross-tool transit folder and its delete-when-addressed contract |
| `.github/pull_request_template.md` | The PR body is the reviewer's oracle, and `code-review.md`, `working-modes.md` and the bugfix skill all require its feature and Tier-C blocks. Its non-oracle sections are per-repo |
| `docs/tests/uat-doc-format.md` | The UAT skill and `check-uat-format.mjs` define a run through this file's structure, which names this repo's own surfaces |
| `docs/tests/TESTING.md` | `.agents/PLANS.md` routes verification through it, in terms of this repo's actual suites and runners |
| `docs/engineering/deferred-work.md` | The maintenance skill reads and updates it every pass; its contents are this repo's own deferred items |
| `docs/ai-context/product-direction.md` | Product truth by definition. **The path is a default, not a route** — see below |
| `docs/ai-context/overlay-declarations.md` | **The answers the shared rules dereference** — sensitive subsystems, and which of this repo's modules play the roles those rules name. Both overlays route to it; see enrollment step 1 and the list below |
| `docs/ai-context/current-roadmap.md` | Same, and per-product. **The path is a default, not a route** — see below |
| `.mcp.json` | The repo's MCP server declarations. Consumer-owned because a sync that overwrote it would delete the servers this repo declares beyond Firecrawl |

A consumer needs these before or alongside its first sync. They may be started
from the corresponding file in another repo, but they are then owned locally
and diverge — that is the point.

### This table is not exhaustive, and cannot be

Two consecutive review rounds each named three more required documents this
table was missing, and a mechanical sweep of the payload's outbound references
finds more still. That is the signature of a **sweep**, not of a list that is
nearly complete: enumerating by hand finds the category you went looking for,
and the payload keeps acquiring references.

So the rule, rather than the list, is what to rely on:

> **Any path the payload references that `core/` does not ship is
> consumer-owned, and must exist in the consumer before the payload is synced
> there.**

The rows above are the cases worth explaining — the ones where *why* it cannot
be shared is not obvious. They are examples of the rule, not its boundary.

**Two rows name a path the payload no longer follows, and the distinction is
worth stating because it is easy to read them as broken.** Their reasons used
to be "the next-work skill resolves its recommendation through it" and "the
maintenance, status and next skills all read it" — both true when the skills
linked those exact filenames, both **false** after this pass de-linked them.
The skills now ask the overlay for "the repo's roadmap", which is the point: a
payload that dictates a consumer's filenames is the coupling this whole pass
removes.

So for these two, the **document is required and the path is only the default
the templates assume.** A repo that keeps its roadmap at `ROADMAP.md` satisfies
the requirement by routing to it from the overlay, and creating an empty
`current-roadmap.md` beside it would be the failure, not the fix. (Codex, #62
round 4, catching a table that still described the routes this PR deleted.)

`docs/ai-context/overlay-declarations.md` is deliberately **not** in that
category, and the difference is not arbitrary: the roadmap is product truth
whose organisation belongs to the product, while this file answers questions
the *handbook* asks, in a shape every repo instantiates the same way, and both
overlays route to it by the name given here.

Enforcing the rule mechanically — resolving every link in a payload file and
failing when a target is neither in `core/` nor declared consumer-owned — is
the check that would actually close this, and **it does not exist yet.**
Nothing in CI proves this table is complete, so a broken cross-reference in the
payload reaches a consumer as a dead link. It is a known gap, tracked in #64.

**What this pass did instead was work the references to zero by hand**, and the
rule it applied is the one the check will eventually enforce: **an example may
name a product's document; it may not link to it.** The prose survives a move;
the link does not. Zero today is a measurement, not a guarantee — which is
exactly why the check is still owed.

The check was built inside this pass and taken back out, and the reason is
worth recording where the next person will look. It tried to understand every
link form Markdown permits, and each review round found another it got wrong —
raw HTML, percent-encoding, query strings, directory targets, host-absolute
paths. Four rounds returned 2, 2, 6 and 7 findings: **going up.** The premise
was wrong. Nobody is writing hostile Markdown into the payload; we write every
line of it. So the check being rebuilt in #64 does not parse everything — it
accepts **one canonical link form** and reports anything else as something to
rewrite, which turns an unbounded parsing problem into a style rule the payload
can simply obey. (David, 2026-09-09: *"You control everything so you don't have
to worry about strange links."*)

## Enrolling a repo

1. Land the repo's own overlay `CLAUDE.md` and `AGENTS.md` from the templates
   above — before the first sync, so the vendored core has something importing
   it the moment it arrives.

   **Write `docs/ai-context/overlay-declarations.md` as part of this step.** It
   is the one consumer document the payload *dereferences* rather than merely
   links to, and it is the easiest to skip because **nothing complains when it
   is missing.** The shared rules ask this repo five questions — in
   `agents-core.md` as well as `claude-core.md`, so this binds Codex too — and
   each replaced a hardcoded answer naming one product's modules:

   | The rules ask | Where it is dereferenced | If unanswered |
   |---|---|---|
   | Which subsystems are **sensitive** (add the specialist review tier) | `working-modes.md`, `code-review.md`, `agent-working-rules.md`, `claude-core.md`, the `maintenance` skill's direct-push sweep | The universal entries still route; whatever else this repo treated as sensitive quietly stops getting the specialist review |
   | Which modules generate its **API-validation schemas** | `working-modes.md` Tier B/C routing | A schema change routes to the wrong tier |
   | Which panel is its **reference implementation** for async status | `async-ui-status.md` | An agent re-derives a solved UI instead of copying the working one |
   | Which **status transport** its async surfaces already use — a job-status-by-id endpoint, SSE, WebSockets, a task-specific API | `async-ui-status.md` | An agent invents a second status channel beside the one that already works |
   | Which **shared modules a reviewer should know** | `code-review.md` | Reuse stops being a review criterion, so reimplementation goes unflagged |

   One payload route is deliberately **not** in that table: `/next` and the
   tracking skills ask the overlay for the repo's **product direction and
   roadmap**, and that is answered by the overlay's own *Product truth lives
   here* section — a route to documents the repo already owns, not a fact it
   has to declare. See *the path is a default, not a route*, above.

   **None of these fail loudly.** Every one degrades into less ceremony or
   weaker review, silently, which is why the answers are written *before* the
   first sync rather than when something breaks. And **one document, routed
   from both overlays**, rather than a section in each: two copies are two
   hand-maintained lists of one thing, and this repository exists because that
   shape drifts.

   **Each further question gets a new row here and a new section in that
   document, never a new file.** The payload gained the first four one at a
   time across #62, and each was installed separately or not at all — three of
   the four were not installed until round 5 caught them. One document with a
   growing list is the shape that cannot repeat that. The fifth row above
   arrived exactly that way in #65: `async-ui-status.md` had been naming one
   product's status endpoint, and generalising it and landing the answer it now
   dereferences were the same change.
2. Create the required consumer documents above.
3. **Verify the repo's `main` ruleset is in place** — block force pushes,
   restrict deletions, require linear history, require a pull request, require
   status checks, and **require conversation resolution before merging**. That
   last one used to be the merge-gate hook's job; with the hook deleted it is
   the only thing that keeps an unresolved review thread from being mergeable,
   and the contract now states it as fact (`claude-core.md`, *Close-out*: "the
   `main` ruleset requires conversation resolution, so the Merge button is
   inert while a thread is open"). A consumer that omits it gets a contract
   asserting a protection its repository does not have. The seeded
   `.claude/settings.json` sets
   `defaultMode: bypassPermissions`, and with the local shell guard removed by
   the #89 cut **this ruleset is the whole of the mechanical protection**: a
   consumer running `bypassPermissions` without it has nothing server-side
   constraining what a session can push. Settings are a repo-level thing the
   sync cannot write, so this is a human step and it gates the ones below.

   **A second ruleset on `claude/**`, blocking force pushes, is #94's** — it is
   what replaces the guard's lease rule, and it is created per repo at
   enrolment. Verified in AI-Handbook 2026-09-16: a plain push landed,
   `--force-with-lease` on a probe branch was refused with GH013, and a plain
   push of a further commit landed after it.

   **A third ruleset, targeting all branches (`~ALL`) and blocking force
   pushes, is required** (David, 2026-09-16, #106). The two above leave a gap
   the deleted guard did not: the guard was scoped to no namespace, so a
   working branch a runner assigns under some other prefix was covered before
   the cut and not after. `claude-core.md` now states as fact that a force
   push is blocked on every branch, so a consumer that omits this gets a
   contract asserting a protection its repository does not have.

   Two things about this one. **Put nothing else on it** — in particular not
   *restrict deletions*, which is a separate toggle from force-push and would
   leave a stale branch behind after every merge, since merged branches
   auto-delete. And **it does not conflict with the two above**: GitHub unions
   rulesets, so the overlap on `main` and `claude/**` is harmless, and
   targeting all branches with no exclusion is deliberately broader than
   "everything except `main`" — there is no list of runner prefixes to get
   wrong.

   **Create the workstream labels in the same pass.**
   [`workstream-tracking.md`](../core/docs/ai-context/workstream-tracking.md)
   is built end to end on a label taxonomy, and every tracking skill —
   `/status`, `/status-all`, `/next`, `pr-watch` — reads or writes it. The
   payload ships the contract and can ship nothing else: labels are repository
   data, the sync writes files, and **there is no GitHub MCP tool that creates
   a label** (`.agents/memory/github-mcp-no-label-creation-tool.md`). So an
   unenrolled repo gives every one of those skills a taxonomy that silently
   matches nothing. Twenty-two labels across four prefixes:

   | Prefix | Slugs |
   |---|---|
   | `stage:` | `discovery`, `planning`, `plan-approval`, `coding`, `code-review`, `merge`, `test-run`, `uat`, `close-out`, `done` |
   | `waiting:` | `david`, `claude`, `codex`, `replit`, `ci` |
   | `mode:` | `feature`, `bugfix`, `docs`, `devops` |
   | `queue:` | `now`, `next`, `later` |

   **Create all twenty-two, but note that an issue never carries all four
   prefixes.** `queue:` and `stage:` are mutually exclusive, and
   `workstream-tracking.md` is the statement of record for why. There are two
   valid shapes: a **backlog item** carries `queue:` + `mode:` and no `stage:`
   or `waiting:`; an **active workstream** carries `stage:` + `waiting:` +
   `mode:` and no `queue:`. Promoting a backlog item means dropping `queue:`
   and adding the `stage:`/`waiting:` pair in the same edit. Two labels sharing
   one prefix is a data error the field sync refuses rather than guesses at.

   This is the same failure shape as the declarations in step 1 — a payload
   rule deferring to something enrollment never lands — and it fails the same
   way, quietly. Nothing throws on a missing label; the issue just never gets
   one, and the fleet view goes blind to that workstream.

   **The labels are necessary and not sufficient, and the gap is named rather
   than papered over.** They make `/status`, `/status-all` and `/next` work,
   because those read labels directly. They do **not** make a GitHub **Project
   board** reflect anything: `workstream-tracking.md` routes that through a
   consumer-owned `.github/workflows/project-sync.yml` calling
   `scripts/sync-project-fields.mjs`, which additionally needs the matching
   board fields and Project credentials. **No such workflow ships under
   `core/`**, so a repo that completes every step here has working skills and a
   board that never changes. Tracked separately; do not read this step as
   finishing the board.

4. **Adapt the seeded `.claude/settings.json`.** It arrives as a copy of
   `core/.claude/settings.template.json` and is **yours from the moment it
   lands** — the sync never rewrites it, and no "do not edit this vendored
   file" rule applies to it. Four fields need a decision, and the guidance
   lives here rather than inside the file because **Claude Code refuses a
   settings file carrying an unrecognised top-level field**, so the template
   cannot document itself. (It once tried, with a `_comment` array, and that
   field is exactly what the validator rejects. `node
   scripts/check-settings-fields.mjs` now catches the class.)

   **When you do this depends on which repo you have.** A repo that *already*
   had a settings file never receives the seed at all — `mode: seed` writes
   only when the file is absent — so for that repo this table is a checklist
   for its EXISTING file, applied by hand, now. A repo that had *none* does not
   receive the file until the sync runs at **step 7**, so its adaptation
   happens while reviewing that sync pull request, before merging it. The
   decisions are identical either way, which is why they are one step and not
   two.

   Note what an existing file no longer needs: there is nothing to merge in
   from the template. Until the #89 cut this step also carried three
   `PreToolUse` hooks that an existing file would otherwise never receive, and
   whose absence was silent — the guard arrived and nothing invoked it. The
   hooks and the guard are both gone, so an existing settings file is simply
   reviewed against the table below.

   | Field | Decision |
   |---|---|
   | `model` | The template pins `opus`. Keep it for a repo whose sessions mostly write payload or product code; a repo that is mostly prose or ops should set its own default rather than inherit this one. |
   | `env.DATABASE_URL` | Point it at the repo's own test database, or drop the key entirely until the repo has one. |
   | `permissions.deny` | The `drizzle-kit` entries assume Drizzle. **Keep the shape** — deny the command that can push schema straight at a live database — and swap the tool. The dotenv read-deny applies everywhere; keep it. **This block is why the unrecognised-field check still exists**: a refused settings file applies none of its contents, so a stray key here silently un-denies the command that can rewrite a live schema. |
   | `permissions.allow` | The MCP server id in the first block is per-environment and will differ. The three spellings of the remote server are listed **on purpose**: the id varies by how the session was started, and a missing spelling surfaces as a permission prompt that stalls an autonomous session. |

   **There is no `hooks` block to adapt.** The template carried three
   `PreToolUse` guard hooks until the #89 cut; they are gone, and `hooks` is no
   longer an accepted top-level field here, so adding one back fails
   `check-settings-fields.mjs` in the same diff. What they enforced is
   now the ruleset in step 3, which is server-side and cannot fail open.

5. **Fill in `.agents/machinery.json`**, which the sync seeds from a
   self-documenting template. Three values, all facts about the consumer that
   the handbook cannot know:

   ```json
   {
     "repo": "OWNER/REPO",
     "models": {
       "strongestClaude": { "id": "<full model id>", "effort": "xhigh" },
       "strongestCodex": { "id": "<full model id>", "effort": "xhigh" }
     }
   }
   ```

   - **`repo`** is this repository's `owner/name`. It is read through one
     function — `machineryConfig` in `scripts/machinery.mjs`, which is the ONE
     place identity is read — from the working tree, and stamped into every
     artifact the machinery mints. A wrong value here is a **mistake the
     machinery catches**: it refuses with a message naming both values. It is
     not a security boundary and does not try to be one — the person who can
     edit this file is the person running the scripts, and the controls against
     deliberate action are the server-side rulesets and a human working
     alongside. Ten review rounds spent defending it against its own operator
     are why that sentence is written down
     (`.agents/memory/machinery-threat-model-is-my-own-mistakes.md`).
   - **`models`** resolves a tier to a model. Every role definition and every
     reviewer pin names a **tier**, never a version, so a new model release is
     an edit here and nowhere else. `id` must be a **full** model id: a
     dispatch stamps the id it asked for against the id that answered, and an
     alias cannot be compared, so `fable` against `claude-fable-5-1` would
     establish nothing. An alias-shaped id is refused by name.

   **Leaving the placeholder is refused by name.** `OWNER/REPO` is shaped like
   a real slug, so every structural check passed it and an unedited template
   produced a working configuration naming a repository that does not exist.
   It is now rejected explicitly, which is what makes the promise above true.

   **Two fields left this file in the #89 cut, and a consumer enrolled earlier
   can delete both.** `requiredChecks` was read only by the merge-readiness
   receipt, whose requirement GitHub's own ruleset now meets (step 3);
   `contractBudgets` pinned each always-loaded contract to an exact size and
   never once refused growth, because the commit that grew the file re-pinned
   it. Both are ignored rather than refused, so an old file still works.

6. **🛑 RE-SYNC ONLY — if the repo was enrolled before a payload change added
   a declaration, update its overlay FIRST.** The sync overwrites `core/` and
   deliberately never touches a consumer-owned file, so a payload rule that
   starts dereferencing a new answer arrives **fully armed against an overlay
   that has never heard of it.** Nothing errors. The rule simply resolves to
   nothing, and the repo silently gets less ceremony than it had the day
   before.

   Before a re-sync, diff step 1's table against that repo's
   `docs/ai-context/overlay-declarations.md` and land the missing answers in
   that repo first. This is a real step and not a hypothetical: #62 added four
   such questions to the payload, and the enrollment text covering them reaches
   **new** consumers only.

   (A first sync cannot hit this — step 1 wrote the answers. It is the second
   and later syncs that can, which is exactly why it sits here rather than in
   step 1. Codex, #62 round 5.)

7. **Run the sync** — `node scripts/sync.mjs --to <path-to-consumer>` — then
   review the resulting diff as a pull request in that repo and merge. **On a
   clean enrollment this is where step 4 actually happens**: the seeded
   `.claude/settings.json` appears in that pull request, and adapting it there
   is the last moment before a session runs under it.

**The order is the point, and the sync goes last.** A vendored core that
nothing imports is inert: the files are present, the rules are not loaded, and
the repo looks governed without being governed, which is the worst of the three
states. Steps 1 and 2 prevent that — and step 1's declarations are the part of
them that fails quietly rather than loudly; **step 3 prevents the security
equivalent**, where a repo holds `bypassPermissions` with nothing server-side
constraining it; steps 4 and 5 keep a consumer's settings and configuration honest.

**Step 3 is now the whole of the mechanical protection, and it is a human
step.** Three of the steps that stood here are gone with the #89 cut: merging
the template's `PreToolUse` hooks into an existing settings file, the 🛑 hold
on syncing to a `bypassPermissions` repo until #16 closed, and setting
`HANDBOOK_ATTACHED_ROOTS` for a session holding more than one enrolled
repository. There is no hook to merge, no allow path to put a sentinel on, and
nothing that reads that variable — the guard that resolved attached checkouts
is gone. What those steps were protecting is now a ruleset that cannot fail
open, cannot be disarmed by a `cd`, and does not depend on a person honouring
a checklist item.

**Steps 1 and 6 are the same requirement at two moments**, and both fail
silently rather than loudly: step 1 asks a *new* consumer the questions the
shared rules dereference, and step 6 asks whether an *already-enrolled* one has
been asked anything new since. Without the second, enrollment text covering a
new declaration reaches new repos only, and every repo enrolled before it
quietly loses whatever that rule used to route.

There is no longer an `enrolled` flag, and nothing fires a sync automatically —
running it is a deliberate act, so "eligible" and "ready" are the same moment by
construction rather than by a flag anyone has to remember to flip last. A step
added to this list later belongs above step 7, not below it.

## Rules for changing shared content

- **Never edit a vendored file in a consumer.** The next sync overwrites it and
  the reasoning is lost. Every synced **Markdown** file carries a header saying
  so. The non-Markdown payload is **partly** there: everything `machinery`
  delivers — `core/scripts/*.mjs`, `retry-on-eagain.sh` and their tests — now
  carries the notice too, placed after the shebang. Skill helper executables do
  **not** yet — a real gap, and one that ships, since the payload no longer
  waits behind a staging flag.
  `core/.claude/settings.template.json` is a third case and **is the
  one payload file that cannot carry a notice at all**: JSON has no comments,
  and Claude Code refuses a settings file over any unrecognised top-level key —
  which is what a notice would have to be. It once carried one anyway, in the
  `_comment` array that `node scripts/check-settings-fields.mjs` now rejects.
  It does not need one: it is a **seed** — the delivered
  `.claude/settings.json` is **consumer-owned from the moment it lands**, so
  the rule this bullet states does not apply to it. That ownership is stated in
  enrollment step 5 instead, where whoever adapts the file is already reading.
- **Change the handbook, let the sync carry it.** One edit, every repo, each
  through review.
- **Everything in `core/` syncs.** There is no staging and no per-group status:
  if a file is in the payload it reaches every consumer on the next sync. If it
  is not ready for that, it is not ready to merge here.
- **Seeded files diverge on purpose.** A `*.template.*` file writes once and
  never again; a consumer's `.claude/settings.json` is meant to differ. The cost is
  that seeding is a no-op in a repo that already has the file, so anything the
  template contributes which is *not* optional has to be merged by hand at
  enrollment. A seed cannot deliver a requirement; it can only offer a starting
  point.

  **The `PreToolUse` hooks used to be that requirement, and are not any more.**
  They were removed by the #89 cut along with the `guard.sh` they invoked, so
  hand-merging them now would reinstall three hooks pointing at a script that
  does not ship — and a hook whose script is missing exits 127, which
  `PreToolUse` reads as *allow*. Nothing the template currently contributes is
  non-optional in that sense; the protection moved to the ruleset in step 3.
