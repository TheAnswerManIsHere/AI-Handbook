import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  CONFIG, checkAll, checkOne, countBytes, countLines, findRepoRoot, isInside, readBudgets,
} from "../check-claude-md-budget.mjs";

// THIS FILE SHIPS. It runs from `core/scripts/__tests__/` in the handbook and
// from `scripts/__tests__/` in a consumer, so a fixed number of `..` segments
// is wrong in one of them -- the first draft used three and resolved to the
// CONSUMER'S PARENT, making the shipped suite red in every repository that
// received it (Codex, #60 round 1, reproduced). Both paths below are derived
// by asking rather than counting: the root from the same resolver the script
// uses, and the checker from its own directory, where it sits in either
// layout.
const HERE = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = findRepoRoot(HERE);
const CHECKER = resolve(HERE, "..", "check-claude-md-budget.mjs");
const lines = (n) => Array.from({ length: n }, (_, i) => `line ${i + 1}`).join("\n") + "\n";
const fresh = () => mkdtempSync(join(tmpdir(), "budget-test-"));

/** A throwaway repo with a machinery.json, so nothing here touches the real one. */
function repoWith(config, files = {}) {
  const root = fresh();
  mkdirSync(join(root, ".agents"), { recursive: true });
  writeFileSync(join(root, CONFIG), JSON.stringify(config));
  for (const [rel, text] of Object.entries(files)) {
    mkdirSync(dirname(join(root, rel)), { recursive: true });
    writeFileSync(join(root, rel), text);
  }
  return root;
}

// ── counting ───────────────────────────────────────────────────────────────

test("countLines matches wc -l semantics", () => {
  assert.equal(countLines(""), 0);
  assert.equal(countLines("a\n"), 1);
  assert.equal(countLines("a\nb"), 2);
  assert.equal(countLines("a\nb\n"), 2);
});

test("countBytes counts UTF-8 bytes, not characters", () => {
  assert.equal(countBytes("a"), 1);
  assert.equal(countBytes("🛑"), 4);
});

// ── the comparison ─────────────────────────────────────────────────────────

test("an exact match passes", () => {
  const text = lines(10);
  assert.equal(checkOne({ path: "X.md", lines: 10, bytes: countBytes(text) }, text), null);
});

test("one line over fails, and the message names the numbers and the fix", () => {
  const text = lines(11);
  const msg = checkOne({ path: "X.md", lines: 10, bytes: countBytes(lines(10)) }, text);
  assert.ok(msg, "expected a failure");
  assert.match(msg, /over budget/);
  assert.match(msg, /11 lines/);
  assert.match(msg, /decisions\.md/);
  assert.match(msg, /re-pin the numbers/i);
});

test("same-line growth still fails, because the byte budget is checked too", () => {
  // Either budget alone is gameable: lines by writing longer lines.
  const base = lines(10);
  const grown = base.replace("line 10\n", "line 10 " + "x".repeat(500) + "\n");
  assert.equal(countLines(grown), countLines(base));
  const msg = checkOne({ path: "X.md", lines: 10, bytes: countBytes(base) }, grown);
  assert.ok(msg, "expected a failure");
  assert.match(msg, /over budget/);
});

test("UNDER budget fails too — slack is the state this check exists to prevent", () => {
  // The distinguishing behaviour of this version. A budget with room left is
  // satisfied by exactly the condition the mechanism is for, and where this
  // rule came from that drifted twice in one afternoon after a raise, because
  // a later commit shrank the file and the numbers stayed put.
  const text = lines(8);
  const msg = checkOne({ path: "X.md", lines: 10, bytes: countBytes(lines(10)) }, text);
  assert.ok(msg, "a file under its budget must fail");
  assert.match(msg, /UNDER budget/);
  assert.match(msg, /slack/);
  assert.doesNotMatch(msg, /over budget/);
});

// ── the declaration ────────────────────────────────────────────────────────

