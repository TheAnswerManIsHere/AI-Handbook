import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  parseManifestYaml,
  check,
  checkDerivedDependencies,
  referenceFormsFor,
  uniqueSuffixesOf,
  mentionsForm,
  walk,
} from "../check-manifest.mjs";

// The point of this suite is the FAILING cases. A manifest checker that only
// ever returns "OK" is indistinguishable from no checker at all, and the
// mistake it guards against (a payload file nobody listed) is silent by
// construction — so each problem class gets an explicit test that it is
// actually detected.

const FILES = ["core/a.md", "core/dir/b.md", "core/dir/c.md"];
const allExist = () => true;

// A valid manifest needs a consumers list, so the helper supplies one: these
// tests are about groups, and every one of them would otherwise carry a
// "declares no consumers" problem it never meant to assert.
const CONSUMERS = [{ repo: "owner/one", enrolled: false }];
const manifest = (groups) => ({ version: 1, consumers: CONSUMERS, groups });

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

// `..` is its own normal form, so it never matched the "../" prefix test that
// the escape check was written around. The bare case and the case that reduces
// to it are both covered, because `a/../..` is how it arrives in practice.
test("DETECTS a destination that normalizes to exactly ..", () => {
  for (const to of ["..", "a/../.."]) {
    const problems = check(
      manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to }] }]),
      ["core/a.md"],
      allExist,
    );
    assert.ok(
      problems.some((p) => p.includes("escapes the consumer repo root")),
      `"${to}" was accepted as a destination`,
    );
  }
});

// The duplicate-key guard lives inside the map reader, which never sees the
// key written on the dash line — so group identity was the one field the guard
// could not protect.
test("parser refuses a key repeated between a dash line and its indented block", () => {
  assert.throws(
    () => parseManifestYaml("groups:\n  - id: original\n    id: overwritten\n    mode: sync\n"),
    /duplicate key "id" in one list item/,
  );
});

test("parser still reads a normal list item whose keys are all distinct", () => {
  const doc = parseManifestYaml("groups:\n  - id: one\n    mode: sync\n    status: ready\n");
  assert.deepEqual(doc.groups[0], { id: "one", mode: "sync", status: "ready" });
});

// "Matches files" and "delivers files" are different claims. A group that
// excludes every leaf it matched can still be marked ready and satisfy another
// group's `requires` while supplying nothing.
test("DETECTS a group whose exclusions cover every file it matches", () => {
  const problems = check(
    manifest([
      { id: "empty", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "d/", exclude: ["b.md", "c.md"] }] },
      { id: "real", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "docs/" }] },
    ]),
    ["core/dir/b.md", "core/dir/c.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("delivers nothing")));
});

test("a group that excludes SOME of its files is not reported as empty", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/dir/", to: "d/", exclude: ["b.md"] }] }]),
    ["core/dir/b.md", "core/dir/c.md"],
    allExist,
  );
  assert.equal(problems.filter((p) => p.includes("delivers nothing")).length, 0);
});

// A misspelled `requires` is kept by the reader and ignored by the readiness
// gate, so the group ships with its dependency silently dropped. Absence
// cannot be the signal — plenty of groups have no dependencies — so the
// spelling is checked instead.
test("DETECTS a misspelled requires key rather than ignoring it", () => {
  const problems = check(
    manifest([
      { id: "one", mode: "sync", status: "ready", require: ["two"], paths: [{ from: "core/a.md", to: "a.md" }] },
      { id: "two", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/dir/b.md", to: "b.md" }] },
    ]),
    ["core/a.md", "core/dir/b.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes('unknown group key "require"')));
});

test("DETECTS an unknown path key", () => {
  const problems = check(
    manifest([{ id: "one", mode: "sync", status: "ready", paths: [{ from: "core/a.md", to: "a.md", excludes: ["x"] }] }]),
    ["core/a.md"],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes('unknown path key "excludes"')));
});

test("every key the real manifest uses is in the known-key schema", () => {
  // The schema is a denylist by construction: adding a manifest feature without
  // adding its key here turns a valid manifest red. This catches that inversion
  // in the same commit rather than in CI on someone else's branch.
  const doc = parseManifestYaml(readFileSync(new URL("../../sync-manifest.yml", import.meta.url), "utf8"));
  const problems = check(doc, [], () => true).filter((p) => p.includes("unknown"));
  assert.deepEqual(problems, []);
});

// --- consumers: the list that decides who the sync targets ---

const withConsumers = (groups) => manifest(groups);

test("DETECTS a misspelled enrolled key on a consumer", () => {
  const problems = check(
    { version: 1, consumers: [{ repo: "owner/one", enroled: true }], groups: [] },
    [],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes('unknown key "enroled"')));
});

test("DETECTS a non-boolean enrolled value", () => {
  const problems = check(
    { version: 1, consumers: [{ repo: "owner/one", enrolled: "true" }], groups: [] },
    [],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes('"enrolled" must be true or false')));
});

