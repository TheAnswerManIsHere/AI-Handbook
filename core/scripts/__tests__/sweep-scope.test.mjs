// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { validateSpec, globToRegExp, payloadPrefix, scopeFiles, toRepoPath, partition, plan, assertWorkers, headingSlugs, clearBriefs, ROOT_FILES, ALWAYS_IN_SCOPE } from "../sweep-scope.mjs";

const SPEC = {
  rule: "when a review loop stops",
  home: "docs/ai-context/working-modes.md#the-write-gate-rule-code-written-is-code-reviewed-david-2026-08-22",
  subShapes: [
    { id: "a", name: "a cap", example: "one triage" },
    { id: "b", name: "a write with no review after it", example: "fix, apply, continue" },
  ],
  notInClass: ["Past-tense history that names the retired rule as retired, with its replacement"],
  readInFull: ["docs/ai-context/working-modes.md", ".claude/agents/*.md"],
};

/** A throwaway git repo shaped like a payload; `consumer` puts it at the root, otherwise under core/. */
function fixture({ consumer = false } = {}) {
  const root = mkdtempSync(join(tmpdir(), "sweep-scope-"));
  const p = consumer ? "" : "core/";
  const files = {
    [`${p}.agents/core/claude-core.md`]: "a\nb\nc\n",
    [`${p}.agents/roles/review-proxy.md`]: "x\ny\n",
    [`${p}.claude/agents/fable-review-assessor.md`]: "one\n",
    [`${p}.agents/memory/note.md`]: "m\n",
    [`${p}docs/ai-context/working-modes.md`]: "# Modes\n\n#### The write-gate rule: code written is code reviewed (David, 2026-08-22)\n\n" + "w\n".repeat(46),
    [`${p}docs/ai-context/other.md`]: "o\n".repeat(10),
    [`${p}.claude/skills/bugfix/SKILL.md`]: "s\n".repeat(20),
    [`${p}scripts/tool.mjs`]: "// not markdown\n",
    "CLAUDE.md": "root\n",
    "AGENTS.md": "root\n",
    "README.md": "root\n",
    "docs/not-payload.md": "outside the payload\n",
  };
  for (const [f, body] of Object.entries(files)) {
    mkdirSync(join(root, f, ".."), { recursive: true });
    writeFileSync(join(root, f), body);
  }
  writeFileSync(join(root, "untracked.md"), "never added\n");
  const git = (...a) => execFileSync("git", a, { cwd: root, stdio: "pipe" });
  git("init", "-q");
  git("add", "--", ...Object.keys(files));
  return root;
}

test("a spec missing any of the four inputs refuses, naming the input", () => {
  assert.deepEqual(validateSpec(SPEC), []);
  assert.match(validateSpec({ ...SPEC, rule: "" }).join(), /rule/);
  assert.match(validateSpec({ ...SPEC, home: undefined }).join(), /home/);
  assert.match(validateSpec({ ...SPEC, subShapes: [SPEC.subShapes[0]] }).join(), /subShapes.*two or more/);
  assert.match(validateSpec({ ...SPEC, subShapes: [SPEC.subShapes[0], { ...SPEC.subShapes[1], id: "a" }] }).join(), /distinct/);
  assert.match(validateSpec({ ...SPEC, notInClass: [] }).join(), /notInClass/);
  assert.match(validateSpec({ ...SPEC, readInFull: "docs" }).join(), /readInFull/);
  assert.match(validateSpec("nope").join(), /object/);
});

test("globs: ** crosses directories, * does not", () => {
  assert.ok(globToRegExp(".claude/agents/*.md").test(".claude/agents/x.md"));
  assert.ok(!globToRegExp(".claude/agents/*.md").test(".claude/agents/deep/x.md"));
  assert.ok(globToRegExp(".claude/skills/**/*.md").test(".claude/skills/bugfix/SKILL.md"));
  assert.ok(globToRegExp("docs/ai-context/working-modes.md").test("docs/ai-context/working-modes.md"));
  assert.ok(!globToRegExp("docs/ai-context/working-modes.md").test("docs/ai-context/working-modesXmd"));
});

