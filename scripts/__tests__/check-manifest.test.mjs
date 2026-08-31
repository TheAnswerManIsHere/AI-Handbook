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

test("parser throws rather than guessing at syntax it does not model", () => {
  // A flow mapping is valid YAML and NOT part of this reader's subset.
  // Silently mis-reading it would defeat the whole check.
  assert.throws(() => parseManifestYaml("groups: [a, b]\n  bad: indent\n"));
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
