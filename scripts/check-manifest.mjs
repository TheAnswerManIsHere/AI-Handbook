#!/usr/bin/env node
/**
 * Manifest consistency check.
 *
 * The sync reads `sync-manifest.yml` and nothing else, so a payload file that
 * no group covers simply never travels. That failure is silent at exactly the
 * wrong moment: the handbook looks complete, the sync reports success, and a
 * consumer repo is quietly missing a rule. This check turns that into a red
 * build.
 *
 * It verifies five things:
 *   1. Every file under `core/` is covered by exactly one manifest group.
 *   2. Every path a group declares actually exists.
 *   3. No two groups write to the same destination — compared per RESOLVED
 *      FILE, not per declared root. Two groups can declare non-equal roots
 *      (`dest/` and `dest/x`) and still both write `dest/x`; comparing the
 *      roots returns "unique" while the sync silently overwrites one group's
 *      output by copy order.
 *   4. Every group declares a known mode/status, and every `staged` group
 *      names a blocker — a staged group without a stated reason is a parking
 *      lot, which is the thing `status` exists to prevent.
 *   5. No `ready` group requires a `staged` one. A file is not ready because
 *      of what it is; it is ready when everything it depends on has arrived.
 *      Shipping a contract whose procedure invokes a script the consumer will
 *      not receive hands that consumer instructions it cannot follow, which is
 *      worse than not shipping it — it looks governed without being governed.
 *
 * Deliberately dependency-free, matching the rest of the machinery. The YAML
 * reader below understands only the subset this manifest uses and THROWS on
 * anything else rather than guessing — a parser that silently mis-reads the
 * manifest would recreate the very failure this file exists to catch.
 */

import { readFileSync, readdirSync, statSync, existsSync } from "node:fs";
import { join, relative, dirname, posix } from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const MANIFEST = join(REPO_ROOT, "sync-manifest.yml");
const PAYLOAD_DIR = "core";

const MODES = new Set(["sync", "seed"]);
const STATUSES = new Set(["ready", "staged"]);

// An unknown key is a typo, and the expensive typo is a misspelled `requires`:
// the reader keeps the unknown property, `group.requires ?? []` reads the real
// one as absent, and a ready group passes the readiness gate with its
// dependency silently dropped. Groups legitimately omit `requires`, so absence
// cannot be the signal -- the spelling has to be.
const GROUP_KEYS = new Set(["id", "mode", "status", "requires", "blocker", "description", "paths"]);
const PATH_KEYS = new Set(["from", "to", "exclude"]);

/**
 * Minimal YAML reader for this manifest's shape: nested maps, lists of maps,
 * plain scalars, and folded (`>`) block scalars whose content we keep but
 * never interpret. Anything outside that vocabulary throws.
 */