test("DETECTS a duplicated consumer repo", () => {
  const problems = check(
    {
      version: 1,
      groups: [],
      consumers: [
        { repo: "owner/one", enrolled: true },
        { repo: "owner/one", enrolled: false },
      ],
    },
    [],
    allExist,
  );
  assert.ok(problems.some((p) => p.includes("is listed twice")));
});

test("DETECTS a missing or malformed consumers list", () => {
  for (const manifestValue of [{ version: 1, groups: [] }, { version: 1, consumers: [], groups: [] }]) {
    const problems = check(manifestValue, [], allExist);
    assert.ok(problems.some((p) => p.includes("declares no consumers")));
  }
  const bad = check({ version: 1, consumers: [{ repo: "no-slash", enrolled: true }], groups: [] }, [], allExist);
  assert.ok(bad.some((p) => p.includes("owner/name")));
});

// --- the dependency graph, derived from the files rather than declared ---

test("DERIVES an undeclared dependency from a markdown link", () => {
  const problems = checkDerivedDependencies(
    withConsumers([
      { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }] },
      { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "b/" }] },
    ]),
    ["core/a/one.md", "core/b/two.md"],
    (f) => (f === "core/a/one.md" ? "see [two](../b/two.md)" : ""),
  );
  assert.ok(problems.some((p) => p.includes('a references files delivered by "b"')));
});

test("DERIVES an undeclared dependency from a static import", () => {
  const problems = checkDerivedDependencies(
    withConsumers([
      { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }] },
      { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "b/" }] },
    ]),
    ["core/a/one.mjs", "core/b/two.mjs"],
    (f) => (f === "core/a/one.mjs" ? 'import { x } from "../b/two.mjs";' : ""),
  );
  assert.ok(problems.some((p) => p.includes('a references files delivered by "b"')));
});

// The one reference proving planning depends on engineering carries a heading
// anchor. A first version of this derivation skipped any link containing "#"
// and silently under-reported exactly the edge it existed to find.

test("a declared dependency is not reported", () => {
  const problems = checkDerivedDependencies(
    withConsumers([
      { id: "a", mode: "sync", status: "staged", blocker: "x", requires: ["b"], paths: [{ from: "core/a/", to: "a/" }] },
      { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "b/" }] },
    ]),
    ["core/a/one.md", "core/b/two.md"],
    (f) => (f === "core/a/one.md" ? "see [two](../b/two.md)" : ""),
  );
  assert.deepEqual(problems, []);
});

test("a TRANSITIVE dependency satisfies the requirement", () => {
  // A requires B, B requires C. A's reference to a C file is already covered,
  // because a group goes ready only when everything it requires is ready.
  const problems = checkDerivedDependencies(
    withConsumers([
      { id: "a", mode: "sync", status: "staged", blocker: "x", requires: ["b"], paths: [{ from: "core/a/", to: "a/" }] },
      { id: "b", mode: "sync", status: "staged", blocker: "x", requires: ["c"], paths: [{ from: "core/b/", to: "b/" }] },
      { id: "c", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/c/", to: "c/" }] },
    ]),
    ["core/a/one.md", "core/b/two.md", "core/c/three.md"],
    (f) => (f === "core/a/one.md" ? "see [three](../c/three.md)" : ""),
  );
  assert.deepEqual(problems, []);
});

test("a dependency CYCLE terminates instead of hanging", () => {
  // Cycles are legitimate here — five groups in the real manifest form one —
  // so closure traversal must be cycle-safe rather than assume a DAG.
  const problems = checkDerivedDependencies(
    withConsumers([
      { id: "a", mode: "sync", status: "staged", blocker: "x", requires: ["b"], paths: [{ from: "core/a/", to: "a/" }] },
      { id: "b", mode: "sync", status: "staged", blocker: "x", requires: ["a"], paths: [{ from: "core/b/", to: "b/" }] },
    ]),
    ["core/a/one.md", "core/b/two.md"],
    (f) => (f === "core/a/one.md" ? "see [two](../b/two.md)" : ""),
  );
  assert.deepEqual(problems, []);
});

test("external and same-group links are not dependencies", () => {
  const problems = checkDerivedDependencies(
    withConsumers([
      { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }] },
    ]),
    ["core/a/one.md", "core/a/two.md"],
    (f) => (f === "core/a/one.md" ? "[x](https://example.com/y.md) [y](./two.md) [z](#anchor)" : ""),
  );
  assert.deepEqual(problems, []);
});

