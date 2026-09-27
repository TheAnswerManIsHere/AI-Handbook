---
name: prototype
description: Build a feature in prototype phase to answer a design question with the product owner's own feedback, outside every review loop. Use when David wants to sanity-check whether a state model or logic feels right, explore what a UI should look like, or starts a feature he has declared prototype phase.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Prototype

A prototype is **throwaway code that answers a question**. The question decides the shape.

## Pick a branch

Identify which question is being answered, using the user's prompt, the surrounding code, or by asking if the user is around:

- **"Does this logic / state model feel right?"** → [LOGIC.md](LOGIC.md). Build a single shareable HTML file (free-play buttons plus tabbed guided walkthroughs) that pushes the state machine through cases that are hard to reason about on paper, and that a non-developer can drive.
- **"What should this look like?"** → [UI.md](UI.md). Generate several radically different UI variations on a single route, switchable via a URL search param and a floating bottom bar.

The two branches produce very different artifacts, so getting this wrong wastes the whole prototype. If the question is genuinely ambiguous and the user isn't reachable, default to whichever branch better matches the surrounding code (a backend module → logic; a page or component → UI) and state the assumption at the top of the prototype.

## Rules that apply to both

1. **Throwaway from day one, and clearly marked as such.** Locate the prototype code close to where it will actually be used (next to the module or page it's prototyping for) so context is obvious, but name it so a casual reader can see it's a prototype, not production. For throwaway UI routes, obey whatever routing convention the project already uses; don't invent a new top-level structure.
2. **Trivial to run.** A UI prototype starts from one command in the project's task runner: `pnpm <name>`, `python <path>`, `bun <path>`, etc. A logic demo is a single HTML file the user double-clicks. Either way, no thinking required to start it.
3. **No persistence by default.** State lives in memory. Persistence is the thing the prototype is _checking_, not something it should depend on. If the question explicitly involves a database, hit a scratch DB or a local file with a clear "PROTOTYPE, wipe me" name.
4. **Skip the polish.** No tests, no error handling beyond what makes the prototype _runnable_, no abstractions. The point is to learn something fast.
5. **Surface the state.** After every action (logic) or on every variant switch (UI), print or render the full relevant state so the user can see what changed.
6. **Capture it when done.** Fold any validated decision into the real code, then capture the prototype itself as a **primary source**: commit it to a throwaway branch, out of main, and leave a context pointer to that branch on the implementation issue. Capture the answer too (the verdict and the question it settled) in the issue or a commit. The main branch keeps only the validated decision.

## Local adaptations

Vendored from [mattpocock/skills](https://github.com/mattpocock/skills) (MIT); the body above and [LOGIC.md](LOGIC.md)/[UI.md](UI.md) are upstream verbatim. Upstream is written for a developer who double-clicks files and reviews PRs. Here the person driving a prototype is David, or the product's owner (on DojoOS, Jared), neither of whom runs commands or opens local files, and the prototype is a **product feature in prototype phase** — the rule is [`working-modes.md`](../../../docs/ai-context/working-modes.md#the-prototype-phase-per-feature-david-2026-09-26), and this skill is its enactment. Upstream's *techniques* survive; its *delivery and capture mechanics* are replaced below. (Redesigned with David, 2026-09-26, from the DojoOS video-pipeline spike.)

### What survives from upstream, as techniques

- **State the question first**, at the top of the prototype, in the user's words — and here it is also machine-readable (the questions file, below), because it drives the feedback rail.
- **Keep the logic in one pure module and surface the state** after every action (LOGIC.md). A prototype whose state is visible is one whose feedback can name what it was reacting to.
- **Guided scenarios** that push the awkward cases, beside free play (LOGIC.md).
- **Variants that are structurally different**, never recoloured (UI.md) — for a layout question. A feel question (keystrokes, scrubbing, how many clicks) has one right answer found by using it, and iterates in place instead.
- **The selection is David's** (or the product owner's). I never build variants, pick a winner and present it as settled.

### Where it lives, and how it ships

- **Inside the product repo, as the feature itself.** There is no prototype branch, no throwaway route inside a production page, no separate lab repo (David, 2026-09-26: *"It feels like overkill … EVERYTHING is technically a prototype until we've locked in some decisions."*). The feature's entry in `docs/ai-context/overlay-declarations.md` *Feature phases* says it is in prototype phase, and that entry is written in the same PR that starts the prototype.
- **Ceremony: none.** No plan, no plan-review loop, no scope-of-work gate, no review loop, no tests, no `/simplify`, no hardening bar. I open the PR and merge it myself in the same turn on green CI. Codex's automatic pass runs on PR-open and is read for nothing: each thread resolved with one line naming the phase. The PR body carries the feature name, its phase, and the questions the increment is meant to answer, so the record of what was asked survives the code.
- **Publishing is David's, every time.** I merge to `main`, the product's host syncs it (the Repl, for every consumer today; the overlay's *Environment* section names the host), and I stop. He tests in the development environment, publishes when he chooses (*"go ahead and publish the app"* — through the host's publish tool where the connector offers one, on his word only), and sends the user the link. I never publish on my own reading of readiness, and the merge report says the head is on `main` and unpublished.
- **Big media lives in the product's object storage**, never in the repo and never in an Artifact: a page limit is 16 MB and the DojoOS proxy of one shoot is gigabytes. The prototype loads it by URL, which also exercises the storage decision early.
- **Each merge is a version.** The prototype shows its build (short SHA) in the page, and every piece of feedback carries it, because the owner's comments arrive a day later against whatever was live when they looked.

### The questions file and the feedback rail

The question a prototype exists to answer is written **once, as data**: a `questions` file next to the feature (format chosen with the product's stack; JSON or YAML), one entry per question with its type — a choice, a scale, or free text — and the wording the owner will read. **The feedback rail** is a small shared module of the product, itself a feature in prototype phase and the first one built: it renders those questions on every prototype page, takes an answer per question, takes free notes at any moment, and attaches to each submission the reviewer's name, the build, the page, and the prototype's current state as the logic module reports it. Submissions are stored in the product's own database, shown on a page any of us can read, and exposed as JSON I fetch. Sentry's feedback widget was considered and declined for this: it collects a description, a screenshot, an email and a replay, which is a bug report, and it asks no questions of its own.

**A prototype is answered when every question in its file has an answer.** Those answers, not my summary of them, are what move into the plan — as Product Intent and Settled Decisions — when David declares the feature production. A question the owner cannot answer from the prototype is a prototype that needs another version, not a plan that needs a guess.

### What happens at the flip

David declares a feature production, per feature, in words; no trigger and no agent infers it. From that moment the feature's ledger of shortcuts (kept one line per item in its *Feature phases* entry, as each was taken) is the scope of the first production PR, which runs in the standard loop with the ledger as its oracle. Prototype code is never "promoted": the hardening increment is ordinary feature work through the normal pipeline, and what it keeps of the prototype is whatever survives review.

### Upstream mechanics that do not apply here

- "Double-click this file", `SendUserFile` and Artifact pages as delivery — the delivery is the published product on its domain, on David's word.
- `?variant=` inside an existing production page (UI.md sub-shape A) — variants live in the prototype-phase feature itself.
- UI.md's instruction to hide the variant switcher in production builds (its *Hidden in production builds* rule, gated on `NODE_ENV`) — the published app **is** the delivery here, so on a prototype-phase feature the switcher stays visible in every build; what keeps it from reaching live users is the tester tier below, not the build mode.
- The draft `[PROTOTYPE]` PR as an archive, and the workstream-issue capture step — git history and the feedback store are the archive; the verdict lands in the brief or `decisions.md` at the flip.
- Upstream's fallback of guessing the branch when the user is unreachable — genuine ambiguity about what question is being asked stops for David with a blocking ask, per the standing rule.
- **In a product with live users** (Overhype), a prototype-phase feature's surfaces and its feedback rail render only for users in the **tester tier** the product's overlay names — a tier beside the admin one, switched on by a configuration setting (David, 2026-09-27). The tier is a product feature built through the normal pipeline before the product's first prototype-phase feature ships; until it exists there, a prototype waits.