export function parseManifestYaml(text) {
  const lines = [];
  text.split("\n").forEach((raw, i) => {
    const withoutComment = raw.replace(/(^|\s)#.*$/, "");
    if (withoutComment.trim() === "") return;
    const indent = withoutComment.length - withoutComment.trimStart().length;
    lines.push({ indent, text: withoutComment.trim(), lineNo: i + 1 });
  });

  let pos = 0;

  const scalar = (v, lineNo) => {
    // Flow sequences and mappings are valid YAML that this reader does not
    // model. Silently taking `[a, b]` as the string "[a, b]" is the worst
    // outcome: a caller iterating it gets one item per CHARACTER, which is
    // exactly what happened the first time a `requires: [machinery]` was
    // written here. Refuse it and name the block form instead.
    if (/^[[{]/.test(v)) {
      throw new Error(
        `manifest:${lineNo}: flow syntax (${v.slice(0, 20)}…) is not supported — write it as an indented block list`,
      );
    }
    if (v === "true") return true;
    if (v === "false") return false;
    if (/^-?\d+$/.test(v)) return Number(v);
    return v.replace(/^["'](.*)["']$/, "$1");
  };

  // Consumes an indented block following a `>` or `|` marker; content is kept
  // verbatim-ish but never parsed — it is prose.
  const readBlockScalar = (parentIndent) => {
    const parts = [];
    while (pos < lines.length && lines[pos].indent > parentIndent) {
      parts.push(lines[pos].text);
      pos++;
    }
    return parts.join(" ");
  };

  const parseBlock = (indent) => {
    // A list?
    if (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith("- ")) {
      const items = [];
      while (pos < lines.length && lines[pos].indent === indent && lines[pos].text.startsWith("- ")) {
        const { text, lineNo } = lines[pos];
        const rest = text.slice(2).trim();
        if (rest.includes(":") && !rest.startsWith("http")) {
          // `- key: value` starts a map whose first pair is on the dash line.
          const idx = rest.indexOf(":");
          const key = rest.slice(0, idx).trim();
          const value = rest.slice(idx + 1).trim();
          pos++;
          const map = {};
          if (value === ">" || value === "|") map[key] = readBlockScalar(indent);
          else if (value === "") map[key] = parseBlock(indent + 2);
          else map[key] = scalar(value, lineNo);
          // Remaining pairs of this item are indented past the dash. The key
          // written ON the dash line is already in `map`, and it is invisible
          // to the duplicate-key guard inside parseBlock -- which only sees the
          // indented block. So `- id: original` followed by an indented
          // `id: overwritten` used to merge here silently, last-one-wins, on
          // the one field that decides group identity. Compare before merging.
          while (pos < lines.length && lines[pos].indent > indent) {
            const nested = parseBlock(lines[pos].indent);
            if (nested === null || typeof nested !== "object" || Array.isArray(nested)) {
              throw new Error(`manifest:${lineNo}: list item's indented block is not a mapping`);
            }
            for (const key of Object.keys(nested)) {
              if (Object.prototype.hasOwnProperty.call(map, key)) {
                throw new Error(
                  `manifest:${lineNo}: duplicate key "${key}" in one list item — the manifest is ambiguous`,
                );
              }
            }
            Object.assign(map, nested);
          }
          items.push(map);
        } else if (rest === "") {
          throw new Error(`manifest:${lineNo}: bare list dash is not supported`);
        } else {
          items.push(scalar(rest));
          pos++;
        }
      }
      return items;
    }

    // Otherwise a map.
    const map = {};
    while (pos < lines.length && lines[pos].indent === indent) {
      const { text, lineNo } = lines[pos];
      if (text.startsWith("- ")) break;
      const idx = text.indexOf(":");
      if (idx === -1) throw new Error(`manifest:${lineNo}: expected "key: value", got ${JSON.stringify(text)}`);
      const key = text.slice(0, idx).trim();
      const value = text.slice(idx + 1).trim();
      // A repeated key silently overwriting the first is the duplicate-group-id
      // bug one level down, and quieter: `mode: sync` followed by `mode: seed`
      // would turn a handbook-owned file into a write-once seed with no gate
      // failing. A merge that leaves both lines is exactly how it happens.
      if (Object.prototype.hasOwnProperty.call(map, key)) {
        throw new Error(`manifest:${lineNo}: duplicate key "${key}" in one mapping — the manifest is ambiguous`);
      }
      pos++;
      if (value === ">" || value === "|") map[key] = readBlockScalar(indent);
      else if (value === "") map[key] = pos < lines.length && lines[pos].indent > indent ? parseBlock(lines[pos].indent) : null;
      else map[key] = scalar(value, lineNo);
    }
    return map;
  };

  const doc = parseBlock(0);
  if (pos !== lines.length) {
    throw new Error(`manifest:${lines[pos].lineNo}: unexpected indentation; this reader supports only the manifest's documented subset`);
  }
  return doc;
}

/** Every file under a directory, repo-relative, dotfiles included. */
export function walk(dir, root) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full, root));
    else out.push(relative(root, full));
  }
  return out;
}

export function check(manifest, payloadFiles, exists) {
  const problems = [];
  const covered = new Map(); // payload path -> group id
  const destinations = new Map(); // RESOLVED destination file -> { src, group }
  const groupsById = new Map();

  for (const group of manifest.groups ?? []) {
    if (!group.id) continue;
    // Duplicate ids are rejected rather than last-one-wins. Silently keeping
    // the last record would let a manifest pass with one `dup` staged and
    // another ready, a ready group requiring `dup`, and the same payload
    // routed twice -- with readiness decided by declaration order instead of
    // by the rule. Every downstream check reads this map, so an ambiguous
    // manifest has to fail here or it corrupts all of them.
    if (groupsById.has(group.id)) {
      problems.push(`duplicate group id "${group.id}" — ids must be unique; the manifest is ambiguous`);
      continue;
    }
    groupsById.set(group.id, group);
  }

  for (const group of manifest.groups ?? []) {
    if (!group.id) problems.push(`a group is missing an "id"`);
    for (const key of Object.keys(group)) {
      if (!GROUP_KEYS.has(key)) {
        problems.push(
          `${group.id}: unknown group key "${key}" — known keys are ${[...GROUP_KEYS].join(", ")}; ` +
            `a misspelled key is silently ignored, which is how a dependency goes missing`,
        );
      }
    }
    if (!MODES.has(group.mode)) problems.push(`${group.id}: mode must be one of ${[...MODES].join("/")}, got "${group.mode}"`);
    if (!STATUSES.has(group.status)) problems.push(`${group.id}: status must be one of ${[...STATUSES].join("/")}, got "${group.status}"`);
    if (group.status === "staged" && !group.blocker) {
      problems.push(`${group.id}: a staged group must name its blocker — what has to land before it flips to ready`);
    }
    // Unstaging is "clear the blocker AND flip the status". A change that does
    // only the second would ship a group whose own declaration still says a
    // named problem must be solved first — the claim and the state disagreeing,
    // with the state winning silently.
    if (group.status === "ready" && group.blocker) {
      problems.push(`${group.id}: a ready group must not still carry a blocker — clear it in the same change that flips the status`);
    }
    if (!group.paths || group.paths.length === 0) {
      problems.push(`${group.id}: declares no paths, so it delivers nothing — a group another group can require while supplying no files`);
    }

    // Counted AFTER exclusions, because "matches files" and "delivers files"
    // are different claims. A group whose exclude list covers every matched
    // leaf passes the per-path check above while shipping nothing -- and an
    // empty group can still be marked ready and satisfy another group's
    // `requires`, which is the readiness gate certifying a dependency that
    // delivers no file.
    let delivered = 0;

    for (const p of group.paths ?? []) {
      for (const key of Object.keys(p)) {
        if (!PATH_KEYS.has(key)) {
          problems.push(
            `${group.id}: unknown path key "${key}" — known keys are ${[...PATH_KEYS].join(", ")}`,
          );
        }
      }
      if (!p.from || !p.to) {
        problems.push(`${group.id}: every path needs "from" and "to"`);
        continue;
      }
      if (!p.from.startsWith(`${PAYLOAD_DIR}/`)) {
        problems.push(`${group.id}: "from" must live under ${PAYLOAD_DIR}/, got "${p.from}"`);
        continue;
      }
      if (!exists(p.from)) {
        problems.push(`${group.id}: declared path does not exist: ${p.from}`);
        continue;
      }

      const isDir = p.from.endsWith("/");
      const excluded = new Set(p.exclude ?? []);
      const matched = isDir
        ? payloadFiles.filter((f) => f.startsWith(p.from))
        : payloadFiles.filter((f) => f === p.from);

      if (matched.length === 0) problems.push(`${group.id}: "${p.from}" matches no files`);

      for (const f of matched) {
        const leaf = f.slice(p.from.length);
        if (excluded.has(leaf)) continue;
        delivered++;
        const prior = covered.get(f);
        if (prior && prior !== group.id) problems.push(`${f} is claimed by two groups: ${prior} and ${group.id}`);
        covered.set(f, group.id);

        // Resolve where this specific file actually lands. For a directory
        // mapping the leaf is appended; for a file mapping `to` IS the
        // destination. Comparing these, rather than the declared roots, is
        // what makes the uniqueness claim true.
        // Normalize before comparing: `dest/x.md` and `dest/sub/../x.md` are
        // the same file on disk, so comparing raw strings would let the
        // uniqueness claim be bypassed by a path spelling. posix.normalize is
        // used rather than the platform default so the result does not depend
        // on which OS runs the check.
        const dest = posix.normalize(isDir ? p.to + leaf : p.to);
        // `..` is its own normal form: posix.normalize("..") and
        // posix.normalize("a/../..") both return exactly "..", which the
        // "../" prefix test does not match. Escaping means the normalized
        // path LEADS with a `..` segment, and that segment is unterminated
        // when it is the whole string -- so the bare case needs naming.
        if (dest === ".." || dest.startsWith("../") || dest.startsWith("/")) {
          problems.push(`${group.id}: destination "${dest}" escapes the consumer repo root`);
          continue;
        }
        // Keyed on the SOURCE, not the group. Keying on the group id made a
        // collision between two path entries of the SAME group compare equal
        // to itself and vanish -- and a group with several path entries is the
        // normal case, so the gap was in the common path, not an edge.
        const priorDest = destinations.get(dest);
        if (priorDest && priorDest.src !== f) {
          const where =
            priorDest.group === group.id
              ? `twice within group "${group.id}"`
              : `by two groups (${priorDest.group} and ${group.id})`;
          problems.push(`destination "${dest}" is written ${where}: ${priorDest.src} and ${f}`);
        }
        destinations.set(dest, { src: f, group: group.id });
      }
    }

    if ((group.paths ?? []).length > 0 && delivered === 0) {
      problems.push(
        `${group.id}: every file its paths match is excluded, so it delivers nothing — ` +
          `a group another group can require while supplying no files`,
      );
    }
  }

  // Readiness is transitive. A group is only as ready as the groups it needs.
  for (const group of manifest.groups ?? []) {
    for (const req of group.requires ?? []) {
      const dep = groupsById.get(req);
      if (!dep) {
        problems.push(`${group.id}: requires "${req}", which is not a group in this manifest`);
        continue;
      }
      if (group.status === "ready" && dep.status !== "ready") {
        problems.push(
          `${group.id} is ready but requires "${req}", which is ${dep.status} — ` +
            `a consumer would receive instructions referring to files it will not get`,
        );
      }
    }
  }

  for (const f of payloadFiles) {
    if (!covered.has(f)) problems.push(`payload file is in no manifest group, so it will never sync: ${f}`);
  }

  return problems;
}

function main() {
  if (!existsSync(MANIFEST)) {
    console.error("check-manifest: sync-manifest.yml not found");
    process.exit(1);
  }
  const manifest = parseManifestYaml(readFileSync(MANIFEST, "utf8"));
  const payloadRoot = join(REPO_ROOT, PAYLOAD_DIR);
  if (!existsSync(payloadRoot)) {
    console.error(`check-manifest: ${PAYLOAD_DIR}/ not found`);
    process.exit(1);
  }
  const payloadFiles = walk(payloadRoot, REPO_ROOT).map((f) => f.split("\\").join("/"));
  const problems = check(manifest, payloadFiles, (p) => existsSync(join(REPO_ROOT, p)));

  if (problems.length) {
    console.error(`check-manifest: ${problems.length} problem(s)\n`);
    for (const p of problems) console.error(`  - ${p}`);
    process.exit(1);
  }

  const ready = (manifest.groups ?? []).filter((g) => g.status === "ready");
  const staged = (manifest.groups ?? []).filter((g) => g.status === "staged");
  console.log(
    `check-manifest: OK — ${payloadFiles.length} payload files across ` +
      `${manifest.groups.length} groups (${ready.length} ready, ${staged.length} staged)`,
  );
  for (const g of staged) console.log(`  staged: ${g.id}`);
}

if (process.argv[1] && import.meta.url === `file://${process.argv[1]}`) main();