test("the real manifest declares every dependency its files imply", () => {
  // The regression bar for the graph itself: this is what three review rounds
  // corrected by hand, and it now fails in CI instead.
  const doc = parseManifestYaml(readFileSync(new URL("../../sync-manifest.yml", import.meta.url), "utf8"));
  const root = new URL("../../", import.meta.url);
  const files = walk(new URL("core", root).pathname, root.pathname.replace(/\/$/, ""));
  const problems = checkDerivedDependencies(doc, files.map((f) => f.split("\\").join("/")), (f) =>
    readFileSync(new URL(f, root), "utf8"),
  );
  assert.deepEqual(problems, []);
});

test("DERIVES a dependency from a SINGLE-quoted static import", () => {
  // The payload is uniformly double-quoted today, which is why a
  // double-quote-only regex looked correct. The gate's answer must not depend
  // on the author's formatting.
  const problems = checkDerivedDependencies(
    manifest([
      { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }] },
      { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "b/" }] },
    ]),
    ["core/a/one.mjs", "core/b/two.mjs"],
    (f) => (f === "core/a/one.mjs" ? "import { x } from '../b/two.mjs';" : ""),
  );
  assert.ok(problems.some((p) => p.includes('a references files delivered by "b"')));
});

// Every static form puts the specifier in one place. Two rounds were spent
// growing a statement-shaped regex — single quotes, then multiline and
// re-exports — before it became clear that enumerating statement syntax is a
// list, and lists of this kind do not converge. These pin the forms.

test("DERIVES a dependency from a static re-export across groups", () => {
  const problems = checkDerivedDependencies(
    manifest([
      { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }] },
      { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "b/" }] },
    ]),
    ["core/a/one.mjs", "core/b/two.mjs"],
    (f) => (f === "core/a/one.mjs" ? 'export { x } from "../b/two.mjs";' : ""),
  );
  assert.ok(problems.some((p) => p.includes('a references files delivered by "b"')));
});

