import { test } from "node:test";
import assert from "node:assert/strict";
import { parseManifestYaml, check } from "../check-manifest.mjs";

// The point of this suite is the FAILING cases. A manifest checker that only
// ever returns "OK" is indistinguishable from no checker at all, and the
// mistake it guards against (a payload file nobody listed) is silent by
// construction — so each problem class gets an explicit test that it is
// actually detected.

const FILES = ["core/a.md", "core/dir/b.md", "core/dir/c.md"];
const allExist = () => true;

const manifest = (groups) => ({ version: 1, groups });

test("parser reads the manifest's documented subset", () => {
  const doc = parseManifestYaml(`
version: 1

consumers:
  - repo: owner/one
    enrolled: false

groups:
  - id: contracts
    mode: sync
    status: ready
    description: >
      Folded prose that the reader keeps
      but never interprets.
    paths:
      - from: core/dir/
        to: docs/
        exclude:
          - b.md
`);
  assert.equal(doc.version, 1);
  assert.equal(doc.consumers[0].repo, "owner/one");
  assert.equal(doc.consumers[0].enrolled, false);
  assert.equal(doc.groups[0].id, "contracts");
  assert.equal(doc.groups[0].paths[0].from, "core/dir/");
  assert.deepEqual(doc.groups[0].paths[0].exclude, ["b.md"]);
  assert.match(doc.groups[0].description, /Folded prose/);
});

test("parser refuses flow sequences instead of reading them as strings", () => {
  // Not hypothetical: `requires: [machinery]` was written here first, taken as
  // the STRING "[machinery]", and iterated one character at a time — eleven
  // bogus "group not found" problems and no hint at the cause. Taking a flow
  // sequence as a scalar is the single worst thing this reader can do, so it
  // refuses. (An earlier version of this test used a flow sequence followed by
  // a bad indent, and passed on the indent — proving nothing about flow
  // syntax. The input here is otherwise valid.)
  assert.throws(
    () => parseManifestYaml("groups:\n  - id: one\n    requires: [machinery]\n"),
    /flow syntax/,
  );
});

test("parser reads the block-list form that replaced it", () => {
  const doc = parseManifestYaml("groups:\n  - id: one\n    requires:\n      - machinery\n      - guard\n");
  assert.deepEqual(doc.groups[0].requires, ["machinery", "guard"]);
});

test("clean manifest with full coverage reports no problems", () => {
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "two", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.deepEqual(problems, []);
});

test("DETECTS a payload file that no group covers", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "a.md" }] }]),
    FILES,
    allExist,
  );
  assert.equal(problems.filter((p) => p.includes("never sync")).length, 2);
  assert.ok(problems.some((p) => p.includes("core/dir/b.md")));
});

test("DETECTS a declared path that does not exist on disk", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/gone.md", to: "gone.md" }] }]),
    [],
    () => false,
  );
  assert.ok(problems.some((p) => p.includes("does not exist")));
});

test("DETECTS two groups writing the same destination", () => {
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "same.md" }] },
      { id: "two", mode: "sync", status: "ready", paths: [{ from: "core/dir/b.md", to: "same.md" }] },
    ]),
    ["core/a.md", "core/dir/b.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("written by two groups")));
});

test("DETECTS a collision the declared roots do not reveal", () => {
  // The roots differ ("dest/" vs "dest/x.md"), so comparing them says unique.
  // Both nonetheless write dest/x.md, and the sync would silently let copy
  // order decide the winner. Comparing resolved destinations is the point.
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a/", to: "dest/" }] },
      { id: "two", mode: "sync", status: "ready", paths: [{ from: "core/b.md", to: "dest/x.md" }] },
    ]),
    ["core/a/x.md", "core/b.md"],
    allExist,
  );
  assert.ok(
    problems.some((p) => p.includes('destination "dest/x.md" is written by two groups')),
    "a per-file comparison catches what a root comparison cannot",
  );
});

test("a directory mapping's files land at distinct destinations without false alarms", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a/", to: "dest/" }] }]),
    ["core/a/x.md", "core/a/y.md", "core/a/nested/z.md"],
    allExist,
  );
  assert.deepEqual(problems, []);
});

