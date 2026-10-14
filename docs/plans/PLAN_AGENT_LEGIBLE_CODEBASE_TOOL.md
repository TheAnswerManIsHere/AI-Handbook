# Plan — The agent-legible codebase tool (fleet payload)

Workstream: #208. Consumer counterpart: Overhype.me #683 (adoption, blocked on this).
Research notes: `docs/research/agent-legible-codebase-research.md` (committed with this plan).

```plan-oracle
# Scope of work — the agent-legible codebase tool (handbook payload)

Agreed with David 2026-10-14 in the Overhype.me session that planned the
consumer side: he chose "handbook first" ("1", option 1 of the placement
question) so that DojoOS and every later repository inherit the tool by sync
rather than by extraction. The consumer-side plan (Overhype.me #683) was
developed first through two Astra rounds and is the source of the decisions
below; this scope re-homes its portable parts.

## Direction served

A codebase legible to an agent by construction, in every product David builds
with agents: structure an agent can query rather than scan, invariants a
machine enforces rather than prose describes, coordination through typed
contracts rather than conversation. The evidence (OpenAI harness engineering;
ETH Zurich on context files; RepoGraph; CodeCompass; the Microsoft swarm
experiment) is in the research notes that travel with this plan. This
increment is the fleet-owned tool and its contract; each consumer's adoption
(configuration, headers, manifest, baseline) is that consumer's own
increment, Overhype.me's being #683.

## Product intent for this increment

When this increment is merged and synced:

1. Every consumer receives one script that builds a structural index of its
   TypeScript codebase from the compiler's own program (exports, imports,
   canonical symbol references, HTTP route registrations, table and
   external-relation references, per-file purpose and subsystem), answers
   one-hop questions about it in one command (what a file depends on, what
   depends on a file or a symbol, which handler owns a route, where a table
   is referenced, what a file is for), and runs four guards over it:
   freshness, headers, dependency boundaries, file size.
2. Every answer distinguishes resolved references, sites that could not be
   analysed (dynamic target, or an unsupported form), and the coverage the
   query examined; an empty answer never prints alone.
3. The index is a deterministic build artifact: committed in the consumer,
   byte-identical across builds of the same inputs, with provenance kept in a
   separate file that takes no part in the freshness comparison; the query
   refuses a stale index and prints the regenerate command.
4. Everything repository-specific — which files are indexed, headered and
   sized; the subsystem vocabulary; the architecture manifest with its
   exemptions; the size baseline — lives in consumer-owned configuration
   files the tool reads, seeded once by the sync and never overwritten; the
   tool itself contains no product path, package name or subsystem.
5. The header convention (`@purpose`, `@subsystem` in a leading doc comment),
   the configuration schema, the CI step recipe and the direction document
   ship as payload beside the script, so a consumer adopts by filling its
   seeds and adding one CI step.
6. The forcing instruction — run the dependency query before editing a
   governed file and at the class sweep — is a fleet rule, stated once where
   Codex and Claude both read it, with the per-repository path-scoped rules
   file seeded beside it.
7. Every guard failure prints the rule, the file, the exact command or edit
   that fixes it, and the document that explains it.
8. **(Amended 2026-10-14, David: "I want to make sure that there is an eval
   that we can perform once this is built to prove that it actually helps.
   And that if it doesn't, it's very easy for us to back out of it.")** The
   payload ships with a back-out switch — one consumer-owned line that
   disables every guard and the forcing rule without a sync — and with an
   eval protocol and its ground-truth harness: a stratified task set
   (keyword-findable, structural, hidden-dependency), ground truth taken
   from the consumer's own compiler and never from the tool, two arms on the
   same model, and keep/kill thresholds written before the first run. The
   first consumer runs it (#683) and its result decides whether the forcing
   rule stays on there.

## Must not change

- The handbook ships no runtime dependency and keeps no `package.json` at its
  root; the tool uses the compiler the indexed repository already depends on.
- Nothing under `core/` names a product, a product path, a product package or
  a product subsystem except as a worked example in prose.
- No consumer's settings, machinery or overlays are edited by the payload;
  seeds land only where absent.
- The sync's one rule (`core/X → X`, `*.template.*` seeded) and its banner
  check are unchanged; every non-seed payload file carries the banner.
- No change to any consumer's product behaviour; the tool reads a tree and
  writes only under its own directory.
- The resident instruction load (`claude-core.md`, `agents-core.md`) gains
  the forcing rule and nothing else from this increment; path-scoping the
  cores is a separate question.

## Settled decisions (pre-plan, carried from #683's loop)

- TypeScript compiler API over tree-sitter; typed symbol resolution through
  aliases and re-exports; `allowJs` brings `.mjs`/`.js` tooling into the graph.
- Derived over authored: only the purpose line and subsystem tag are authored.
- Committed, CI-guarded index; one-hop answers; a CLI, not an MCP server; no
  embeddings, no LLM-written overviews, no vendor platform.
- Three explicit file sets (indexed, headered, sized), each a mechanical
  oracle recorded in the index; multi-program indexing over the consumer's
  own `tsconfig` files plus supplementary tooling programs the consumer
  declares.
- Freshness keyed to a digest of every indexed input (sources, tsconfigs,
  package manifests, configuration, tool version), never to a commit;
  provenance in a separate file.
- Database operations recognised by receiver type, not variable name;
  relation names derived from statement text; non-schema relations reported
  as external, never whitelisted.
- Boundaries enforced from the index's own graph in three dimensions —
  package, layer, feature area (subsystem tag) — with named, dated
  exemptions; header-exempt files classified from the set definitions.
- Size ratchet: cap plus frozen baselines, ratchets down only.
- Forcing by instruction in this increment; mechanical enforcement is a later
  increment (Phase 3, swarm readiness).
- **Handbook-owned tool, consumer-owned configuration** (David, 2026-10-14).
- **The tool is an experiment with a pre-registered outcome** (David,
  2026-10-14): it ships with its eval and its kill switch, and the direction
  document states the hypothesis and the thresholds.

## Now / next / never

- **Now:** the tool, its tests, the configuration schema and seeds, the
  header convention, the direction document, the forcing rule, the CI recipe
  and the adoption steps in `consuming-repos.md`.
- **Next:** Overhype.me adoption (#683) as the first and hardest proving
  ground; DojoOS adoption after its flip to production or when David asks;
  Phase 3 swarm readiness; monolith decomposition per consumer; path-scoping
  the resident cores.
- **Never (for this direction):** a hand-maintained map document as the
  navigation source; an embeddings index; LLM-written overviews loaded at
  session start; a vendor agent platform; a second resolver beside the
  compiler.

## Ceremony tier

Internal tooling in the handbook: the two-review limit applies. What is
downstream is every consumer's CI (a guard that wrongly blocks announces
itself and is reverted by a sync) and every agent's navigation; nobody's
money or data. The one line the PR body and merge report carry about
latitude: the forcing rule tells agents to run a query, and grants no new
authority.
```