// Some payload is referenced by NAME, not by path — a skill saying "spawn the
// semgrep-scanner agent" depends on the group delivering that agent, and no
// link resolver can see it. That edge survived nine review rounds.
test("DERIVES a dependency from an agent referenced by name", () => {
  const problems = checkDerivedDependencies(
    manifest([
      { id: "skills", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/skills/", to: "s/" }] },
      { id: "agents", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/.claude/agents/", to: ".claude/agents/" }] },
    ]),
    ["core/skills/a/SKILL.md", "core/.claude/agents/my-scanner.md"],
    (f) => (f === "core/skills/a/SKILL.md" ? "Use `subagent_type: my-scanner` for this step." : ""),
  );
  assert.ok(problems.some((p) => p.includes('skills references files delivered by "agents"')));
  assert.ok(problems.some((p) => p.includes('names "my-scanner"')));
});

test("an agent name embedded in a longer identifier is not a reference", () => {
  const problems = checkDerivedDependencies(
    manifest([
      { id: "skills", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/skills/", to: "s/" }] },
      { id: "agents", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/.claude/agents/", to: ".claude/agents/" }] },
    ]),
    ["core/skills/a/SKILL.md", "core/.claude/agents/scanner.md"],
    (f) => (f === "core/skills/a/SKILL.md" ? "see legacy-scanner-v2 and scanners" : ""),
  );
  assert.deepEqual(problems, []);
});

test("the agent-name set is derived from the payload, not hardcoded", () => {
  // Adding an agent file must extend the check with no edit here.
  const problems = checkDerivedDependencies(
    manifest([
      { id: "skills", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/skills/", to: "s/" }] },
      { id: "agents", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/.claude/agents/", to: ".claude/agents/" }] },
    ]),
    ["core/skills/a/SKILL.md", "core/.claude/agents/brand-new-agent.md"],
    (f) => (f === "core/skills/a/SKILL.md" ? "delegate to brand-new-agent" : ""),
  );
  assert.ok(problems.some((p) => p.includes('names "brand-new-agent"')));
});

// --- resolution: the bounded set of ways one file identifies another ---

const twoGroups = (extra = {}) =>
  manifest([
    { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }], ...extra },
    { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "deep/b/" }] },
  ]);

// --- mentions: the classification a syntactic check cannot make ---

test("the real manifest declares or classifies every reference its files imply", () => {
  // The regression bar for the graph. Eleven review rounds corrected it by
  // hand; it now fails in CI instead.
  const doc = parseManifestYaml(readFileSync(new URL("../../sync-manifest.yml", import.meta.url), "utf8"));
  const root = new URL("../../", import.meta.url);
  const files = walk(new URL("core", root).pathname, root.pathname.replace(/\/$/, ""));
  const problems = checkDerivedDependencies(doc, files.map((f) => f.split("\\").join("/")), (f) =>
    readFileSync(new URL(f, root), "utf8"),
  );
  assert.deepEqual(problems, []);
});

// --- reference forms: the payload is the search set, nothing is enumerated ---

test("referenceFormsFor computes every way a target can be named", () => {
  const destOf = new Map([["core/b/two.md", "deep/b/two.md"]]);
  const uniq = uniqueSuffixesOf(destOf);
  const forms = referenceFormsFor("core/a/one.md", "core/b/two.md", destOf, uniq);
  for (const expected of ["../b/two.md", "deep/b/two.md", "b/two.md", "two.md"]) {
    assert.ok(forms.includes(expected), `missing form: ${expected}`);
  }
});

test("a filename shared by two destinations is nobody's identifying form", () => {
  // "README.md" is a suffix of several destinations and identifies none of
  // them, so it must not resolve to any single one.
  const destOf = new Map([["core/a/README.md", "a/README.md"], ["core/b/README.md", "b/README.md"]]);
  const uniq = uniqueSuffixesOf(destOf);
  assert.deepEqual(uniq.get("core/a/README.md") ?? [], ["a/README.md"]);
  assert.ok(!(uniq.get("core/a/README.md") ?? []).includes("README.md"));
});

test("mentionsForm requires path boundaries, with no alphabet of its own", () => {
  // The boundary test looks at what SURROUNDS the match, which is why the
  // inversion has no character class to omit anything from. `c++.md` works for
  // free, and that was the finding that prompted the inversion.
  assert.equal(mentionsForm("see .gitignore now", ".gitignore"), true);
  assert.equal(mentionsForm("it is gitignored here", ".gitignore"), false);
  assert.equal(mentionsForm("read ../b/c++.md today", "../b/c++.md"), true);
  assert.equal(mentionsForm("read xtwo.md", "two.md"), false);
  assert.equal(mentionsForm("read two.md.bak", "two.md"), false);
  assert.equal(mentionsForm("at https://x.com/docs/two.md", "docs/two.md"), false);
  assert.equal(mentionsForm("`{baseDir}/deep/b/two.md`", "deep/b/two.md"), true);
});

test("DERIVES an edge from any syntax, because syntax is never inspected", () => {
  const groups = (extra = {}) =>
    manifest([
      { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }], ...extra },
      { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "deep/b/" }] },
    ]);
  for (const [label, text] of [
    ["markdown link", "see [two](../b/two.md)"],
    ["backticked prose", "the logic lives in `../b/two.md`"],
    ["templated path", "Use `{baseDir}/deep/b/two.md` for the method"],
    ["bare prose", "documented in deep/b/two.md."],
    ["unusual characters", "see ../b/two.md alongside c++ notes"],
  ]) {
    const problems = checkDerivedDependencies(groups(), ["core/a/one.md", "core/b/two.md"],
      (f) => (f === "core/a/one.md" ? text : ""));
    assert.ok(problems.some((p) => p.includes('a references files delivered by "b"')), label);
  }
});

// --- mentions: scoped, reasoned, and never covering an import ---

const pair = (extra = {}) =>
  manifest([
    { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }], ...extra },
    { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "b/" }] },
  ]);
const M = (o) => ({ group: "b", ref: "core/b/two.md", from: "core/a/one.md", why: "evidence", ...o });

test("a fully scoped mention suppresses exactly its own reference", () => {
  const problems = checkDerivedDependencies(pair({ mentions: [M()] }), ["core/a/one.md", "core/b/two.md"],
    (f) => (f === "core/a/one.md" ? "see [two](../b/two.md)" : ""));
  assert.deepEqual(problems, []);
});