test("DETECTS a ready group that requires a staged one", () => {
  const problems = check(
    manifest([
      { id: "docs", mode: "sync", status: "ready", requires: ["tools"], paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "tools", mode: "sync", status: "staged", blocker: "not portable yet", paths: [{ from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("is ready but requires")));
});

test("a staged group may require another staged group", () => {
  // Staging cascades downward, not upward: two blocked groups blocked on the
  // same thing is coherent, and must not be reported as a problem.
  const problems = check(
    manifest([
      { id: "docs", mode: "sync", status: "staged", blocker: "waits on tools", requires: ["tools"], paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "tools", mode: "sync", status: "staged", blocker: "not portable yet", paths: [{ from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.deepEqual(problems, []);
});

test("DETECTS a requires: naming a group that does not exist", () => {
  const problems = check(
    manifest([
      { id: "docs", mode: "sync", status: "ready", requires: ["typo-here"], paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "rest", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("not a group in this manifest")));
});

test("DETECTS two groups claiming the same payload file", () => {
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "x/" }] },
      { id: "two", mode: "sync", status: "ready", paths: [{ from: "core/dir/b.md", to: "y.md" }] },
    ]),
    ["core/dir/b.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("claimed by two groups")));
});

test("DETECTS a staged group with no stated blocker", () => {
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "two", mode: "sync", status: "staged", paths: [{ from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("must name its blocker")));
});

test("DETECTS an unknown mode or status", () => {
  const problems = check(
    manifest([{ id: "one", mode: "copy", status: "eventually", paths: [{ from: "core/a.md", to: "a.md" }] }]),
    ["core/a.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("mode must be")));
  assert.ok(problems.some((p) => p.includes("status must be")));
});

test("DETECTS a source that escapes the payload directory", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "scripts/x.mjs", to: "x.mjs" }] }]),
    [],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("must live under core/")));
});

test("an excluded leaf stays uncovered, so exclusion cannot hide a file", () => {
  // Excluding a file from one group does not silently drop it: it must be
  // claimed by another group or the coverage check fires. This is what lets
  // guard-decision.mjs live in the `guard` group while the rest of scripts/
  // travels with `machinery`.
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "dir/", exclude: ["b.md"] }] }]),
    ["core/dir/b.md", "core/dir/c.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("never sync") && p.includes("b.md")));
});

test("DETECTS a collision between two path entries of the SAME group", () => {
  // Keying the destination map on group id made this compare equal to itself
  // and disappear. A group with several path entries is the normal case, so
  // the gap sat in the common path rather than an edge.
  const problems = check(
    manifest([
      {
        id: "one",
        mode: "sync",
        status: "ready",
        paths: [
          { from: "core/a/", to: "dest/" },
          { from: "core/b/", to: "dest/" },
        ],
      },
    ]),
    ["core/a/x.md", "core/b/x.md"],
    allExist,
  );
  assert.ok(
    problems.some((p) => p.includes('destination "dest/x.md" is written twice within group "one"')),
    `expected a within-group collision, got: ${JSON.stringify(problems)}`,
  );
});

test("one source mapped by one entry is never reported as colliding with itself", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a/", to: "dest/" }] }]),
    ["core/a/x.md", "core/a/y.md"],
    allExist,
  );
  assert.deepEqual(problems, []);
});

test("DETECTS a duplicate group id instead of last-one-wins", () => {
  // Ambiguity here is not cosmetic: every later check reads the id map, so a
  // silently-dropped record makes readiness depend on declaration order.
  const problems = check(
    manifest([
      { id: "dup", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "dup", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.ok(problems.some((p) => p.includes('duplicate group id "dup"')));
});

test("parser refuses a duplicate key in one mapping", () => {
  // `mode: sync` then `mode: seed` silently became seed — turning a
  // handbook-owned file into a write-once seed with no gate failing. Same
  // class as the duplicate group id, one level down and quieter.
  assert.throws(
    () => parseManifestYaml("groups:\n  - id: one\n    mode: sync\n    mode: seed\n"),
    /duplicate key "mode"/,
  );
});

test("DETECTS a group that declares no paths", () => {
  // A lost or misspelled `paths:` makes a group deliver nothing while still
  // being requirable — a dependency that supplies no files but satisfies the
  // readiness rule.
  const problems = check(
    manifest([
      { id: "empty", mode: "sync", status: "ready" },
      { id: "rest", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "a.md" }, { from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("declares no paths")));
});

test("DETECTS a ready group that still carries a blocker", () => {
  // Unstaging is "clear the blocker AND flip the status". Doing only the
  // second ships a group whose own declaration says it is not ready.
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", blocker: "still unresolved", paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "two", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "dir/" }] },
    ]),
    FILES,
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("must not still carry a blocker")));
});

test("DETECTS destinations that are equal only after normalization", () => {
  // `dest/x.md` and `dest/sub/../x.md` are one file on disk; comparing raw
  // strings lets a path spelling bypass the uniqueness claim.
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "dest/x.md" }] },
      { id: "two", mode: "sync", status: "ready", paths: [{ from: "core/b.md", to: "dest/sub/../x.md" }] },
    ]),
    ["core/a.md", "core/b.md"],
    allExist,
  );
  assert.ok(
    problems.some((p) => p.includes("written by two groups")),
    `expected a normalized collision, got: ${JSON.stringify(problems)}`,
  );
});

test("DETECTS a destination that escapes the consumer root", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "../outside.md" }] }]),
    ["core/a.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("escapes the consumer repo root")));
});
