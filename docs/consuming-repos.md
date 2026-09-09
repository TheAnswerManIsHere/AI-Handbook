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
   status checks. The seeded `.claude/settings.json` sets
   `defaultMode: bypassPermissions`, and `guard.sh` deliberately delegates
   PR-only-changes and passing-checks enforcement to this server-side control
   rather than reimplementing it locally. A consumer that installs the guard
   without the ruleset has neither: the local guard does not cover it and the
   server is not configured to. Settings are a repo-level thing the sync cannot
   write, so this is a human step and it gates the ones below.

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
4. **If the repo already has `.claude/settings.json`, merge the template's
   three `PreToolUse` hooks into it by hand.** The settings file is a
   **seed**, which writes only when the file is absent — correct, because a
   consumer's permissions and env are its own and a sync that overwrote them
   would delete grants it needs. But the consequence is that an existing file
   is left untouched, so the vendored `guard.sh` arrives and **nothing ever
   invokes it**. That failure is silent: the guard is present, the hooks are
   not, and no diff shows it. This applies to the first consumer immediately —
   Overhype already has a settings file — so it is a step, not a footnote.
5. **Adapt the seeded `.claude/settings.json`.** It arrives as a copy of
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
   by-hand merge in step 4, and it applies now. A repo that had *none* does
   not receive the file until the sync runs at **step 10**, so its adaptation
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

