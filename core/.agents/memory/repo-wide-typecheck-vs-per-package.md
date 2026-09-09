---
name: A scoped typecheck can pass while the repo-wide one fails
description: Adding a cross-package import means declaring that edge in the consuming package's own build manifest. A check scoped to the packages you edited proves nothing about the sibling that actually breaks — verify with the repo-wide command.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# A check scoped to the packages you edited doesn't catch a sibling you didn't

Where a monorepo build resolves cross-package imports through a **declared**
dependency graph — one list per package, maintained by hand — that graph is
stricter than the module resolution the runtime uses. An import can resolve
fine at runtime (via symlinks, or a package manifest's `exports`) while the
build system rejects it, because the edge was never declared. The two answers
disagree, and only one of them runs in CI.

The trap is that **the package that breaks is not the package you were
working in.** You add the import to a shared or peripheral package, then run
the scoped check over the two packages the feature is *about* — and those are
clean, because neither one is the package whose declaration list you just made
incomplete. The scoped check never covered the file you edited.

**Overhype:** the build system is TypeScript's project-reference mode
(`tsc -b`), which resolves a workspace import (`@workspace/api-zod`,
`@workspace/db`, …) only through the consuming package's `tsconfig.json`
`references` array.

**Concretely (PR #242):** added `@workspace/api-zod` as a new dependency of the
`scripts` package (for a shared seed helper) but never added
`{ "path": "../lib/api-zod" }` to `scripts/tsconfig.json`'s `references`. Running
`pnpm --filter @workspace/api-server exec tsc -b` and
`pnpm --filter @workspace/overhype-me exec tsc -b` (the packages actually being
worked on) both stayed clean — neither touches `scripts`. The repo-wide
`pnpm typecheck` (which the root `package.json` runs, and what CI/Codex actually
uses to catch this) failed with `TS2307: Cannot find module '@workspace/api-zod'`
in `scripts/src/seed.ts` and `reseed-facts.ts` — caught by Codex review, not by
any of the per-package checks run during the build.

**Rule, in two halves — the second is the one that generalises furthest:**

1. After adding a cross-package dependency to **any** package, declare that
   edge in that package's own build manifest in the same edit, not later.
   (**Overhype:** add `{ "path": "../lib/<pkg>" }` to that package's
   `tsconfig.json` `references` after adding an `@workspace/*` dependency.)
2. **Verify with the repo-wide command, never a scoped one.** A scoped check
   proves only that the packages it covers are complete; it says nothing about
   a sibling you didn't touch — and the sibling is exactly where this breaks.
   This half holds for any check with a scope flag, not just typechecking:
   whatever CI runs is what has to come back green.