test("DETECTS a mention whose group does not own its ref", () => {
  // A typo in `group` would otherwise grant an exemption for a file that group
  // does not deliver, suppressing a real edge while every other check passes.
  const problems = checkDerivedDependencies(pair({ mentions: [M({ group: "a" })] }),
    ["core/a/one.md", "core/b/two.md"], (f) => (f === "core/a/one.md" ? "see [two](../b/two.md)" : ""));
  assert.ok(problems.some((p) => p.includes('a references files delivered by "b"')));
});

test("DETECTS a mention with no from", () => {
  const problems = check(pair({ mentions: [{ group: "b", ref: "core/b/two.md", why: "no from" }] }),
    ["core/a/one.md", "core/b/two.md"], allExist);
  assert.ok(problems.some((p) => p.includes('without a "from"')));
});

test("a mention scoped to one source does not cover another", () => {
  const problems = checkDerivedDependencies(pair({ mentions: [M()] }),
    ["core/a/one.md", "core/a/other.md", "core/b/two.md"],
    () => "see [two](../b/two.md)");
  assert.ok(problems.some((p) => p.includes("core/a/other.md")));
});

test("a mention NEVER exempts a static import, comments included", () => {
  for (const src of [
    'import { x } from "../b/two.mjs";',
    'import { x } from /* why */ "../b/two.mjs";',
    "import { x } from // why\n  '../b/two.mjs';",
  ]) {
    const problems = checkDerivedDependencies(
      manifest([
        { id: "a", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/a/", to: "a/" }],
          mentions: [{ group: "b", ref: "core/b/two.mjs", from: "core/a/one.mjs", why: "a comment mentions it" }] },
        { id: "b", mode: "sync", status: "staged", blocker: "x", paths: [{ from: "core/b/", to: "b/" }] },
      ]),
      ["core/a/one.mjs", "core/b/two.mjs"],
      (f) => (f === "core/a/one.mjs" ? src : ""),
    );
    assert.ok(problems.some((p) => p.includes('a references files delivered by "b"')), src);
  }
});

test("every reference is reported, not one per group pair", () => {
  // Exemptions are per source file, so reporting one per pair meant a
  // maintainer fixed one and got the next, one round-trip at a time.
  const problems = checkDerivedDependencies(pair(), ["core/a/one.md", "core/a/other.md", "core/b/two.md"],
    () => "see [two](../b/two.md)");
  assert.equal(problems.filter((p) => p.includes('delivered by "b"')).length, 2);
});

test("the real manifest declares or classifies every reference its files imply", () => {
  const doc = parseManifestYaml(readFileSync(new URL("../../sync-manifest.yml", import.meta.url), "utf8"));
  const root = new URL("../../", import.meta.url);
  const files = walk(new URL("core", root).pathname, root.pathname.replace(/\/$/, ""));
  const problems = checkDerivedDependencies(doc, files.map((f) => f.split("\\").join("/")), (f) =>
    readFileSync(new URL(f, root), "utf8"),
  );
  assert.deepEqual(problems, []);
});

test("DETECTS consumer repos that differ only in case", () => {
  const problems = check(
    { version: 1, groups: [], consumers: [{ repo: "Owner/Repo", enrolled: true }, { repo: "owner/repo", enrolled: false }] },
    [], allExist,
  );
  assert.ok(problems.some((p) => p.includes("is listed twice")));
});

test("DETECTS malformed mentions entries", () => {
  for (const [entry, expected] of [
    [{ group: "b", from: "core/a/one.md", why: "no ref" }, 'without a "ref"'],
    [{ group: "b", ref: "core/b/two.md", from: "core/a/one.md" }, "without saying why"],
    [{ group: "nope", ref: "core/b/two.md", from: "core/a/one.md", why: "x" }, 'which is not a group'],
    [{ group: "b", ref: "core/b/two.md", from: "core/a/one.md", why: "x", reson: "typo" }, 'unknown mentions key'],
  ]) {
    const problems = check(pair({ mentions: [entry] }), ["core/a/one.md", "core/b/two.md"], allExist);
    assert.ok(problems.some((p) => p.includes(expected)), expected);
  }
});

test("DETECTS a group that both requires and mentions the same group", () => {
  const problems = check(pair({ requires: ["b"], mentions: [M({ why: "contradictory" })] }),
    ["core/a/one.md", "core/b/two.md"], allExist);
  assert.ok(problems.some((p) => p.includes("either a dependency or it is not")));
});
