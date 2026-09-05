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

## Sensitive subsystems

<Which areas add the specialist review tier — the core's ceremony rules refer
to "any subsystem the overlay marks sensitive", and this is where that list
lives. Migrations, auth and payments are sensitive everywhere; name the ones
particular to this product.>

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
| `docs/ai-context/product-direction.md` | The next-work skill resolves its recommendation through it. Product truth by definition |
| `docs/ai-context/current-roadmap.md` | Same — the maintenance, status and next skills all read it, and it is per-product |
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
> consumer-owned, and must exist in the consumer before the group referencing
> it goes ready.**

The rows above are the cases worth explaining — the ones where *why* it cannot
be shared is not obvious. They are examples of the rule, not its boundary.

Enforcing the rule mechanically — resolving every link in a group's files and
failing when a target is neither in `core/` nor declared consumer-owned — is
the check that would actually close this, and it belongs with the groups whose
files carry the references. It is recorded in the `skills` and `contracts`
blockers as an unstaging requirement, because until those groups travel the
gap has no consumer to affect. **Do not read a passing `check-manifest` as
evidence this table is complete**; the check covers payload coverage and
readiness, not link resolution.

## Enrolling a repo

1. Add it to `consumers:` in `sync-manifest.yml` with `enrolled: false`.
2. Land the repo's own overlay `CLAUDE.md` and `AGENTS.md` from the templates
   above — before the first sync, so the vendored core has something importing
   it the moment it arrives.
3. Create the required consumer documents above.
4. **Verify the repo's `main` ruleset is in place** — block force pushes,
   restrict deletions, require linear history, require a pull request, require
   status checks. The seeded `.claude/settings.json` sets
   `defaultMode: bypassPermissions`, and `guard.sh` deliberately delegates
   PR-only-changes and passing-checks enforcement to this server-side control
   rather than reimplementing it locally. A consumer that installs the guard
   without the ruleset has neither: the local guard does not cover it and the
   server is not configured to. Settings are a repo-level thing the sync cannot
   write, so this is a human step and it gates the ones below.
5. **If the repo already has `.claude/settings.json`, merge the template's
   three `PreToolUse` hooks into it by hand.** `settings-template` is
   `mode: seed`, which writes only when the file is absent — correct, because a
   consumer's permissions and env are its own and a sync that overwrote them
   would delete grants it needs. But the consequence is that an existing file
   is left untouched, so the vendored `guard.sh` arrives and **nothing ever
   invokes it**. That failure is silent: the guard is present, the hooks are
   not, and no diff shows it. This applies to the first consumer immediately —
   Overhype already has a settings file — so it is a step, not a footnote.
6. **Adapt the seeded `.claude/settings.json`.** It arrives as a copy of
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
   only when the file is absent — so this table is the checklist for the
   by-hand merge in step 5, and it applies now. A repo that had *none* does
   not receive the file until the sync runs at **step 9**, so its adaptation
   happens while reviewing that sync pull request, before merging it. The
   decisions are identical either way, which is why they are one step and not
   two.

   | Field | Decision |
   |---|---|
   | `model` | The template pins `opus`. Keep it for a repo whose sessions mostly write payload or product code; a repo that is mostly prose or ops should set its own default rather than inherit this one. |
   | `env.DATABASE_URL` | Point it at the repo's own test database, or drop the key entirely until the repo has one. |
   | `permissions.deny` | The `drizzle-kit` entries assume Drizzle. **Keep the shape** — deny the command that can push schema straight at a live database — and swap the tool. `Read(**/.env*)` applies everywhere; keep it. |
   | `permissions.allow` | The MCP server id in the first block is per-environment and will differ. The three spellings of the remote server are listed **on purpose**: the id varies by how the session was started, and a missing spelling surfaces as a permission prompt that stalls an autonomous session. |

   **The three `PreToolUse` guard hooks are not adaptable.** They are the local
   half of the branch-protection story and the reason a force push needs an
   explicit refspec. Keep all three, keep the longer timeout on the merge
   matcher — that guard reads live GitHub state and 5s is not enough — and keep
   the path absolute via `${CLAUDE_PROJECT_DIR}`. A relative path resolves
   against the current working directory, so one persisting `cd` makes every
   hook exit 127, which `PreToolUse` treats as *allow*.