test("scope is git's tracked payload markdown plus the root files, and the directories a docs-shaped scope misses", () => {
  const root = fixture();
  assert.equal(payloadPrefix(root), "core/");
  const { files } = scopeFiles(root);
  for (const r of ROOT_FILES) assert.ok(files.includes(r), r);
  for (const d of ALWAYS_IN_SCOPE) assert.ok(files.some((f) => f.startsWith("core/" + d)), d);
  assert.ok(!files.includes("untracked.md"), "untracked files are not corpus");
  assert.ok(!files.includes("docs/not-payload.md"), "handbook-root docs outside the payload are not scope by default");
  assert.ok(!files.some((f) => f.endsWith(".mjs")), "prose only");
  assert.ok(scopeFiles(root, { include: ["docs/*.md"] }).files.includes("docs/not-payload.md"), "--include widens it");
});

test("a consumer has the payload at the root and needs no prefix", () => {
  const root = fixture({ consumer: true });
  assert.equal(payloadPrefix(root), "");
  assert.equal(toRepoPath("", "docs/ai-context/working-modes.md"), "docs/ai-context/working-modes.md");
  assert.equal(toRepoPath("core/", "docs/ai-context/working-modes.md"), "core/docs/ai-context/working-modes.md");
  assert.equal(toRepoPath("core/", "core/docs/x.md"), "core/docs/x.md", "already-prefixed stays");
  assert.equal(toRepoPath("core/", "CLAUDE.md"), "CLAUDE.md", "root files are never prefixed");
  assert.ok(scopeFiles(root).files.includes(".agents/roles/review-proxy.md"));
});

test("partition covers every file exactly once and keeps swept directories whole", () => {
  const files = ["a/1.md", "a/2.md", "b/1.md", "c/1.md", "full/x.md", "full/y.md"];
  const lines = { "a/1.md": 10, "a/2.md": 10, "b/1.md": 5, "c/1.md": 5, "full/x.md": 100, "full/y.md": 90 };
  const buckets = partition({ files, fullSet: new Set(["full/x.md", "full/y.md"]), lines }, 2);
  const seen = buckets.flatMap((b) => [...b.full, ...b.swept]).sort();
  assert.deepEqual(seen, [...files].sort());
  assert.deepEqual(buckets.map((b) => b.full), [["full/x.md"], ["full/y.md"]], "heaviest full reads spread first");
  const dirOf = (f) => f.split("/")[0];
  for (const b of buckets) for (const d of new Set(b.swept.map(dirOf))) {
    assert.ok(!buckets.some((o) => o !== b && o.swept.some((f) => dirOf(f) === d)), `directory ${d} split across workers`);
  }
  assert.deepEqual(partition({ files, fullSet: new Set(), lines }, 2), partition({ files, fullSet: new Set(), lines }, 2), "deterministic");
});

test("heading slugs follow GitHub's algorithm on the payload's headings, in document order", () => {
  const md = "# A Title\n\n#### The write-gate rule: code written is code reviewed (David, 2026-08-22)\n\n## parent_id and created_at\n\n## Dup\n\n```\n# not a heading\n```\n\n## Dup\n";
  assert.deepEqual(headingSlugs(md), [
    "a-title",
    "the-write-gate-rule-code-written-is-code-reviewed-david-2026-08-22",
    "parent_id-and-created_at",
    "dup",
    "dup-1",
  ]);
});

