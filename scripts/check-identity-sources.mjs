#!/usr/bin/env node
/**
 * Every place a repository identity enters a decision, classified by WHAT IT
 * READS -- not by how much to trust it.
 *
 * WHY THIS EXISTS. Across nine review rounds on PR #7 I wrote six confident
 * claims about where identity comes from, and review disproved all six. The
 * first version of this check answered that with a trust hierarchy -- base
 * commit over durable ref over working tree, each read graded -- and round
 * ten disproved that too: a gitignored receipt graded "durable", an env-var
 * read the scanner could not see, a "0 working-tree" summary presented as a
 * security property. The hierarchy was the mistake. It graded reads against
 * an adversary who can edit this checkout, and that adversary is the person
 * running the script. (`.agents/memory/machinery-threat-model-is-my-own-mistakes.md`.)
 *
 * WHAT IT DOES NOW. It enumerates every touchpoint and requires a human to
 * say what kind of thing each one reads, so that "identity comes from ONE
 * config read, is stamped into every artifact, and is compared on every
 * consume" is a claim someone has to answer for line by line -- and so a new
 * touchpoint fails the build until they do, and a vanished one fails too.
 * It is the `mentions:` design from sync-manifest.yml: the tool cannot judge
 * a read, so it refuses to guess and makes a human say which it is.
 *
 * WHAT IT CANNOT DO. It keys on the line of code, so a touchpoint whose
 * behaviour changes while its text stays the same does not fail. It matches
 * the spellings listed in PATTERNS, so an identity arriving some other way is
 * invisible to it. Neither is a trust boundary and neither is claimed as one.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = path.join(ROOT, "core", "scripts");
const CLASSIFICATION = path.join(ROOT, "identity-sources.yml");

/** What a touchpoint reads. Anything else must justify itself. */
const SOURCES = new Set([
  "config", // .agents/machinery.json, through the one reader
  "artifact", // a receipt, budget or record the machinery itself wrote
  "github", // GitHub's own word: a captured snapshot, or an Actions env var
  "tool-input", // the repository the outgoing call itself names
  "message", // appears in text a human reads; decides nothing
]);