## Preflight

**Increment test.** This increment makes true the seven intent items above.
It is bounded by the payload: everything under `core/` that the sync routes,
plus this repository's own tests and CI, plus `docs/consuming-repos.md` and
`docs/research/`. Completion is recognised when a synthetic consumer, built in
the test suite, receives the payload by the real sync, completes its seeds,
obtains every promised answer shape, and sees freshness refusal and a
representative failure of each of the four guards with a usable remediation
(Astra, scope exchange). Proving adoption against a real product tree is
#683's completion condition, not this plan's. Two phases were provisional on
the issue; the plan merges them: the forcing rule is one paragraph whose
seeds ship beside the tool, and separating it would deliver a tool nobody is
told to use.

**Affected-surface inventory.** The patterns this plan touches in the
handbook, each with its oracle run on 2026-10-14 against the tracked set:

| Pattern | Oracle | Result |
|---|---|---|
| Payload seeds (the sync's `*.template.*` rule) | `git ls-files core \| grep -E '\.template\.'` | 2 today: `core/.agents/machinery.template.json`, `core/.claude/settings.template.json`; `scripts/__tests__/sync.test.mjs:98` asserts exactly two |
| Payload scripts' imports | `grep -h -E '^import .* from "' core/scripts/*.mjs \| grep -v 'from "node:'` | only sibling-module imports; no package dependency anywhere in the payload |
| Payload JSON files and how they carry the banner | `git ls-files core \| grep -E '\.json$'` | 3: two seeds (exempt) and one schema carrying `"$comment": "SYNCED FROM …"` |
| CI jobs | `.github/workflows/check.yml` | `Test` (both suites, no install step, by deliberate comment) and `Manifest` (the `check-*` scripts); both required by the `main` ruleset |
| Where a fleet rule binding Codex lives | `docs/consuming-repos.md`, *Why the two files compose differently* | `agents-core.md`, linked from every AGENTS.md; `claude-core.md` defers to it |

The consumer-side inventories (route forms, database call forms, file sets)
are #683's and are carried here as the supported-form matrix in decision 6,
not re-run: they measure one consumer, and this plan's claim about them is
that the tool handles each form, which the fixtures check.

**Claim-oracle rule.** Every completeness property here is *checked* by a
guard or a test named in the design, never *cannot*. The one construct is the
seed marker of decision 9: an unadopted repository cannot pass `check`,
because the marker's presence is itself the failure condition.

**Specification test.** The plan specifies the tool's contract (answer
semantics, supported forms, file-set definitions, freshness inputs, guard
rules, the unadopted state), where its artifacts land, how the handbook
tests it without a dependency, and the one fleet rule. It does not prescribe
the script's internal structure, serialization details beyond determinism,
or test assertions.