test("a mistyped or empty home anchor refuses; a real one is accepted", () => {
  const root = fixture();
  assert.throws(() => plan({ root, spec: { ...SPEC, home: "docs/ai-context/working-modes.md#the-write-gate-rul" } }), /names no heading/);
  assert.throws(() => plan({ root, spec: { ...SPEC, home: "docs/ai-context/working-modes.md#" } }), /names no heading/);
  assert.doesNotThrow(() => plan({ root, spec: SPEC }));
  assert.doesNotThrow(() => plan({ root, spec: { ...SPEC, home: "docs/ai-context/working-modes.md" } }), "no anchor is allowed");
});

test("a worker count below two, non-integer or non-numeric refuses, naming the value", () => {
  for (const bad of [1, 0, -3, 2.5, "abc", "", NaN]) {
    assert.throws(() => assertWorkers(bad), /at least 2/, String(bad));
    assert.throws(() => plan({ root: fixture(), spec: SPEC, workers: bad }), /at least 2/, String(bad));
  }
  assert.equal(assertWorkers("4"), 4, "a numeric string from argv is fine");
});

test("a rerun with fewer workers leaves no stale brief behind", () => {
  const dir = mkdtempSync(join(tmpdir(), "sweep-out-"));
  for (const n of [1, 2, 3, 4]) writeFileSync(join(dir, `worker-${n}.md`), "old");
  writeFileSync(join(dir, "inventory.json"), "{}");
  writeFileSync(join(dir, "notes.md"), "mine");
  clearBriefs(dir);
  assert.deepEqual(readdirSync(dir).sort(), ["inventory.json", "notes.md"], "only the script's own worker-N.md files are removed");
});

test("plan refuses a home outside scope and a readInFull glob that matches nothing", () => {
  const root = fixture();
  assert.throws(() => plan({ root, spec: { ...SPEC, home: "docs/ai-context/missing.md" } }), /home .*not a tracked/);
  assert.throws(() => plan({ root, spec: { ...SPEC, readInFull: ["docs/ai-context/typo-*.md"] } }), /matches no file/);
  assert.throws(() => plan({ root, spec: { ...SPEC, notInClass: [] } }), /spec refused/);
});

test("plan reads the home in full, maps payload-relative globs, and writes one brief per worker carrying the whole spec", () => {
  const root = fixture();
  const r = plan({ root, spec: SPEC, workers: 3 });
  assert.equal(r.homeFile, "core/docs/ai-context/working-modes.md");
  assert.ok(r.fullSet.includes("core/docs/ai-context/working-modes.md"));
  assert.ok(r.fullSet.includes("core/.claude/agents/fable-review-assessor.md"), "a payload-relative glob reaches core/");
  assert.equal(r.briefs.length, 3);
  const all = r.buckets.flatMap((b) => [...b.full, ...b.swept]).sort();
  assert.deepEqual(all, [...r.files].sort(), "every in-scope file is assigned to exactly one worker");
  for (const brief of r.briefs) {
    assert.ok(brief.includes(SPEC.rule));
    assert.ok(brief.includes("`core/docs/ai-context/working-modes.md#the-write-gate-rule-code-written-is-code-reviewed-david-2026-08-22`"), "home is named, repo-relative, anchor kept");
    for (const s of SPEC.subShapes) assert.ok(brief.includes(`| **${s.id}** | ${s.name} | \`${s.example}\` |`), s.id);
    for (const x of SPEC.notInClass) assert.ok(brief.includes(x));
    assert.match(brief, /statement ABOUT the rule, rather than\s+pointing AT it/, "the structural test");
    assert.ok(brief.includes("OPENED: n / READ IN FULL: n / SWEPT: n"), "the inventory declaration");
    assert.ok(brief.includes("Declined candidates"), "declined list is mandatory");
    assert.ok(/`high` \| `medium` \| `low`/.test(brief), "confidence survives to the report");
    assert.ok(brief.includes("Do not edit any file"));
  }
  const fullMentions = r.briefs.join("\n").match(/— read in full$/gm) ?? [];
  assert.equal(fullMentions.length, r.fullSet.length, "each full-read file is listed on exactly one brief");
});
