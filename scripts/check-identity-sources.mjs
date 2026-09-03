#!/usr/bin/env node
/**
 * Every place a repository identity enters a decision, classified.
 *
 * WHY THIS EXISTS. Across nine review rounds on PR #7 I wrote five confident
 * claims about where identity comes from -- "compared on both sides", "one
 * working-tree read, fail-closed", "the validators have something to check" --
 * and Codex disproved all five. The claims were not careless; two of them I
 * measured before publishing. They were narrower than the sentences I hung on
 * them, and prose has no way to say so.
 *
 * So the claim stops being prose. This enumerates every identity touchpoint in
 * the payload and requires each to be classified in `identity-sources.yml`
 * with its SOURCE and, for anything read from the working tree, an explicit
 * statement of what it can decide. A new touchpoint fails the build until
 * someone answers the question; a classified one that disappears fails too, so
 * the file cannot rot into a description of code that no longer exists.
 *
 * This is the `mentions:` design from sync-manifest.yml applied to identity,
 * for the same reason it works there: the tool cannot tell a safe read from an
 * unsafe one, so it refuses to guess and makes a human say which it is.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const PAYLOAD = path.join(ROOT, "core", "scripts");
const CLASSIFICATION = path.join(ROOT, "identity-sources.yml");

/** The trusted sources. Anything else must justify itself. */
const SOURCES = new Set([
  "base-commit", // read at the commit the PR merges into -- not PR-controlled
  "durable-ref", // read out of the branch's committed upstream ref
  "durable-receipt", // a receipt read out of that same ref
  "tool-input", // the repository the outgoing call itself names
  "snapshot", // GitHub's own word, captured with the evidence
  "argument", // supplied by the caller, which one of the above must have sourced
  "working-tree", // MUTABLE. Requires `decides:` to be explicit.
  "message-only", // appears in text a human reads; decides nothing
]);

/** An identity touchpoint: producing one, or reading one off an artifact. */
const PATTERNS = [
  /\brepoSlug\s*\(/,
  /\bmachineryConfig\s*\(/,
  /\bmachineryConfigAt\s*\(/,
  /\.repo\b/,
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
      current = { key, source: null, decides: null, why: "" };
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
    // The rule the five disproved claims were all about: a value read from the
    // working tree is MUTABLE, so what it may decide has to be stated, not
    // assumed. "none" is the only answer that needs no further argument.
    if (entry.source?.trim() === "working-tree" && !entry.decides?.trim()) {
      problems.push(
        `${key}\n    reads the WORKING TREE, so it must state \`decides:\` -- what a wrong value here can ` +
          `cause. Use "none" only when a wrong value can solely refuse.`,
      );
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
