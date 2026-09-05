# AI-Handbook — Agent Instructions

> Routing file for AI agents working in this repository. The cross-agent
> working contract — how to behave, plan, review and ship — lives in
> [`core/.agents/core/agents-core.md`](core/.agents/core/agents-core.md) and
> applies here in full. **Read it first.** This file covers only what is
> specific to this repository.

## What this repository is

The shared working contract for every product David builds with AI agents. It
contains no product code, no database, and no application. Its `core/`
directory is a **payload**: files vendored into consumer repositories by a
sync, described by `sync-manifest.yml` and
[`docs/consuming-repos.md`](docs/consuming-repos.md).

Consumers as of this writing: `TheAnswerManIsHere/Overhypeme`,
`TheAnswerManIsHere/DojoOS`.

## What that means when you review a change here

- **Every change is a fleet change.** A diff to `core/` alters how agents
  behave in every consumer repository, on every future session. Judge it at
  that scope, not at the scope of the lines shown.
- **`core/` is data, with two deliberate exceptions.** Files under it are what
  other repositories will receive, so review them for what they will do
  *there*. The settings template still configures nothing here — it is a seed
  for the next consumer, and this repo's own `.claude/settings.json` is
  separate. But two things under `core/` now DO take effect here, by reference
  and never by copy: the skills and agents, which `.claude/skills/<name>` and
  `.claude/agents/<name>.md` reach by per-entry symlink, and `guard.sh`, which
  this repo's hooks will name directly once those hooks are installed. So a
  diff to either is a change to this repository's own behaviour as well as to
  every consumer's. See *How this repo reaches its own payload* in
  [`CLAUDE.md`](CLAUDE.md).
- **Coverage is part of correctness.** A file added under `core/` that no group
  in `sync-manifest.yml` claims will never reach a consumer, and the sync will
  still report success. `node scripts/check-manifest.mjs` detects this and runs
  in CI; a change that adds payload without a manifest entry is incomplete.
- **A `staged` group is deliberate, not neglect.** It carries a named blocker
  saying what must land before it can sync. Removing a blocker is a claim that
  the underlying problem is solved — check that it is.
- **Portability is the standard for `core/`.** The test: would this still be
  true, unchanged, in a repository about a different product? A worked example
  naming one product is fine and often necessary — a *dependency* on one
  product's code, paths, skills or subsystems is not.
  [`docs/porting-notes.md`](docs/porting-notes.md) records how the current
  split was drawn.

## Setup, verification, and the CI gate

No install step; the machinery is dependency-free Node.

```
node --test scripts/__tests__/*.test.mjs   # the machinery's own tests
node scripts/check-manifest.mjs          # every payload file is actually routed
node scripts/check-identity-sources.mjs  # every identity touchpoint classified
node scripts/check-root-wiring.mjs       # this repo actually reaches its payload
node scripts/check-settings-fields.mjs   # no settings field Claude Code would refuse
```

These run in the two required checks on every pull request to `main` — `Test`
and `Manifest`, which are the job names `.agents/machinery.json` lists. The
number of *commands* is not the number of *checks*: the last four all run in
`Manifest`, so adding one here adds no new required check and needs no branch-
protection change. Run all five locally; a change that adds payload without a
manifest entry, adds an identity touchpoint without classifying it, adds a
skill without wiring it to the root, or puts a field in a settings file that
Claude Code refuses to load is incomplete and one of them will say so. There is no build,
no typecheck and no database in this repository — if you are looking for them,
you are in the wrong repo.
