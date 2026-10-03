# Chapter 5 · Opening a pull request

> How finished work leaves Claude's branch and becomes something the rest of
> the system can act on: a fresh branch cut from `main`, a pull request opened
> for every change, and a PR body that carries the agreed intent so the
> reviewer judges the code against what David asked for, not only against
> itself. Underneath sit GitHub's server-side rules, which decide what may
> reach `main` at all — and since 2026-10-03 they bind everyone, David
> included.
>
> Deep rules: [`claude-core.md`](../../core/.agents/core/claude-core.md) —
> *Pull requests* and *This environment's git constraints*; the
> [`pr-docs`](../../core/.claude/skills/pr-docs/SKILL.md) skill for the
> verification and UAT halves of a feature PR.

## What it does

A pull request is the unit everything downstream works on.
[Codex](./glossary.md#codex) reviews a
pull request, not a branch; the review loop of chapter 6 runs on its threads;
[close-out](./glossary.md#close-out) (chapter 7) merges it; and the [workstream](./glossary.md#workstream)
issue that tracks a piece of work points at it. Work that never becomes a pull
request is invisible to all of that, so the rule is simple: **work with commits
gets a pull request before Claude's turn ends**, against `main`, every time.

The PR body is the other half of the job. Codex cannot see the conversation
in which David and Claude agreed what the change is for. So the body carries
that agreement — the [oracle](./glossary.md#oracle) — word for word, and one
plain line saying where it came from. A reviewer holding the oracle can
catch a change that does exactly what the code says and still not what David
wanted.

## How it works

### A fresh branch, cut from `main`

Every branch starts from the current `main` on GitHub, freshly fetched, never
from whatever Claude happened to have checked out. Claude's cloud sessions
push to branches under `claude/`; a feature David has put in
[prototype phase](./glossary.md#prototype-phase), in a product with users
downstream of `main`, lives on a `prototype/<feature>` branch instead (chapter
3). The contract names those two namespaces and prescribes no finer naming
scheme.

Two disciplines govern what goes on a branch:

- **One bug, one branch, one pull request.** In
  [bug-fixing mode](./glossary.md#bug-fixing-mode) a fix is never stacked on
  another unmerged fix. A bug that depends on another waits for its parent to
  merge and then branches from the new `main` — or the two turn out to be one
  bug and ship together.
- **A merged branch is restarted fresh.** When a pull request squash-merges,
  GitHub deletes its branch; follow-up work starts again from `main`, as a new
  branch and a new pull request.

### Always a pull request

Before opening one, Claude checks whether an open pull request already exists
for the branch; if it does, the new push simply joins it. Otherwise it opens
one. There are only a handful of exceptions: pure exploration, David
explicitly saying "no PR", and a `prototype/<feature>` branch, which David's
declaration of the phase has already exempted.

Cloud sessions run under a platform instruction not to open pull requests
unless the user explicitly asks. The contract treats its own rule as that
explicit request — David wrote it down once, for every branch — so a session
that stops to ask "shall I open a PR?" is making him repeat a standing
instruction.

For a production-phase product feature, Claude first runs a simplification
pass over the changed code. A cleaner diff draws fewer findings, and every
finding can cost a review round.

### What the body carries

**The oracle, verbatim.** What counts as the oracle depends on what kind of
work this is (chapter 3 explains the routing):

- **A feature in [production phase](./glossary.md#production-phase)** — the
  approved plan's product intent, what must not change, and its settled
  decisions, copied exactly, plus the direction the plan serves. The
  direction matters because code can satisfy a narrow increment while
  quietly working against the larger goal it belongs to.
- **A bugfix** — the oracle the [bugfix tier](./glossary.md#bugfix-tier)
  requires: the reported symptom in David's words, the intended behaviour,
  what must not change, the root cause and the blast radius.
- **A prototype-phase change on `main`** — the questions the increment is
  meant to answer and, if the version had a plan, that short plan.
- **"n/a — no plan"** — only for a genuinely trivial change.

**One line naming what the code is judged against.** The `Oracle source:` line
points a reviewer at the oracle's origin: the approved plan with a fingerprint
of its exact text (an in-session plan is never committed, so the fingerprint
is what pins the version David approved), the issue where the scope was agreed
in conversation, the bugfix tier, the prototype feature, or "no plan". Nothing
parses it; it is a pointer for people.

**A link to the workstream, never a closing keyword.** The body says
`Workstream: #N`. It never says "Closes #N" for its own workstream, because
GitHub would close the issue at merge — before post-merge verification and
before David has tested anything (chapter 10).

**The latitude line.** A pull request that widens what Claude may do on its
own — a permission, a check that constrains it, a line of the working
contract granting new autonomy — says so in one plain sentence, and the merge
report repeats it. Such a change merges under the same bar as any other; the
line is what makes the widening something David reads rather than something
that slips past.

**For a product-visible feature, two more pieces.** The
[`pr-docs`](../../core/.claude/skills/pr-docs/SKILL.md) skill adds a
[*Post-merge verification*](./glossary.md#post-merge-verification) section — checks that only the live environment can
answer, run through the Replit connector at close-out — and a
[UAT](./glossary.md#uat) script David will be walked through. The UAT file is
named after the pull request's number, so the PR opens first with a "docs
pending" note, and the script is committed to the same pull request before it
merges. Bugfixes and prototype-phase changes do not inherit this pairing.

**Later additions.** A phase of a larger feature adds a line saying which
parts of the parent plan this phase delivers and which it defers, so a
reviewer can tell a postponed requirement from a dropped one. And once review
starts, any finding Claude decides not to fix is recorded in a *Recorded gaps*
table in the body (chapter 6).

One piece of hygiene applies to every word in the body: reserved strings —
the phrase that triggers a Codex review is the main one — are never written
live in anything GitHub-facing. They appear in an agreed defanged spelling
(chapter 8).

### Then Claude subscribes

The moment the pull request exists, Claude subscribes to its activity, so
review comments and CI results arrive in the session as events. Codex's first
review fires automatically when the pull request opens. From there the review
loop of chapter 6 takes over.

### What the server enforces

GitHub's branch [rulesets](./glossary.md#ruleset) are the hard floor under all
of this. They are server-side, so no session can disarm them and none of them
can fail open:

- **On `main`**, nothing lands except a merged pull request whose required
  checks pass and whose review threads are all resolved; history cannot be
  rewritten or the branch deleted. The thread requirement is what makes the
  Merge button inert while a review conversation is still open.
- **On every branch**, force pushes are refused.

**Since 2026-10-03 the rulesets have no bypass for anyone.** David removed the
administrator exemption from every ruleset in every repository: *"Yes,
everything goes through a pull request."* That includes his own display-only
tweaks made through Replit, which now arrive on a branch and merge as a pull
request — merging on green CI when he declares the change
[Trivial](./glossary.md#trivial). It also includes Claude's cloud session,
which pushes under David's own account. So a commit on `main` with no pull
request behind it is not a normal event any more: it means a ruleset has been
loosened, and Claude tells David in one line.

Above the rulesets sits one more layer that is not the handbook's at all: the
platform's own classifier, which may refuse an in-place edit Claude makes to
its own guardrail files. That edit then goes through a pull request like any
other.

### Never force-push; correct forward

Claude never rewrites history that has been pushed. A bad commit gets a
corrective commit on top. A branch that needs newly landed `main` merges it
in rather than rebasing; there is no need to rebase "to sit on top of main",
because squash-merge reconciles against current `main` at merge time anyway. A
local copy that has drifted from its remote is reset to match the remote, and
the local copy is what gives way.

There is exactly one situation that would seem to need a force push:
restarting a branch from scratch under the same name before it has merged.
The answer is a new branch name and a new pull request.

### Sweeping a prototype branch

`main` needs no check for stray commits, because nothing reaches it outside a
merged pull request. The one place direct commits still land is a
`prototype/<feature>` branch, which opens no pull request and which its own
environment tracks. A session working on one checks that branch for recent
commits made through Replit, bounded by time rather than by a count, reads
what it finds, and folds anything real into the feature's next version.

## Why it works this way

- **The reviewer needs the intent, and only the body can carry it.** Codex
  reads the pull request and nothing else. Without the oracle it can only
  judge whether the code is internally sound; with it, it can catch code that
  works and still misses the point.
- **Verbatim, because a paraphrase drifts.** A summary of the plan is
  Claude's prose, and a slip in it would reach the reviewer unchecked. For the
  same reason, the two assessors of chapter 6 take the oracle from where it
  was agreed — the plan, the issue, David's words — and never from the PR
  body.
- **A pointer, not a parsed block.** The oracle's provenance used to live in a
  fixed-format block with its own parser. Nothing had read it since the #89
  cut, and its rigid grammar forced a false declaration on work agreed in
  conversation with no plan file. A plain line does the job: it tells a reader
  where to look. (David, 2026-09-25.)
- **Visibility replaced David's click.** Pull requests that widened Claude's
  latitude used to wait for David to merge them himself. He never once
  withheld the click, and it cost a round trip every time, so on 2026-09-14
  he retired the gate. What took its place is a single line he cannot miss.
- **No stacking** (David, 2026-08-20). One bug per branch, always based on
  `main`, keeps each review about one change and lets each fix merge — or be
  abandoned — on its own, without dragging a half-reviewed parent along.
- **"Never force-push" is a habit, not a fact about the server.** The rule is
  written as something Claude does not do, rather than as "the server will
  stop me", because a contract that leans on the server retires the habit —
  and the habit is what covers a new repository whose rulesets are not yet
  configured. It is also not just caution: rewriting history does not undo a
  leaked secret (the copy is already published; the remedy is rotation), and
  the only force-push incident on file is one where the old local guard
  *prevented* fixing a corrupted commit message.
- **Server-side rules replaced a local guard.** Until the
  [#89 cut](./glossary.md#the-89-cut) a shell guard tried to parse Claude's
  commands and refuse dangerous ones. A parser chasing a real shell's syntax is
  a losing game, and a guard that runs inside the session could be disarmed by
  something as small as a change of directory. The rulesets cannot fail open
  and cannot be sidestepped that way.
- **One lane into `main`, with no exceptions.** For two months David's own
  Replit pushes landed directly and were checked only by a retrospective sweep.
  Once every change arrives as a pull request, the sweep has nothing to do on
  `main`, and an unexplained commit there becomes a clear signal rather than
  routine noise.
- **A sweep bounded by time, never by count.** An earlier sweep looked at the
  last few commits; in a busy week it silently missed the next one, and a
  missed commit looks exactly like a checked one.

## Boundaries & known limitations

- **The all-branches force-push block has not been separately tested.** The
  refusal was measured on a `claude/` branch. A `prototype/<feature>` branch
  lives outside that namespace for weeks with no pull request, so the
  all-branches ruleset is its only mechanical protection; the contract
  recommends probing it before a product's first branch-regime prototype.
- **The PR body's oracle is a copy Claude wrote.** It is there for Codex. The
  authoritative version is wherever David agreed it, which is why the
  assessors are pointed there instead.
- **Deleting a remote branch from the session does not work** — the agent
  proxy hangs on it. Nothing in the normal flow needs it; GitHub removes a
  branch when its pull request merges.
- **In this repository** there is no product, no UAT and no post-merge
  verification of a running app, and almost every change is
  [internal tier](./glossary.md#internal-tier) work. The latitude line matters
  more here than anywhere, because this repository is made almost entirely of
  the files that set Claude's latitude ([`CLAUDE.md`](../../CLAUDE.md),
  *Ceremony*).

## Going deeper

- [`claude-core.md`](../../core/.agents/core/claude-core.md) — *Pull requests*
  (the body, the oracle, the `Oracle source:` line, the pre-PR pass) and *This
  environment's git constraints* (rulesets, force pushes, corrective commits,
  the prototype-branch sweep).
- [`pr-docs`](../../core/.claude/skills/pr-docs/SKILL.md) — the post-merge
  verification section and the UAT script for a production-phase feature.
- [`workstream-tracking.md`](../../core/docs/ai-context/workstream-tracking.md)
  — why the body links its workstream rather than closing it.
- [`replit-commits-reach-main-only-through-a-pr.md`](../../core/.agents/memory/replit-commits-reach-main-only-through-a-pr.md)
  — the retired direct-push lane and what replaced it.
- [`CLAUDE.md`](../../CLAUDE.md), *The guard is gone* — what replaced the
  local shell guard in this repository.

**Next:** chapter 6 — [`6-the-review-loop.md`](./6-the-review-loop.md), what
happens between the pull request opening and the judgement that nothing more
is worth writing.

*Verified against `118e076` (2026-10-03).*
