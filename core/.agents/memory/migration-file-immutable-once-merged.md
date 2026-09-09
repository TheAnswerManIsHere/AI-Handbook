---
name: A migration file already on main is byte-for-byte immutable
description: Editing an already-merged migration is unsafe whatever the runner does — a hash-tracked runner replays the whole file, and a runner journaling by filename or revision silently skips it, leaving schema drift. Treat a migration on main as immutable.
---

<!-- SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead. -->

# Editing an already-merged migration file — even a comment — is never safe

**Overhype:** a hash-tracked migration runner decides whether a migration
already ran by hashing the **entire file content**
(`crypto.createHash("sha256").update(fs.readFileSync(path, "utf8"))`), not by
tag, filename, or journal index. Change one byte of an already-applied
migration — including a comment — and any database that already ran the old
hash sees an unrecognized, "pending" migration on its next `migrate()` call
and replays the whole file. Not idempotent by default: a replayed `INSERT`
duplicates an audit row, a replayed conditional `DELETE` can remove something
a later, legitimate action restored.

**Caught in PR #427 round 9 (Codex), after a docs-only round-8 fix edited a
comment inside `0099_admin_permissions_core.sql` — a different, already-merged
PR's migration that happened to be sitting in the diff.** Verified before
fixing: the edited file's hash matched zero rows in a real database's applied
set; the restored, byte-identical file's hash matched a row already there.

**A runner that journals by filename, tag or revision fails differently — and
worse.** It does not replay, because the identifier it recorded has not
changed; it simply never applies the edit. Every database that already ran the
old text keeps the old schema while the file in `main` describes a new one, and
nothing reports it. So the two mechanisms invert the symptom — a spurious
replay you can see, or silent drift you cannot — and **the verification differs
with them**: check the applied-set hash where the runner hashes, and compare
live schema against the file where it journals by name.

**Rule: a migration file on `main` is immutable, full stop** — no "just a
comment" exception. It holds either way, which is why it is stated without
reference to the mechanism: a hash function has no concept of cosmetic vs.
substantive, and a filename journal cannot see a change at all. Wrong comment,
wrong behavior, whatever the reason: the fix is always a **new** forward-only
migration, or (for pure prose) editing a different file that talks *about* the
migration instead of the migration itself.

**Which kind this repo has is worth knowing before you need it** — the answer
is in whatever its overlay routes to for migrations.

**How to apply:** before editing anything in the migrations directory, ask
whether it's the migration *this* change is introducing (safe — nothing has
run it yet) or someone else's already-merged one (never safe, regardless of
how small the edit looks). If in doubt whether a file has been applied
anywhere, treat it as applied. Full incident and reasoning:
[`known-failure-patterns.md`](../../docs/ai-context/known-failure-patterns.md#editing-an-already-merged-migration-file--even-a-comment--makes-the-hash-tracked-runner-replay-it);
working rule: [`migrations-and-backfills.md`](../../docs/engineering/migrations-and-backfills.md).