## Problem

Every agent in every consumer pays navigation cost on every task, and a
swarm will pay it in parallel: finding the owner of a behaviour whose name
does not match its file, reading a 4,000-line route file for one handler,
and performing the class sweep the working agreements require by grep. The
research says what helps and what does not: a structural graph queried
narrowly at forced moments helps; overviews loaded into context do not and
cost more; structure enforced by machines holds where prose rots. The first
consumer planned the tool for itself (#683); David ruled that a tool true
for every TypeScript repository belongs in the handbook, so that DojoOS and
later repositories inherit it by sync rather than by a second extraction.

## Direction

The oracle's *Direction served*. This increment makes true that the fleet
owns one tool, one header convention, one configuration schema and one
forcing rule, and that a consumer adopts by filling seeds and adding one CI
step.

## Product Intent

Verbatim: the oracle's *Product intent for this increment*.

## Must Not Change

Verbatim: the oracle's *Must not change*.

## Settled Decisions

Verbatim: the oracle's *Settled decisions (pre-plan)*, plus these settled
during planning:

1. **Where the payload lands, and what stays handbook-only** (C4).
   Payload: `core/scripts/map.mjs` → `scripts/map.mjs` (the tool, one file,
   banner-carrying); `core/scripts/__tests__/map.unit.test.mjs` (pure
   functions only — set-glob evaluation, SQL relation-name derivation, answer
   formatting — running on bare Node with no compiler and no sync, so it is
   valid wherever it lands); `core/docs/ai-context/agent-legible-codebase.md`
   (the direction document and the tool's contract, banner-carrying);
   `core/.agents/map/config.schema.json` (the configuration schema the tool
   validates seeds against, banner-carrying via `$comment`); four seeds under
   `core/.agents/map/`: `config.template.json`, `subsystems.template.json`,
   `architecture.template.json`, `size-baseline.template.json` →
   `.agents/map/*.json`, consumer-owned once landed; one seed
   `core/.claude/rules/map-before-edit.template.md` →
   `.claude/rules/map-before-edit.md`, carrying the forcing instruction and a
   `paths:` list the consumer completes; the eval protocol
   `core/docs/ai-context/agent-legible-codebase-eval.md` and its harness
   `core/scripts/map-eval.mjs` (both banner-carrying, C7), and a fifth seed
   `core/.agents/map/eval-tasks.template.json` → `.agents/map/eval-tasks.json`
   for the consumer's own question set. **Handbook-only**: the integration
   suite `scripts/__tests__/map.test.mjs`, which invokes the real
   `scripts/sync.mjs` and needs the pinned dependencies of decision 3, and
   the research notes under `docs/research/`. The fixture workspace is
   generated into a temporary directory at test time, never shipped as files.
   The index and provenance files are written by the tool in the consumer and
   never ship.
2. **The compiler is the indexed repository's** (C1). The tool loads
   TypeScript through the indexed repository's **local dependency entry**
   (`node_modules/typescript` at the repository root, or the entry a declared
   program's package resolves), following its symlink when present, because
   package managers link entries to a store and the target's physical
   location is not the ownership test. It refuses, with the install
   remediation, when that entry is absent or unusable — even though Node's
   ambient lookup would find another compiler, as Astra's probe from the
   handbook root did (a 6.0.2 under a shared tools path). The resolved
   version is recorded in the index and is a freshness input. Fixtures: the
   positive case exercises a linked entry pointing at the pinned test
   installation; the negative case an absent local entry with an ambient
   compiler available.
3. **The handbook tests with a real, pinned compiler and stays
   dependency-free** (C1). The `Test` job gains one step that installs a
   pinned TypeScript into a temporary directory outside the checkout and
   exports its path in an environment variable; the payload test builds its
   synthetic consumer in a temporary workspace with `node_modules/typescript`
   pointing at that install, so decision 2's resolution path is exercised
   for real. The same isolated install carries **pinned real declarations
   for the libraries the matrix names** — Express, `pg`, Drizzle, wouter —
   so receiver and registration recognition is exercised against the
   libraries themselves, never handwritten lookalikes (C1). **The test
   refuses when the variable is unset** rather than skipping, printing the
   one-line install command (the handbook's own rule: a control that cannot
   evaluate must refuse). The install step runs before the root machinery
   suite (C4). No `package.json` is added at the root; the job comment that
   forbids an install step is amended to name this one exception and why.
4. **Freshness inputs** (C1, C5). The digest covers every repository-local
   source any declared program reads (the indexed set and anything else the
   compiler visits inside the repository, even when excluded from output
   nodes), every `tsconfig*.json` and `package.json` the programs read, the
   repository's lockfile(s) as the fingerprint of dependency declarations,
   the four configuration files, the resolved compiler version and the
   tool's version string. Provenance (base commit, dirty flag) is a separate
   file the check neither regenerates nor compares. The committed index is
   deterministic: sorted keys, no timestamps, byte-identical across builds of
   identical inputs.
5. **Answer semantics.** Every answer has `resolved`, `unresolved` (each site
   with `dynamic-target` or `unsupported-form`) and `coverage` (the forms
   examined and the sets consulted); an empty `resolved` never prints alone.
   File queries report direct module edges; symbol queries, written
   `path#name`, report direct references to the canonical declaration through
   any alias or re-export chain; the index stores canonical references so
   both answer without a compiler. One hop, always.
6. **The supported-form matrix is the tool's contract** (C2), fixture-tested
   form by form. Recognition is by **resolved type from the consumer's own
   dependencies**, never by variable name or product path. **Routes**:
   Express `Router`/`Application` method registrations with mount
   composition through `use`; wouter `<Route path>`; and, as the one
   text-level form, a string or regular-expression literal compared against a
   request path in a Cloudflare Worker `fetch` handler. A route answer gives
   the registration site and, where the handler identifier resolves, the
   handler's declaration. **Tables**: Drizzle `pgTable` declarations map
   relation names to canonical table symbols; a table answer combines
   references to that symbol through any alias or re-export (`.from(t)`,
   `.update(t)`, `.insert(t)` and every other typed use) with references
   extracted from SQL text reaching a supported operation — Drizzle `sql`
   tagged templates and `execute`, the `query` method on a `pg` `Client` or
   `Pool`, including a statement bound to a local variable in the same file;
   names outside the schema set are external relations. **Candidates, not a
   list**: the extractor enumerates candidate operations — method calls on
   receivers it attempts to resolve, tagged templates, route-shaped
   registrations — and every candidate whose receiver or argument it cannot
   resolve is retained as an unresolved site with its reason; `coverage`
   reports the candidates examined and their disposition, so a recognisable
   operation can never vanish into a confident empty answer. A fixture with
   an unresolvable receiver proves it. Adding a form is a handbook PR with a
   fixture; a consumer never patches the extractor.
7. **Programs and three file sets, defined in the consumer's `config.json`**
   (C5). The consumer declares its programs — each product `tsconfig.json`
   and any supplementary program with its roots and compiler options — and
   its three sets, indexed, headered, sized, as include and exclude globs
   plus the codegen-owned paths; the synced-banner exclusion the tool applies
   by default. **The build reconciles** the independently enumerated indexed
   set against the union of files the declared programs actually analysed:
   an indexed file no program visited is a configuration error naming the
   file and the program adjustment required, never a silent node with no
   edges. Graph identities are repository-relative paths across programs.
   Codegen and synced-banner ownership exempt a file from headers and sizing
   and never from the graph. The seed carries sensible defaults (tests
   indexed but not headered; `node_modules`, build output and generated
   directories named as placeholders) and the marker of decision 9; the
   tool validates every configuration file against the shipped schema.
8. **Boundaries in three dimensions from `architecture.json`**: package,
   layer (path prefixes per package) and feature area (the subsystem tag of
   the header), with `exemptions` entries carrying file, target, reason and
   date, dead exemptions reported, and header-exempt files classified from
   the set definitions. **Size ratchet from `size-baseline.json`**: a cap,
   frozen baselines for files over it at adoption, growth refused,
   `--ratchet` lowering only.
9. **The unadopted state** (C3). Every seed carries `"adopted": false` at the
   top level. While any configuration file still says so, `check` exits
   non-zero with the adoption steps and the path of each file to complete,
   never green; queries answer but print an `UNADOPTED` banner. The forcing
   rule (decision 10) applies only to a repository whose configuration is
   adopted, so a sync alone imposes no obligation a repository cannot meet.
10. **One fleet rule, in `agents-core.md`** (C3), under *Technical
    priorities*: in a repository whose map is adopted, before editing a file
    in the indexed set run the file's dependency queries, and at a class
    sweep use the symbol query as the mechanical oracle for a TypeScript
    class; `claude-core.md` defers to it in one sentence; the class-sweep
    protocol in `working-modes.md` gains one clause naming the symbol query
    beside `git grep` as an oracle shape. The seeded rules file routes to the
    fleet rule and carries the consumer's `paths:`. No other resident text
    changes. Because this reshapes an existing rule's oracle list, the
    `prose-sweep` skill runs on the payload before review is requested.
11. **Remediation messages.** Every failure prints the rule, the file(s), the
    exact command or edit that fixes it, and the path of the direction
    document's section that explains it.
12. **Adoption steps in `consuming-repos.md`**: complete the five seeds and
    the rules file's paths; add `node scripts/map.mjs check` to the always-on
    CI job and a `check:map` script if the repo uses one; run `build`; backfill
    headers; freeze the baseline; and the note that a sync re-delivers the
    tool but never the seeds. The sync test's two-seed assertion is updated
    and a test shows a second sync leaves edited seeds untouched.
14. **The back-out switch** (oracle item 8). `config.json` carries
    `"enabled": true`. When false: `check` exits 0 after printing one line
    (`map disabled by .agents/map/config.json`), the freshness, header,
    boundary and size guards do not run, queries still answer from any index
    present with a `DISABLED` banner, and the forcing rule — in
    `agents-core.md` and in the seeded rules file — is conditioned on
    `adopted && enabled`. Three back-out levels, documented in the direction
    document and `consuming-repos.md`: disable (one line, one consumer, no
    sync); un-adopt (delete `.agents/map/`, the rules file and the CI step;
    headers are inert comments and may stay); remove from the fleet, **in
    this order** (C8): every consumer first removes its CI invocation and
    its consumer-owned configuration and rules file (the sync has no
    authority over those), then the handbook deletes the payload files and
    the next sync takes back every synced copy by the banner mechanism,
    then the contract paragraph goes. Done out of order, an always-on check
    calls a script the sync has already removed. None touches data or
    runtime; every level is a corrective commit. The suite proves the
    switch releases an actual obstruction: a consumer with a failing guard
    flips `enabled` to false and `check` passes with the notice.
15. **The eval protocol and harness** (oracle item 8; C6, C7). Payload:
    `core/docs/ai-context/agent-legible-codebase-eval.md` (the protocol) and
    `core/scripts/map-eval.mjs` (the answer-key harness), which load the
    consumer's compiler by decision 2's rule and share no module with
    `map.mjs`. **Task set**: a consumer-owned `eval-tasks.json`, thirty
    questions for the first consumer, ten per tier — keyword-findable (the
    answer's file shares vocabulary with the question), structural (two to
    four import hops from a named file), hidden (no shared vocabulary; the
    barrel and raw-SQL cases). Each task names its expected file or symbol
    set and, for the structural tier, its hop count. **Answer keys are
    independent of the tool** (C6): for a typed symbol the harness asks the
    compiler's own reference finder (the language service's find-references
    over every declared program), which is a different implementation from
    the map's checker-based extraction and never reads the index; for a
    relation it enumerates every compiler-parsed string and template literal
    carrying the relation token and lists the sites; every key is then
    verified by hand and committed with the task. Scratch breaks and
    diagnostics may corroborate a key and never define its completeness —
    Astra's probe showed a removed export errors only at the barrel while
    the real callers stay silent, and a changed relation literal errors
    nowhere. Acceptance on the synthetic consumer: a key that includes a
    caller behind a barrel with no diagnostic, and a key that includes a
    raw-SQL site. **Arms**: B, the pre-adoption tree with grep only; A, the
    adopted tree with the tool and the forcing rule; the same model in both
    (Sonnet, where mechanical work already routes), a fresh agent and
    worktree per run, two seeds, so about 120 runs. **Metrics**: recall and
    precision against the key; input and output tokens from the harness's
    usage report; tool calls; wall time. **Pre-registered thresholds**,
    written into the protocol before the first run and quoted in the
    direction document — keep: hidden-tier recall up by at least 20 points
    and median tokens across all tiers up by at most 10 percent; disable:
    hidden-tier recall up by fewer than 10 points, or median tokens up by
    more than 25 percent; between: David decides with the numbers. **Cost
    of one run of the eval**: about 120 agent runs; at a guessed 60k tokens
    each that is roughly 7M tokens, about $22 at the table's $3/M Sonnet
    proxy — the per-run size is a guess the first ten runs replace.
    **Lagging indicator**: the maintenance pass counts review findings that
    name a caller the sweep missed, before and after. The run itself is
    #683's; its result sets `enabled` there, and the results are recorded
    on the consumer's workstream issue. **Grading evidence stays out of the
    agents' context** (C9): the committed answer keys and previous scored
    results are held by the scorer; each run's worktree and prompt omit
    them, so an ordinary repository search in either arm cannot encounter
    the key, and a fixture shows run preparation removing them while the
    scorer still reads them.
16. **Where the consumer puts the index.** `.agents/map/index.json` and
    `provenance.json`, beside the configuration, so the consumer's CI
    classifier treats them as agent-config paths and the freshness guard in
    the always-on job is what catches drift (#683's finding about its
    classifier; a consumer with a different classifier adjusts its own
    workflow).

## Repo Context Inspected

`CLAUDE.md`, `AGENTS.md`, `README.md`, `docs/consuming-repos.md`,
`docs/porting-notes.md`; `scripts/sync.mjs` (`routeOf` at 183,
`TOPPED_UP_SEEDS` at 173, the banner regex at 305, `staleFiles` at 388);
`scripts/check-payload-banners.mjs` (seeds exempt, 18–20 and 46);
`scripts/__tests__/sync.test.mjs:98` (two-seed assertion);
`.github/workflows/check.yml` (`Test` 26–60 with the no-install comment,
`Manifest` 63–175); `core/scripts/*.mjs` import lines; `core/.agents/core/
agents-core.md` headings (*Technical priorities* at 119); `core/docs/
ai-context/working-modes.md` (*A finding names an instance; the fix owes the
class* at 1226); `docs/plans/.gitignore`; `.agents/reviews/.gitignore`;
`.agents/machinery.json`. From the consumer: the #683 plan and its two
assessments; Astra's probe in this repository's environment of TypeScript
6.0.2 under `/opt/node-tools` against the consumer's 5.9.3.

## Current Behavior

The payload has no structural tooling: `sweep-scope.mjs` enumerates prose
for readers, `check-docs-accuracy.mjs` resolves citations. The handbook's
scripts import only Node built-ins and sibling modules; the `Test` job
installs nothing by a deliberate, commented decision. Two seeds exist and
the sync test asserts exactly two. `agents-core.md` carries no instruction
about querying structure before an edit. No `core/.claude/rules/` exists.
Consumers navigate by grep and by hand-written maps.

## Source-of-Truth Analysis

| Concept | Source of truth after this plan | Second source avoided |
|---|---|---|
| The tool and its contract | `core/scripts/map.mjs` and `core/docs/ai-context/agent-legible-codebase.md` in the handbook; consumers hold synced copies they never edit | a consumer-owned fork of the script |
| A consumer's structure | its own compiler program, captured in its `.agents/map/index.json` | a hand-written architecture map's file lists |
| A consumer's file sets, vocabulary, manifest, baseline | its four `.agents/map/*.json`, seeded once, consumer-owned | the tool never embeds a consumer's values |
| The forcing rule | `agents-core.md`, one paragraph | a restatement in each consumer's AGENTS.md or in a synced skill |
| Which compiler built an index | the indexed repository's own dependency, recorded in the index | a compiler shipped or assumed by the tool |
| Supported forms | the matrix in the direction document, mirrored by the fixtures and by every answer's `coverage` | per-consumer extraction patches |

## Proposed Design

**One payload script, `map.mjs`**, dependency-free except for the compiler it
loads from the indexed repository: `build`, `check`, `deps <file>`,
`dependents <file|path#symbol>`, `route <METHOD> <path>`, `routes <file>`,
`table <name>`, `purpose <file>`, `subsystem <tag>`, `--json` throughout.
The index holds per file: path, purpose, subsystem, size count, exports,
imports (resolved), route registrations, table declarations, table and
external-relation references, canonical symbol references, and the three
set-membership lists; reverse edges are derived at query time.

**The guards** run from `check`: freshness (regenerate and compare
`index.json` only), headers (both tags present, tag in the vocabulary),
boundaries (every edge allowed or exempted; every exemption live), sizes (no
growth past the allowance), and adoption (no seed still unadopted). Each
failure carries its remediation.

**The integration suite** (handbook-only, decision 1) builds a synthetic
consumer in a temporary workspace with pinned real dependencies (two packages
with a workspace import and differing compiler options, a path alias, a
generated barrel re-exporting a handwritten constant, an Express app with a
mount, a direct registration and an imported handler, a wouter route, a
worker with a regex route, Drizzle tables used through typed calls and through
SQL text, a `pg` client under an unusual name, a locally bound SQL statement,
an unresolvable receiver, a test file a product tsconfig excludes, a
consumer-owned `.mjs` covered by a supplementary program, a codegen-owned
file, a synced-banner file), runs the real `scripts/sync.mjs` into it,
completes the seeds, and exercises every answer shape, the reconciliation
error when the supplementary program is removed, the freshness lifecycle,
the unadopted state, the compiler refusals, and each guard's failure and
remediation. **The payload unit test** covers the pure functions on bare Node.

**The fleet rule and the seeded rules file** are decision 10.

## Data Model and Migration Impact

None. Files in repositories.

## Runtime Behavior

No product runtime anywhere. The tool: a fresh, adopted index answers; a
stale one refuses with exit 3 and the regenerate command; an unadopted one
answers with a banner and fails `check`; a missing compiler refuses with the
install command; an unknown file or symbol is reported with nearest matches.

## Admin/User UX Impact

None.

## Security, Permissions, and Validation

The tool reads a working tree and writes only under `.agents/map/`; no
secrets, network or database. It loads code from the indexed repository's
`node_modules` (the compiler), which every build in that repository already
does. The handbook's threat model for operator-typed values applies to its
arguments. The index records paths, symbol names and route paths, public in
every current consumer; a private consumer's index is as private as its
repository.

## Testing Plan

`scripts/__tests__/map.test.mjs` (handbook-only) under `node --test`,
refusing without the pinned install (decision 3), covering: resolution
through a workspace package, a path alias and a generated barrel; file versus
symbol dependents; every route form in the matrix with registration site and
handler declaration; every table form — typed symbol references through an
alias, each SQL form, the renamed receiver, the locally bound statement — and
external relations; `dynamic-target`, `unsupported-form` and
unresolved-receiver sites retained and reported in `coverage`; the
reconciliation error when an indexed file has no program, and its clearing
when the supplementary program is declared; the compiler refusals (none
local; only an ambient one); the freshness lifecycle (build → commit →
check; docs-only change; fresh checkout; invalidation on a test consumer, a
barrel, a package `exports` entry, a lockfile change and a compiler version
change; byte-identical rebuild; untouched provenance); the three sets and a
codegen run leaving headers green; header, boundary (all three dimensions,
plus dead exemption), size and ratchet failures; the unadopted state;
schema validation of each configuration file; every failure message
carrying a command and a doc path. `core/scripts/__tests__/map.unit.test.mjs`
covers the pure functions and runs anywhere.
`scripts/__tests__/sync.test.mjs`: the seed count, and a second sync
preserving edited seeds. `check-payload-banners.mjs` and
`check-root-wiring.mjs` pass unchanged (the seed count becomes seven: two
existing, four configuration, one eval-tasks). The delivered `map-eval.mjs`
runs on the synthetic consumer and its key is checked against the fixture's
known references. Manual QA: none; #683 proves adoption on the real tree.

## Implementation Steps

One PR, in this order inside it: the tool, its unit test, the integration
suite and the `Test` job install step; the configuration schema with the
`enabled` switch; the eval protocol, harness and eval-tasks seed, all payload; the four seeds and the rules seed; the direction document; the fleet
rule, the `claude-core.md` deferral and the class-sweep clause, followed by
the prose sweep; `consuming-repos.md` adoption steps and the sync-test
updates; research notes under `docs/research/`. Sequencing with #683: this
merges first; Overhype.me syncs, then runs its adoption increment.

## Risks and Mitigations

- **A dependency enters the handbook by the side door.** Mitigation:
  decision 3's temporary install outside the checkout, no root
  `package.json`, and the amended job comment naming the exception.
- **Supported forms drift from the consumers' real code.** Mitigation: the
  matrix is a contract with fixtures; a consumer that meets an unsupported
  form sees it named in `coverage` and files a handbook PR; #683's live
  journeys are the first measurement.
- **A sync imposes an obligation a repository cannot meet.** Mitigation:
  decision 9's unadopted state and decision 10's conditioning.
- **The fleet rule is ignored.** The research measured 58% non-use of an
  offered tool. Mitigation: the rule lives where both agents read it and the
  seeded path rule fires on the files touched; mechanical enforcement is a
  later increment, named as such.
- **Test time in `Test`.** One pinned install (compiler plus four libraries'
  declarations) and one synthetic program per run; measured and reported in
  the PR.
- **The eval shows no gain.** That is a result, not a failure of the plan:
  the switch flips off in the consumer, the lagging indicator keeps
  counting, and removal is decision 14's third level. The research predicts
  no gain on the keyword tier and gain on the hidden tier; a flat hidden
  tier would mean the forcing rule is not being followed or the index is not
  answering, and the eval's per-run transcripts say which.

## Questions for David

None.

## Definition of Done

- [ ] `node --test scripts/__tests__/*.test.mjs` passes in CI with the
      pinned install and refuses locally without it, printing the install
      command; `node --test core/scripts/__tests__/*.test.mjs` passes on bare
      Node, here and in a consumer.
- [ ] The reconciliation error fires on an uncovered indexed file and the
      compiler refusal fires with only an ambient compiler present, both in
      the suite.
- [ ] The synthetic consumer receives the payload by the real sync, completes
      its seeds, and every answer shape, the freshness lifecycle, the
      unadopted state and all four guard failures with remediation are
      demonstrated in the suite.
- [ ] `check-payload-banners.mjs`, `check-root-wiring.mjs` and the sync tests
      pass; the seed count assertion is updated; a second sync preserves
      edited seeds.
- [ ] `agents-core.md` carries the fleet rule once, `claude-core.md` defers,
      `working-modes.md` names the symbol query as an oracle shape, and the
      prose sweep has run.
- [ ] `consuming-repos.md` carries the adoption steps; the direction document
      carries the supported-form matrix.
- [ ] The PR body names the latitude line (none granted) and the decisions
      taken on recommendation.
- [ ] `config.json` carries `enabled`; the suite shows a disabled consumer
      passing `check` with the one-line notice and the forcing rule's
      condition documented in both places.
- [ ] `core/docs/ai-context/agent-legible-codebase-eval.md` carries the
      task-set shape, the arms, the metrics and the thresholds;
      `core/scripts/map-eval.mjs` builds an independent answer key on the
      synthetic consumer that includes a caller behind a barrel with no
      diagnostic and a raw-SQL site, delivered by the sync and run without
      the handbook checkout.
- [ ] The suite shows a failing guard released by `enabled: false`; the
      three-step retirement order is documented in the direction document
      and `consuming-repos.md`.
- [ ] The direction document states the hypothesis and the thresholds.
- [ ] #208's checklist and #683's blocker are updated at merge.