7. **Fill in `.agents/machinery.json`**, which `machinery-config` seeds from a
   self-documenting template. Two values, both facts about the consumer that
   the handbook cannot know:

   ```json
   {
     "repo": "OWNER/REPO",
     "requiredChecks": ["Classify changed paths", "Build", "Test"]
   }
   ```

   - **`repo`** is this repository's `owner/name`. It is read through one
     function, from the working tree, and stamped into every artifact the
     machinery mints — budgets, round-check receipts, readiness receipts,
     adjudication records. Every artifact the machinery consumes is compared
     back to it, and so is every GitHub snapshot, so a snapshot of the wrong
     PR (every repository has a #7) is refused rather than counted. A wrong
     value here is a **mistake the machinery catches**: it refuses with a
     message naming both values. It is not a security boundary and does not
     try to be one — the person who can edit this file is the person running
     the scripts, and the controls against deliberate action are the merge
     click and the server-side ruleset. Ten review rounds spent defending it
     against its own operator are why that sentence is written down
     (`.agents/memory/machinery-threat-model-is-my-own-mistakes.md`).
   - **`requiredChecks`** names the CI jobs that must be PRESENT before a
     readiness receipt is honest — every job that can appear **late**, not only
     the ones that must pass. A job gated on an earlier one is created late, so
     a snapshot taken too early sees a complete green set without it. Read
     from the same file, the same way: a pull request that changes this list
     is judged by the list it commits, and that change is in the diff the
     merge reviews. An empty list is refused — a gate that requires nothing is
     satisfied by any green set.

   **Leaving the placeholder is refused by name.** `OWNER/REPO` is shaped like
   a real slug, so every structural check passed it and an unedited template
   produced a working configuration naming a repository that does not exist.
   It is now rejected explicitly, which is what makes the promise above true.
   If a budget was already declared under the placeholder — or under an earlier
   schema that recorded no repository at all — delete the receipt and declare
   again. Nothing is lost: a budget holds only the tier, the repository and the
   criticality, the round count is computed fresh from GitHub, and extension
   receipts are separate files that the deletion does not touch.

   ```
   git rm .agents/receipts/loop-budget-<n>.json
   git commit -m "drop stale budget for #<n>" && git push
   node scripts/review-budget.mjs declare --pr <n> --tier <tier> \
        --criticality <1-100> --artifact "<what is under review>"
   ```

   Every failure here is loud.
   `pr-ready.mjs` refuses when the file is absent,
   malformed, or declares an empty list — an empty list is refused rather than
   read as "nothing required", because a gate that requires nothing is
   satisfied by any green set. Declaring a budget refuses while `repo` is
   still the template's placeholder, naming this file. So a consumer that
   skips this step gets a closed gate that says why, never an open one that
   says nothing.
8. Flip `enrolled: true`. **This is the last step before the sync, and it comes
   after every prerequisite above — not before them.** An earlier version put
   the flip at step 4 and then grew steps 5 and 6 underneath it, which put a
   repo into the sync's target set while the controls those steps install were
   still missing. Since the intended sync is merge-triggered, "eligible" and
   "ready" have to be the same moment: a repo flipped early can receive
   `bypassPermissions` before the ruleset that constrains it exists, and an
   inert guard before the hooks that invoke it are merged.
9. Run the sync, review the pull request it opens, merge. **On a clean
   enrollment this is where step 6 actually happens**: the seeded
   `.claude/settings.json` appears in that pull request, and adapting it there
   is the last moment before a session runs under it.

`enrolled` means "every prerequisite is in place, so send it the core" — not
"the core has arrived." A vendored core that nothing imports is inert: the
files are present, the rules are not loaded, and the repo looks governed
without being governed, which is the worst of the three states. Steps 2 and 3
prevent that; steps 4 and 5 prevent the security equivalent, where a repo holds
the bypass without the controls; step 7 keeps its merge gate usable. **The flip goes last because the flip is what
makes the sync fire** — anything that must be true before delivery has to be
true before the flip, and a step added to this list later belongs above it, not
below.

## Rules for changing shared content

- **Never edit a vendored file in a consumer.** The next sync overwrites it and
  the reasoning is lost. Every synced **Markdown** file carries a header saying
  so. The non-Markdown payload is **partly** there: everything `machinery`
  delivers — `core/scripts/*.mjs`, `retry-on-eagain.sh` and their tests — now
  carries the notice too, placed after the shebang. Skill helper executables and
  `guard.sh` do **not** yet, which is why the groups containing them stay
  staged: each one's blocker requires the ownership comment before it can
  travel. `core/.claude/settings.template.json` is a third case and **is the
  one payload file that cannot carry a notice at all**: JSON has no comments,
  and Claude Code refuses a settings file over any unrecognised top-level key —
  which is what a notice would have to be. It once carried one anyway, in the
  `_comment` array that `node scripts/check-settings-fields.mjs` now rejects.
  It does not need one: `mode: seed` means the delivered
  `.claude/settings.json` is **consumer-owned from the moment it lands**, so
  the rule this bullet states does not apply to it. That ownership is stated in
  enrollment step 6 instead, where whoever adapts the file is already reading.
- **Change the handbook, let the sync carry it.** One edit, every repo, each
  through review.
- **A `staged` group does not sync.** It is in the payload with a named blocker
  saying what must land first. Check `sync-manifest.yml` before assuming a file
  has reached a consumer.
- **Seeded files diverge on purpose.** `mode: seed` writes once and never
  again; a consumer's `.claude/settings.json` is meant to differ. The cost is
  that seeding is a no-op in a repo that already has the file, so anything the
  template contributes which is *not* optional — the `PreToolUse` hooks — has
  to be merged by hand at enrollment. A seed cannot deliver a requirement; it
  can only offer a starting point.