6. **Fill in `.agents/machinery.json`**, which the sync seeds from a
   self-documenting template. Three values, all facts about the consumer that
   the handbook cannot know:

   ```json
   {
     "repo": "OWNER/REPO",
     "requiredChecks": ["Classify changed paths", "Build", "Test"],
     "contractBudgets": [
       { "path": "CLAUDE.md", "lines": 0, "bytes": 0 },
       { "path": ".agents/core/claude-core.md", "lines": 0, "bytes": 0 }
     ]
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
   - **`contractBudgets`** pins each always-loaded contract file to its
     **exact** current size. Seeded at `0/0`, which refuses on the first run
     and names the real numbers in the failure — so the first run tells you
     what to write. The exactness is the whole mechanism: a budget with room
     left is satisfied by exactly the state it exists to prevent, so a file
     **under** its budget fails too, and re-pinning is a visible one-line diff
     in a pull request rather than silent growth. Add an entry for every file
     a session loads unconditionally, and drop one this repository does not
     have. Run `node scripts/check-claude-md-budget.mjs`, and add it to CI —
     the lock is worth nothing if it only runs when someone remembers.

7. **If a session will hold more than one enrolled repository at once, set
   `HANDBOOK_ATTACHED_ROOTS` in that session's environment.** This is a
   *session* prerequisite rather than a repo one, and it is the step the
   handbook previously had nowhere to state.

   A `PreToolUse` hook belongs to the session's **project root**, so a review
   request or a merge aimed at an attached repository is judged by the project
   root's guard, against the project root's receipts. Without this variable
   that guard cannot reach the target's evidence and refuses — correctly, but
   it makes cross-repo work impossible rather than merely guarded.

   ```sh
   export HANDBOOK_ATTACHED_ROOTS="owner/name=/abs/path/to/checkout
   other/repo=/abs/path/to/other"
   ```

   **`export`, not a bare assignment.** Only exported names reach subsequently
   executed commands, and the guard runs as a subprocess of the session — a
   plain `HANDBOOK_ATTACHED_ROOTS=...` sets a shell variable the hook never
   sees, so cross-repository calls stay blocked with nothing explaining why.
   Setting it in the environment's own configuration has the same effect.

   - **Newline-separated**, one `owner/name=/absolute/path` per line. Newline
     rather than `:`, because `:` is a legal character in a POSIX directory
     name and a checkout at `/workspace/team:archive/repo` would otherwise be
     unparseable. A path containing a literal newline is unsupported.
   - Only the **first `=`** separates, so a path containing `=` is fine.
   - Paths must be **absolute**. A relative path is refused rather than
     resolved against the hook's working directory — that directory is
     precisely what this mechanism exists to stop depending on.
   - **Whitespace in a path is significant**, because it is legal in a POSIX
     directory name. Only a trailing carriage return is stripped, as a
     line-ending artifact.
   - **No `..` segments.** Give the resolved path. `/mount/current/../repo` is
     refused rather than collapsed: POSIX applies `..` *after* resolving a
     preceding symlink, so collapsing it here would name a directory you did
     not.
   - **One bad or duplicated entry invalidates the whole variable.** A
     partly-parsed registry would resolve some targets and not others, which
     is the kind of partial success that reads as correct.
   - **Do not add a key for the session's own project root.** It is not needed
     — the project root is always tried first — and it is out of contract. It
     cannot be *prevented*, because detecting it would need the identity read
     the review-request path deliberately does not make, so it is documented
     here instead.

   The variable says only **where** a repository's checkout is. It is never
   asked *which* repository something is: that answer always comes from the
   receipt found there, compared against the call's target. So a wrong entry
   can only cause a refusal, never an unearned approval.
8. **🛑 Do not sync to a repo that will run `defaultMode: bypassPermissions`
   until issue #16 is closed.** `guard.sh` treats **any** exit from
   `guard-decision.mjs` other than 2 as *allow*, so a crash, a missing `node`,
   or a path it cannot launch does not refuse a destructive command — it
   permits one, silently. In this repository that is survivable: the `main`
   ruleset is server-side and catches what the guard misses. In a consumer
   running `bypassPermissions`, the guard is the control that is supposed to
   stand in front of exactly those commands, and a guard that fails open is
   worse than no guard because it is trusted.

   This used to be enforced mechanically — the `guard` group was staged, so it
   could not travel. Deleting staging removed that mechanism and left this
   checklist item in its place, which is weaker: it depends on a person
   honouring it. It is written as a step rather than a footnote for that
   reason. **The real close is landing #16** (a sentinel on the allow path, so
   "ran and allowed" is distinguishable from "never ran"), after which this
   step can be deleted.

9. **🛑 RE-SYNC ONLY — if the repo was enrolled before a payload change added
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

10. **Run the sync** — `node scripts/sync.mjs --to <path-to-consumer>` — then
   review the resulting diff as a pull request in that repo and merge. **On a
   clean enrollment this is where step 5 actually happens**: the seeded
   `.claude/settings.json` appears in that pull request, and adapting it there
   is the last moment before a session runs under it.

**The order is the point, and the sync goes last.** A vendored core that
nothing imports is inert: the files are present, the rules are not loaded, and
the repo looks governed without being governed, which is the worst of the three
states. Steps 1 and 2 prevent that — and step 1's declarations are
the part of them that fails quietly rather than loudly; steps 3 and 4
prevent the security equivalent, where a repo holds `bypassPermissions` without the controls that
constrain it, or the guard without the hooks that invoke it; step 6 keeps its
merge gate usable; step 7 is what lets a session hold more than one consumer at
once; step 8 is the one that is currently a promise rather than a mechanism.

**Steps 1 and 9 are the same requirement at two moments**, and both fail
silently rather than loudly: step 1 asks a *new* consumer the questions the
shared rules dereference, and step 9 asks whether an *already-enrolled* one has
been asked anything new since. Without the second, enrollment text covering a
new declaration reaches new repos only, and every repo enrolled before it
quietly loses whatever that rule used to route.

There is no longer an `enrolled` flag, and nothing fires a sync automatically —
running it is a deliberate act, so "eligible" and "ready" are the same moment by
construction rather than by a flag anyone has to remember to flip last. A step
added to this list later belongs above step 10, not below it.

## Rules for changing shared content

- **Never edit a vendored file in a consumer.** The next sync overwrites it and
  the reasoning is lost. Every synced **Markdown** file carries a header saying
  so. The non-Markdown payload is **partly** there: everything `machinery`
  delivers — `core/scripts/*.mjs`, `retry-on-eagain.sh` and their tests — now
  carries the notice too, placed after the shebang. Skill helper executables and
  `guard.sh` do **not** yet — a real gap, and now one that ships, since the
  payload no longer waits behind a staging flag.
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
  template contributes which is *not* optional — the `PreToolUse` hooks — has
  to be merged by hand at enrollment. A seed cannot deliver a requirement; it
  can only offer a starting point.
