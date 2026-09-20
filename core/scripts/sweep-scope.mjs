#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
// Prose-sweep scope: the deterministic half of `docs/ai-context/prose-sweep.md`.
//
// A sweep's two measured failures were both scope failures: a file set drawn
// from the diff (12 of 27 instances were in files no diff names) and a
// docs-shaped scope that missed the role brief and the agent definition the
// review loop's own advisors read every round. So the scope is never written
// by hand. This enumerates the payload from git's tracked set -- the corpus
// question's definition, per known-failure-patterns' `git grep` lesson --
// partitions it across cold readers, and composes each reader's brief from
// the spec, so every reader gets the same rule, the same sub-shapes and the
// same not-in-class list, and the only thing that varies is which files.
//
// It is NOT a phrase checker and never reads file contents for matches. The
// class was un-greppable in 12 of 27 cases; the reading is the readers' job.
//
// Spec (JSON), all four required -- a spec missing one refuses, naming it:
//   rule        one sentence naming what is swept for, by meaning
//   home        the one authoritative file, payload-relative, optional #anchor
//   subShapes   [{ id, name, example }] -- two or more, enumerated by shape
//   notInClass  [string] -- one or more exclusions
//   readInFull  [glob] -- optional; files read end to end. Everything else in
//               scope is swept by heading and vocabulary in context. A glob
//               matching nothing refuses: a typo must not silently become
//               "nothing read in full".
//
// Run:  node scripts/sweep-scope.mjs --spec <path.json> [--workers 4] --out <dir>
//       node scripts/sweep-scope.mjs --spec <path.json> --print-scope

