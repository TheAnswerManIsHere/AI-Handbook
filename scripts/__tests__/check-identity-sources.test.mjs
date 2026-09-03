import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { scan, keyOf, parseClassification, check } from "../check-identity-sources.mjs";

// As with the manifest checker, the point of this suite is the FAILING cases.
// A check that only ever returns OK is indistinguishable from no check, and
// this one exists precisely because six confident descriptions of the same
// code all passed human review. Each problem class gets a test that it is
// actually detected.

const hit = (file, fn, text) => ({ file, fn, text });
const yaml = (...blocks) => blocks.join("\n");
const entry = (key, fields) =>
  `- key: ${JSON.stringify(key)}\n` +
  Object.entries(fields)
    .map(([k, v]) => `  ${k}: >-\n    ${v}`)
    .join("\n");

const WHY = "sourced from the committed budget, which a local edit cannot move";

test("a touchpoint nobody classified fails, naming a pasteable key", () => {
  const hits = [hit("a.mjs", "f", "const x = state.budget.repo;")];
  const problems = check(hits, new Map());
  assert.equal(problems.length, 1);
  assert.match(problems[0], /UNCLASSIFIED/);
  // The failure prints the exact line to paste, JSON-encoded. Anything less
  // and the fix is a transcription exercise against a key that must match
  // character for character.
  assert.match(problems[0], /- key: "a\.mjs :: f :: const x = state\.budget\.repo;"/);
});

test("a classification for code that no longer exists fails", () => {
  // The half that stops this file rotting. Without it, deleting a touchpoint
  // leaves behind prose describing code that is gone -- which is the exact
  // failure mode the check was built to end, reproduced in the check's own
  // input file.
  const classified = parseClassification(entry("gone.mjs :: f :: x.repo", { source: "github", why: WHY }));
  const problems = check([], classified);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /STALE classification/);
});

test("a classified touchpoint with a recognised source passes", () => {
  const h = hit("a.mjs", "f", "const slug = state.budget.repo;");
  const classified = parseClassification(entry(keyOf(h), { source: "artifact", why: WHY }));
  assert.deepEqual(check([h], classified), []);
});

test("an invented source is refused, not silently accepted", () => {
  // "probably fine" is not one of the five, and a source the check does not
  // recognise is the shape a new untrusted read would arrive in.
  const h = hit("a.mjs", "f", "x.repo");
  const classified = parseClassification(entry(keyOf(h), { source: "probably-fine", why: WHY }));
  const problems = check([h], classified);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /is not one of/);
});

test("a `why` that says nothing fails", () => {
  const h = hit("a.mjs", "f", "x.repo");
  const classified = parseClassification(entry(keyOf(h), { source: "github", why: "trusted" }));
  const problems = check([h], classified);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /needs a `why`/);
});

test("block scalars fill EVERY field, not just `why`", () => {
  // The first parser special-cased `why`, so any other folded field parsed
  // as the literal ">-" -- a truthy value that satisfied whatever rule read
  // it. Kept as a parser property even though the field that exposed it is
  // gone: a classification file that silently drops a field is worse than
  // one that refuses.
  const parsed = parseClassification(
    `- key: "a.mjs :: f :: x.repo"\n  source: >-\n    artifact\n  why: >-\n    ${WHY}`,
  );
  const e = parsed.get("a.mjs :: f :: x.repo");
  assert.equal(e.source.trim(), "artifact");
  assert.doesNotMatch(e.source, /[>|]/);
});

test("a duplicated key is refused, not silently overwritten", () => {
  // Map.set replaced the earlier entry, so a copy-paste that repeated a key
  // passed on whichever classification came last. (Codex, PR #7 round 12.)
  assert.throws(
    () => parseClassification(entry("a.mjs :: f :: x.repo", { source: "github", why: WHY }) + "\n" + entry("a.mjs :: f :: x.repo", { source: "config", why: WHY })),
    /duplicate key/,
  );
});

test("an unquoted key is refused rather than half-parsed", () => {
  // Keys quote lines of source containing `:: `, so an unquoted scalar is
  // ambiguous to a real YAML parser even though a lenient reader would take
  // it. Refusing keeps this file a strict subset of valid YAML.
  assert.throws(
    () => parseClassification(`- key: a.mjs :: f :: x.repo\n  source: snapshot`),
    /must be a double-quoted/,
  );
});

test("scan finds identity touchpoints and ignores comments about them", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ids-"));
  fs.writeFileSync(
    path.join(dir, "z.mjs"),
    ["// a comment mentioning repoSlug() must not count", " * nor a jsdoc line about .repo", "const a = x.repo;", "const b = 1;"].join("\n"),
  );
  const hits = scan(dir);
  assert.equal(hits.length, 1, "only the real read counts");
  assert.equal(hits[0].text, "const a = x.repo;");
  fs.rmSync(dir, { recursive: true });
});

test("the real payload is fully classified", () => {
  // The live assertion. Everything above proves the check works; this proves
  // it currently passes, so a change that adds an identity read fails here.
  const root = path.resolve(import.meta.dirname, "../..");
  const classified = parseClassification(fs.readFileSync(path.join(root, "identity-sources.yml"), "utf8"));
  assert.deepEqual(check(scan(), classified), []);
});