/** An identity touchpoint: producing one, or reading one off an artifact. */
const PATTERNS = [
  /\brepoSlug\s*\(/,
  /\bmachineryConfig\s*\(/,
  /\blocalConfig\s*\(/,
  /\.repo\b/,
  /\bGITHUB_REPOSITORY\b/,
  // The identifier, not the English word: an assignment or an interpolation.
  /\brepository\s*=/,
  /\$\{repository\}/,
];

const isComment = (line) => /^\s*(\/\/|\*|\/\*)/.test(line);

/** The nearest enclosing named function, so a key survives edits above it. */
function enclosing(lines, i) {
  for (let j = i; j >= 0; j--) {
    const m =
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z0-9_]+)/.exec(lines[j]) ??
      /^(?:export\s+)?const\s+([A-Za-z0-9_]+)\s*=/.exec(lines[j]);
    if (m) return m[1];
  }
  return "(top level)";
}

export function scan(dir = PAYLOAD) {
  const found = [];
  for (const name of fs.readdirSync(dir).sort()) {
    if (!name.endsWith(".mjs")) continue;
    const lines = fs.readFileSync(path.join(dir, name), "utf8").split("\n");
    lines.forEach((line, i) => {
      if (isComment(line)) return;
      if (!PATTERNS.some((p) => p.test(line))) return;
      found.push({ file: name, fn: enclosing(lines, i), text: line.trim() });
    });
  }
  return found;
}

/** A key that is stable under edits but changes when the code does. */
export const keyOf = (hit) => `${hit.file} :: ${hit.fn} :: ${hit.text}`;

/**
 * Minimal YAML read: a list of `- key:` blocks with flat string fields.
 *
 * KEYS ARE JSON-ENCODED, which is not decoration. A touchpoint key quotes a
 * line of source, and those lines carry `:: `, `"` and `'` -- so an unquoted
 * scalar is ambiguous to a real YAML parser even though this reader would
 * accept it. Emitting and requiring the double-quoted form keeps this file a
 * strict subset of valid YAML (double-quoted scalars use JSON escapes), and
 * makes the line the failure message prints literally pasteable.
 */
export function parseClassification(text) {
  const out = new Map();
  let current = null;
  let field = null;
  for (const raw of text.split("\n")) {
    if (/^\s*#/.test(raw) || raw.trim() === "") continue;
    const entry = /^- key: (.*)$/.exec(raw);
    if (entry) {
      const literal = entry[1].trim();
      let key;
      try {
        key = JSON.parse(literal);
      } catch {
        throw new Error(
          `identity-sources.yml: key must be a double-quoted (JSON-escaped) string, got: ${literal}`,
        );
      }
      current = { key, source: null, why: "" };
      // A repeated key would silently replace the earlier entry, and the check
      // would pass on whichever came last -- the human-edit mistake this file
      // exists to catch, hidden by the file's own reader. (Codex, PR #7 round 12.)
      if (out.has(key)) throw new Error(`identity-sources.yml: duplicate key ${JSON.stringify(key)}`);
      out.set(current.key, current);
      field = null;
      continue;
    }
    const kv = /^ {2}([a-z]+): ?(.*)$/.exec(raw);
    if (kv && current) {
      field = kv[1];
      const value = kv[2].trim();
      // A block scalar (`>`, `>-`, `|`, `|-`) opens an empty field that the
      // indented lines below it fill in. Handled for EVERY field, not just
      // `why`: the earlier version special-cased one, so `decides: >-` parsed
      // as the literal string ">-" and its text was silently dropped -- which
      // would have satisfied the one rule this whole check exists to enforce.
      current[field] = /^[>|]-?$/.test(value) ? "" : value;
      continue;
    }
    if (current && field) current[field] += `${raw.trim()} `;
  }
  return out;
}

export function check(hits, classified) {
  const problems = [];
  const seen = new Set();
  for (const hit of hits) {
    const key = keyOf(hit);
    seen.add(key);
    const entry = classified.get(key);
    if (!entry) {
      problems.push(
        `UNCLASSIFIED identity touchpoint -- say where it comes from in identity-sources.yml:\n` +
          `    - key: ${JSON.stringify(key)}`,
      );
      continue;
    }
    if (!SOURCES.has(entry.source?.trim())) {
      problems.push(`${key}\n    source "${entry.source}" is not one of: ${[...SOURCES].join(", ")}`);
      continue;
    }
    if (!entry.why || entry.why.trim().length < 12) {
      problems.push(`${key}\n    needs a \`why\` saying how this source is trusted`);
    }
  }
  for (const key of classified.keys()) {
    if (!seen.has(key)) {
      problems.push(`STALE classification -- this touchpoint no longer exists:\n    - key: ${JSON.stringify(key)}`);
    }
  }
  return problems;
}

function main() {
  const hits = scan();
  let classified;
  try {
    classified = parseClassification(fs.readFileSync(CLASSIFICATION, "utf8"));
  } catch (err) {
    if (err.code !== "ENOENT") throw err;
    classified = new Map();
  }
  const problems = check(hits, classified);
  if (problems.length) {
    process.stdout.write(`check-identity-sources: ${problems.length} problem(s)\n\n`);
    for (const p of problems) process.stdout.write(`  - ${p}\n\n`);
    return 1;
  }
  const bySource = {};
  for (const hit of hits) {
    const s = classified.get(keyOf(hit)).source;
    bySource[s] = (bySource[s] ?? 0) + 1;
  }
  process.stdout.write(
    `check-identity-sources: OK -- ${hits.length} identity touchpoints, all classified\n` +
      Object.entries(bySource)
        .sort()
        .map(([s, n]) => `  ${String(n).padStart(3)}  ${s}\n`)
        .join(""),
  );
  return 0;
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) process.exit(main());