import { readFileSync, writeFileSync, mkdirSync, existsSync, readdirSync, unlinkSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { join, resolve, dirname, posix } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

/** Directories a docs-shaped scope misses and this one must not (prose-sweep.md, *Scope*). */
export const ALWAYS_IN_SCOPE = [".agents/roles/", ".claude/agents/", ".agents/memory/"];
/** Repo-root files that describe the payload and carry its claims. */
export const ROOT_FILES = ["CLAUDE.md", "AGENTS.md", "README.md"];
/** A swept file costs a reader roughly this fraction of a full read; used only to balance workers. */
export const SWEPT_WEIGHT = 0.3;
export const DEFAULT_WORKERS = 4;

// ---------------------------------------------------------------------------
// Spec
// ---------------------------------------------------------------------------

export function validateSpec(spec) {
  const problems = [];
  if (!spec || typeof spec !== "object" || Array.isArray(spec)) return ["spec must be a JSON object"];
  if (typeof spec.rule !== "string" || !spec.rule.trim()) problems.push("rule: one sentence naming what is swept for");
  if (typeof spec.home !== "string" || !spec.home.trim()) problems.push("home: the one authoritative file, payload-relative");
  if (!Array.isArray(spec.subShapes) || spec.subShapes.length < 2) {
    problems.push("subShapes: two or more { id, name, example } -- one shape is always an undercount");
  } else {
    spec.subShapes.forEach((s, i) => {
      for (const k of ["id", "name", "example"]) {
        if (!s || typeof s[k] !== "string" || !s[k].trim()) problems.push(`subShapes[${i}].${k}: required`);
      }
    });
    const ids = spec.subShapes.map((s) => s?.id);
    if (new Set(ids).size !== ids.length) problems.push("subShapes: ids must be distinct");
  }
  if (!Array.isArray(spec.notInClass) || spec.notInClass.length < 1 || spec.notInClass.some((x) => typeof x !== "string" || !x.trim())) {
    problems.push("notInClass: one or more exclusions -- without it readers return the whole history section");
  }
  if (spec.readInFull !== undefined && (!Array.isArray(spec.readInFull) || spec.readInFull.some((g) => typeof g !== "string" || !g.trim()))) {
    problems.push("readInFull: an array of globs when present");
  }
  return problems;
}

// ---------------------------------------------------------------------------
// Corpus -- git's tracked set, never a directory walk
// ---------------------------------------------------------------------------

/**
 * Where the payload lives relative to the repo root. The handbook carries it
 * under `core/` and governs itself with it; a consumer has it at the root.
 */
export function payloadPrefix(root) {
  return existsSync(join(root, "core", ".agents", "core", "claude-core.md")) ? "core/" : "";
}

export function trackedMarkdown(root) {
  const out = execFileSync("git", ["ls-files", "-z", "--", "*.md", "**/*.md"], { cwd: root, encoding: "utf8" });
  return out.split("\0").filter(Boolean).sort();
}

/** The sweep's scope: every tracked .md in the payload, plus the root files. */
export function scopeFiles(root, { include = [] } = {}) {
  const prefix = payloadPrefix(root);
  const all = trackedMarkdown(root);
  const inPayload = (f) => (prefix ? f.startsWith(prefix) : true);
  const isRoot = (f) => ROOT_FILES.includes(f);
  const extra = include.map((g) => {
    const re = globToRegExp(g.replace(/^\.\//, ""));
    // The same refusal readInFull has: a mistyped include must not quietly
    // become "the default scope, reported as complete".
    if (!all.some((f) => re.test(f))) throw new Error(`sweep-scope: --include "${g}" matches no tracked file`);
    return re;
  });
  const files = all.filter((f) => inPayload(f) || isRoot(f) || extra.some((re) => re.test(f)));
  return { prefix, files };
}

/** payload-relative -> repo-relative, so a spec written for a consumer works in the handbook unchanged. */
export function toRepoPath(prefix, p) {
  const clean = p.replace(/^\.\//, "");
  if (ROOT_FILES.includes(clean)) return clean;
  if (prefix && clean.startsWith(prefix)) return clean;
  return prefix + clean;
}

export function globToRegExp(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*") {
      if (glob[i + 1] === "*") {
        re += ".*";
        i++;
        if (glob[i + 1] === "/") i++;
      } else re += "[^/]*";
    } else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

export function lineCount(root, file) {
  const text = readFileSync(join(root, file), "utf8");
  return text.length === 0 ? 0 : text.split("\n").length;
}

/** An operator-typed count: an integer of at least two, or refuse naming it. One reader is not a sweep. */
export function assertWorkers(value) {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(n) || n < 2) {
    throw new Error(`sweep-scope: --workers must be an integer of at least 2 (got ${JSON.stringify(value)}); a sweep needs more than one cold reader`);
  }
  return n;
}

/**
 * GitHub's heading anchors, for validating a spec's `#fragment` against the
 * home file. Two halves. The character half -- lowercase; keep letters,
 * numbers, marks, `_`, `-` and spaces; spaces to hyphens -- is github-slugger's
 * on every heading this payload has; the divergence
 * `.agents/memory/github-slugger-is-the-anchor-algorithm.md` measures is ~61
 * connector-punctuation characters no heading here contains, and the classic
 * error it warns of (stripping `_`) is avoided. The dedupe half is
 * github-slugger's loop verbatim: occurrences are keyed by the slug actually
 * EMITTED, and a collision bumps the original's counter until the result is
 * unused -- so `Foo`, `Foo`, `Foo-1` give `foo`, `foo-1`, `foo-1-1`, never a
 * duplicate anchor. (A by-base counter gave `foo-1` twice; Codex, #141 round
 * 3.) A miss refuses; it never guesses a nearby heading. The payload is
 * dependency-free by rule, which is why this is not the package.
 *
 * BOTH Markdown heading forms are recognised, because a consumer's docs need
 * not use this payload's convention: ATX (`## Title`) and Setext (`Title`
 * over `===` or `---`). Reading only ATX made `plan()` refuse the real
 * GitHub anchor of a correctly-written consumer home (Codex, #141 round 5).
 * The Setext underline is matched conservatively -- the line above must be
 * ordinary paragraph text, so a `---` that is really front matter, a
 * thematic break, or a table delimiter never invents a heading.
 */
export function headingSlugs(markdown) {
  const occurrences = new Map();
  const out = [];
  const lines = markdown.split("\n");

  const emit = (text) => {
    const original = text.toLowerCase().replace(/[^\p{L}\p{N}\p{M}_\- ]/gu, "").replace(/ /g, "-");
    let result = original;
    while (occurrences.has(result)) {
      occurrences.set(original, (occurrences.get(original) ?? 0) + 1);
      result = `${original}-${occurrences.get(original)}`;
    }
    occurrences.set(result, 0);
    out.push(result);
  };

  // A Setext underline only ever follows ordinary paragraph text. Excluding
  // these shapes is what keeps a table delimiter row, a list, a quote or a
  // thematic break after a blank line from inventing a heading.
  const isParagraphText = (line) =>
    line !== undefined &&
    line.trim() !== "" &&
    !/^\s*(#|>|\||```|~~~)/.test(line) &&
    !/^\s*([-*+]\s|\d+[.)]\s)/.test(line) &&
    !/^ {0,3}(=+|-+)\s*$/.test(line);

  let inFence = false;
  let start = 0;
  // YAML front matter is not content; its closing `---` is not an underline.
  if (lines[0] !== undefined && /^---\s*$/.test(lines[0])) {
    const close = lines.findIndex((l, i) => i > 0 && /^---\s*$/.test(l));
    if (close > 0) start = close + 1;
  }

  for (let i = start; i < lines.length; i += 1) {
    const line = lines[i];
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const atx = /^#{1,6}\s+(.*?)\s*#*\s*$/.exec(line);
    if (atx) {
      emit(atx[1]);
      continue;
    }
    // Setext: this line is the underline, the one above is the heading text.
    if (/^ {0,3}(=+|-+)\s*$/.test(line) && isParagraphText(lines[i - 1])) {
      emit(lines[i - 1].trim());
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Partition
// ---------------------------------------------------------------------------

/**
 * Full-read files are spread by line count, heaviest first, onto the
 * lightest worker. Swept files are kept together by directory so a reader's
 * sweep has coherent context, and each directory lands whole on the lightest
 * worker. Deterministic for a given corpus.
 */
export function partition({ files, fullSet, lines }, workers) {
  const n = Math.max(1, workers | 0);
  const buckets = Array.from({ length: n }, () => ({ full: [], swept: [], load: 0 }));
  const lightest = () => buckets.reduce((a, b) => (b.load < a.load ? b : a), buckets[0]);

  const full = files.filter((f) => fullSet.has(f)).sort((a, b) => lines[b] - lines[a] || a.localeCompare(b));
  for (const f of full) {
    const b = lightest();
    b.full.push(f);
    b.load += lines[f];
  }

  const byDir = new Map();
  for (const f of files.filter((f) => !fullSet.has(f))) {
    const dir = posix.dirname(f);
    if (!byDir.has(dir)) byDir.set(dir, []);
    byDir.get(dir).push(f);
  }
  const dirs = [...byDir.entries()]
    .map(([dir, fs]) => ({ dir, fs: fs.sort(), weight: fs.reduce((s, f) => s + lines[f], 0) * SWEPT_WEIGHT }))
    .sort((a, b) => b.weight - a.weight || a.dir.localeCompare(b.dir));
  for (const d of dirs) {
    const b = lightest();
    b.swept.push(...d.fs);
    b.load += d.weight;
  }
  for (const b of buckets) {
    b.full.sort();
    b.swept.sort();
  }
  return buckets;
}

// ---------------------------------------------------------------------------
// Brief
// ---------------------------------------------------------------------------

export function composeBrief({ spec, prefix, worker, workers, bucket, lines, root }) {
  const home = toRepoPath(prefix, spec.home.split("#")[0]) + (spec.home.includes("#") ? "#" + spec.home.split("#")[1] : "");
  const shapes = spec.subShapes.map((s) => `| **${s.id}** | ${s.name} | \`${s.example}\` |`).join("\n");
  const exclusions = spec.notInClass.map((x, i) => `${i + 1}. ${x}`).join("\n");
  const fullList = bucket.full.map((f) => `- \`${f}\` (${lines[f]} lines) — read in full`).join("\n") || "- (none)";
  const sweptList = bucket.swept.map((f) => `- \`${f}\` (${lines[f]} lines) — swept`).join("\n") || "- (none)";
  return `# Cold-reader brief — prose sweep, worker ${worker} of ${workers}

You are a **cold reader**. You did not write the rule below or the change that
landed it, and you must not assume the files already reflect it. Repository
root: \`${root}\`. Do not edit any file. Report only.

## The rule being swept for

**${spec.rule.trim()}**

**Its home — the one authoritative statement:** \`${home}\`. Read it first. Your
question for every statement about the rule in any other file is structural:
**does it cite the home and agree with it?** A statement that is **uncited or
disagrees** is a hit. A restatement that cites the home and agrees is a
citation with context and is NOT a hit — do not return it. A file can be wrong
by omission — state a version of the rule correctly in its own words and never
name the home — and that is a hit with no wrong phrase in it. Grep cannot find
it; you can.

## Sub-shapes — hunt for ALL of them in EVERY file

The class takes several forms, and at least one carries none of the class's
vocabulary. Check every sentence against every row, not the row a section
seems to be about. If you see a coherent shape not listed, add it and say so.

| id | shape | example |
|---|---|---|
${shapes}

## Not in class — do NOT return these, but DO list what you declined

${exclusions}

A sentence that names the retired thing **as retired**, with what replaced it,
is history this repository keeps on purpose. It stays.

## Your files, and the mode for each

Two modes. **Read in full** means every line, once, end to end. **Swept** means
open it, read its headings and front-matter, search it for the vocabulary of
**every sub-shape's example above** — not the class's name, since at least one
shape carries none of it — read each hit in context, and escalate to a full
read on any hit. A swept clearance is weaker than a full read and is reported
as such. Declare which you used per file; a silent file and an unread file
must not look the same.

${fullList}
${sweptList}

## Report — Markdown, no preamble, in this order

1. **Inventory line:** \`OPENED: n / READ IN FULL: n / SWEPT: n\`, then one line
   per file: \`<path> (<lines> lines) — read in full | swept | escalated to full\`.
2. **Candidates.** For each: \`path:line\` — sub-shape id — the sentence
   **verbatim** — one line on why a reader of that file goes wrong — confidence
   \`high\` | \`medium\` | \`low\`. Keep the low ones; say why you doubt them.
3. **Declined candidates.** Every passage you seriously considered and did not
   return, each with the not-in-class number that resolved it. This section
   is mandatory: it is how the author audits whether the exclusions are
   swallowing real hits.
4. **A shape not on the list?** Name it with evidence, or say "none".
`;
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

export function plan({ root, spec, workers = DEFAULT_WORKERS, include = [] }) {
  const problems = validateSpec(spec);
  if (problems.length) throw new Error(`sweep-scope: spec refused:\n  - ${problems.join("\n  - ")}`);

  const n = assertWorkers(workers);
  const { prefix, files } = scopeFiles(root, { include });
  const [homePath, ...rest] = spec.home.split("#");
  const homeFile = toRepoPath(prefix, homePath);
  if (!files.includes(homeFile)) throw new Error(`sweep-scope: home ${homeFile} is not a tracked .md in scope`);
  if (rest.length) {
    const anchor = rest.join("#");
    const slugs = headingSlugs(readFileSync(join(root, homeFile), "utf8"));
    if (!anchor || !slugs.includes(anchor)) {
      throw new Error(`sweep-scope: home anchor "#${anchor}" names no heading in ${homeFile}; every brief would point readers at a section that does not exist`);
    }
  }

  const fullSet = new Set();
  for (const g of spec.readInFull ?? []) {
    // A glob is payload-relative like `home`, but an `--include`d file is
    // repo-relative and outside the payload; match both spellings so the
    // handbook can name a non-payload document for a full read.
    const asPayload = globToRegExp(toRepoPath(prefix, g));
    const asRepo = globToRegExp(g.replace(/^\.\//, ""));
    const hits = files.filter((f) => asPayload.test(f) || asRepo.test(f));
    if (hits.length === 0) throw new Error(`sweep-scope: readInFull glob "${g}" matches no file in scope`);
    hits.forEach((f) => fullSet.add(f));
  }
  fullSet.add(homeFile);

  const lines = Object.fromEntries(files.map((f) => [f, lineCount(root, f)]));
  const buckets = partition({ files, fullSet, lines }, n);
  const briefs = buckets.map((bucket, i) => composeBrief({ spec, prefix, worker: i + 1, workers: buckets.length, bucket, lines, root }));
  return { prefix, files, homeFile, fullSet: [...fullSet].sort(), lines, buckets, briefs };
}

/**
 * The out dir's `worker-N.md` files are this script's, and a rerun with fewer
 * workers must not leave the old tail behind: the skill dispatches one reader
 * per brief present, so a stale brief is a stale reader on a previous spec.
 */
export function clearBriefs(dir) {
  for (const f of readdirSync(dir)) if (/^worker-\d+\.md$/.test(f)) unlinkSync(join(dir, f));
}

const VALUE_FLAGS = new Set(["spec", "workers", "out", "include"]);
const BOOL_FLAGS = new Set(["print-scope"]);

/**
 * The documented flags and nothing else. A mistyped `--incldue` used to be
 * stored and ignored, and a trailing `--workers` read as absent -- both
 * produced an inventory that looked complete. An operator's own typo is the
 * threat model here, and refusing it by name is the whole defence.
 */
export function parseArgs(argv) {
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) throw new Error(`unexpected argument ${a}`);
    const key = a.slice(2);
    if (BOOL_FLAGS.has(key)) {
      flags.printScope = true;
      continue;
    }
    if (!VALUE_FLAGS.has(key)) throw new Error(`unknown flag --${key}`);
    const value = argv[i + 1];
    if (value === undefined || value.startsWith("--")) throw new Error(`--${key} needs a value`);
    i++;
    if (key === "include") (flags.include ??= []).push(value);
    else if (key in flags) throw new Error(`--${key} given twice`);
    else flags[key] = value;
  }
  return flags;
}

const USAGE = `usage:
  node scripts/sweep-scope.mjs --spec <path.json> [--workers N] [--include <glob>]... --out <dir>
  node scripts/sweep-scope.mjs --spec <path.json> [--include <glob>]... --print-scope`;

function main() {
  let flags;
  try {
    flags = parseArgs(process.argv.slice(2));
  } catch (e) {
    console.error(`sweep-scope: ${e.message}\n${USAGE}`);
    process.exitCode = 1;
    return;
  }
  if (!flags.spec || (!flags.out && !flags.printScope)) {
    console.error(USAGE);
    process.exitCode = 1;
    return;
  }
  // The script lives at <payload>/scripts/. In the handbook that payload is
  // core/ and the repo root is one level up; in a consumer they are the same.
  const here = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const root = payloadPrefix(resolve(here, "..")) ? resolve(here, "..") : here;
  let spec;
  try {
    spec = JSON.parse(readFileSync(resolve(flags.spec), "utf8"));
  } catch (e) {
    console.error(`sweep-scope: cannot read spec ${flags.spec}: ${e.message}`);
    process.exitCode = 1;
    return;
  }
  let result;
  try {
    result = plan({ root, spec, workers: flags.workers === undefined ? DEFAULT_WORKERS : flags.workers, include: flags.include ?? [] });
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }
  if (flags.printScope) {
    for (const f of result.files) console.log(`${result.fullSet.includes(f) ? "full " : "sweep"}  ${f}  (${result.lines[f]})`);
    console.log(`\n${result.files.length} file(s) in scope; ${result.fullSet.length} read in full; home ${result.homeFile}`);
    return;
  }
  const out = resolve(flags.out);
  mkdirSync(out, { recursive: true });
  clearBriefs(out);
  result.briefs.forEach((b, i) => writeFileSync(join(out, `worker-${i + 1}.md`), b));
  writeFileSync(
    join(out, "inventory.json"),
    JSON.stringify({ rule: spec.rule, home: result.homeFile, files: result.files, readInFull: result.fullSet, workers: result.buckets.map((b) => ({ full: b.full, swept: b.swept })) }, null, 2) + "\n",
  );
  const total = result.files.reduce((s, f) => s + result.lines[f], 0);
  console.log(`sweep-scope: ${result.files.length} file(s), ${total} lines in scope; ${result.fullSet.length} read in full; ${result.buckets.length} brief(s) written to ${out}`);
  result.buckets.forEach((b, i) => console.log(`  worker-${i + 1}: ${b.full.length} full (${b.full.reduce((s, f) => s + result.lines[f], 0)} lines), ${b.swept.length} swept`));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main();