test("no contractBudgets is a refusal, not a silent pass", () => {
  // A consumer receiving the lock, running it in CI, and being protected by
  // nothing -- with a green check saying otherwise -- is the failure this
  // refusal exists to prevent.
  const root = repoWith({ repo: "o/r" });
  try {
    assert.throws(() => readBudgets(root), /declares no `contractBudgets`/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("an empty or non-array declaration is refused", () => {
  for (const value of [[], {}, "CLAUDE.md"]) {
    const root = repoWith({ repo: "o/r", contractBudgets: value });
    try {
      assert.throws(() => readBudgets(root), /must be a non-empty array/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a malformed entry is refused rather than defaulted", () => {
  const bad = [
    { lines: 1, bytes: 1 },                       // no path
    { path: "X.md", bytes: 1 },                   // no lines
    { path: "X.md", lines: 1 },                   // no bytes
    { path: "X.md", lines: "10", bytes: 1 },      // not an integer
    { path: "X.md", lines: -1, bytes: 1 },        // negative
  ];
  for (const entry of bad) {
    const root = repoWith({ repo: "o/r", contractBudgets: [entry] });
    try {
      assert.throws(() => readBudgets(root), /needs a non-empty `path`/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("a declared file that does not exist is a failure, not a skip", () => {
  const root = repoWith({ repo: "o/r", contractBudgets: [{ path: "missing.md", lines: 1, bytes: 1 }] });
  try {
    const failures = checkAll(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /cannot be read/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("every declared file is checked, not just the first", () => {
  const root = repoWith(
    { repo: "o/r", contractBudgets: [
      { path: "a.md", lines: 1, bytes: 1 },
      { path: "b.md", lines: 1, bytes: 1 },
    ] },
    { "a.md": lines(5), "b.md": lines(5) },
  );
  try {
    assert.equal(checkAll(root).length, 2, "both files must report");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ── locating the repo ──────────────────────────────────────────────────────

test("findRepoRoot asks the filesystem rather than matching the path string", () => {
  // The script lives one level deeper in the handbook than in a consumer, and
  // deciding that by looking for "/core/" in a path is the compare-a-path-as-a
  // -string defect class this repository has paid for repeatedly.
  const root = repoWith({ repo: "o/r", contractBudgets: [{ path: "X.md", lines: 0, bytes: 0 }] });
  try {
    const deep = join(root, "core", "scripts");
    mkdirSync(deep, { recursive: true });
    assert.equal(findRepoRoot(deep), root);
    assert.equal(findRepoRoot(join(root, "scripts")), root, "and from a consumer's depth");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("findRepoRoot reports 'not found' rather than guessing a root", () => {
  // It returns null instead of throwing because it is also read on the guard
  // path, where an escaping exception exits 1 and the harness reads that as
  // allow. The CLI turns the null into a refusal.
  const orphan = fresh();
  try {
    assert.equal(findRepoRoot(orphan), null);
  } finally {
    rmSync(orphan, { recursive: true, force: true });
  }
});

// ── the live lock ──────────────────────────────────────────────────────────

test("this repository's own contract files match their declared budgets EXACTLY", () => {
  assert.ok(REPO_ROOT, `no ${CONFIG} found above ${HERE} — declare one, or this lock protects nothing`);
  const budgets = readBudgets(REPO_ROOT);
  assert.ok(budgets.length > 0);
  assert.deepEqual(
    checkAll(REPO_ROOT, budgets),
    [],
    "re-pin contractBudgets in .agents/machinery.json in the same commit that changes a contract file",
  );
});

// ── the entry-point form, checked statically ───────────────────────────────

test("the entry-point guard compares URLs, not a hand-built file:// string", () => {
  // A hand-built `file://` string differs from `import.meta.url` on any path
  // needing escaping (a space, a `#`), and a script that never runs exits 0 --
  // which a caller reads as success. Same defect as #11.
  const src = readFileSync(CHECKER, "utf8");
  assert.match(src, /import\.meta\.url === pathToFileURL\(process\.argv\[1\]\)\.href/);
  // Match the CONSTRUCTION, not the words. The first version of this line
  // looked for a backtick followed by `file://` and so was tripped by the
  // script's own comment explaining the defect -- a check that fires on its
  // own documentation is a false positive generator, and the prose is exactly
  // what should be allowed to say "file://".
  assert.doesNotMatch(src, /`file:\/\/\$\{/, "no interpolated file:// URL built by hand");
  assert.doesNotMatch(src, /"file:\/\/" ?\+/, "no concatenated file:// URL built by hand");
});

test("a budget naming a file outside the repository is refused, not read", () => {
  // `resolve` honours `..` and discards the root for an absolute path, so a
  // declaration could point at a file outside and pass by matching ITS size,
  // leaving the repository's real contract unchecked behind a green board.
  const root = repoWith(
    { repo: "o/r", contractBudgets: [{ path: "../outside.md", lines: 1, bytes: 8 }] },
    { "inside.md": "x\n" },
  );
  try {
    writeFileSync(join(dirname(root), "outside.md"), "outside\n");
    const failures = checkAll(root);
    assert.equal(failures.length, 1);
    assert.match(failures[0], /outside the repository/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("isInside compares locations, not string prefixes", () => {
  assert.equal(isInside("/a/b", "/a/b"), true);
  assert.equal(isInside("/a/b", "/a/b/c"), true);
  assert.equal(isInside("/a/b", "/a/bc"), false, "the prefix trap");
  assert.equal(isInside("/a/b", "/a"), false);
});

test("root discovery stops at the enclosing repository, not the filesystem", () => {
  // A checkout nested under a configured parent must fail closed rather than
  // adopt the parent's configuration and report success over the wrong
  // contract (Codex, #60 round 1, reproduced).
  const parent = repoWith({ repo: "parent/repo", contractBudgets: [{ path: "C.md", lines: 1, bytes: 2 }] });
  try {
    const child = join(parent, "child");
    mkdirSync(join(child, ".git"), { recursive: true });
    mkdirSync(join(child, "scripts"), { recursive: true });
    assert.equal(findRepoRoot(join(child, "scripts")), null, "must not cross the child's .git");
  } finally {
    rmSync(parent, { recursive: true, force: true });
  }
});
