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
const GROUP_KEYS = new Set(["id", "mode", "status", "requires", "mentions", "blocker", "description", "paths"]);
const MENTION_KEYS = new Set(["group", "ref", "from", "why"]);
const PATH_KEYS = new Set(["from", "to", "exclude"]);
const CONSUMER_KEYS = new Set(["repo", "enrolled"]);

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

  // The consumers list decides who the sync targets, and until now nothing
  // read it. A misspelled `enroled: true` leaves `enrolled` undefined, the
  // sync skips that repo, and the build stays green while every future
  // consumer pull request silently stops being opened -- a failure with no
  // symptom, which is the exact class this whole file exists to make loud.
  const consumers = manifest.consumers;
  if (!Array.isArray(consumers) || consumers.length === 0) {
    problems.push(`the manifest declares no consumers — the sync would have nowhere to deliver`);
  } else {
    const seenRepos = new Set();
    for (const c of consumers) {
      if (c === null || typeof c !== "object" || Array.isArray(c)) {
        problems.push(`a consumer entry is not a mapping: ${JSON.stringify(c)}`);
        continue;
      }
      for (const key of Object.keys(c)) {
        if (!CONSUMER_KEYS.has(key)) {
          problems.push(
            `consumer "${c.repo ?? "(unnamed)"}": unknown key "${key}" — known keys are ${[...CONSUMER_KEYS].join(", ")}; ` +
              `a misspelled "enrolled" reads as absent and silently un-targets the repo`,
          );
        }
      }
      if (typeof c.repo !== "string" || !/^[^/\s]+\/[^/\s]+$/.test(c.repo)) {
        problems.push(`a consumer needs a "repo" of the form owner/name, got ${JSON.stringify(c.repo)}`);
        continue;
      }
      if (typeof c.enrolled !== "boolean") {
        problems.push(`consumer "${c.repo}": "enrolled" must be true or false, got ${JSON.stringify(c.enrolled)}`);
      }
      // GitHub slugs are case-insensitive, and the payload already compares
      // them that way (pr-ready.mjs lowercases both sides before matching a
      // head repo to a receipt). Comparing raw spelling here would let
      // "Owner/Repo" and "owner/repo" pass as distinct entries carrying
      // different `enrolled` values for one repository.
      const slug = c.repo.toLowerCase();
      if (seenRepos.has(slug)) {
        problems.push(
          `consumer "${c.repo}" is listed twice (case-insensitively) — which entry decides enrollment is ambiguous`,
        );
      }
      seenRepos.add(slug);
    }
  }
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
    for (const m of group.mentions ?? []) {
      if (m === null || typeof m !== "object" || Array.isArray(m)) {
        problems.push(`${group.id}: a mentions entry is not a mapping: ${JSON.stringify(m)}`);
        continue;
      }
      for (const key of Object.keys(m)) {
        if (!MENTION_KEYS.has(key)) {
          problems.push(`${group.id}: unknown mentions key "${key}" — known keys are ${[...MENTION_KEYS].join(", ")}`);
        }
      }
      if (typeof m.group !== "string") {
        problems.push(`${group.id}: every mentions entry needs a "group"`);
        continue;
      }
      // Scoped to the referenced FILE, not the group pair. A group-wide
      // exemption suppresses every reference between two groups, including a
      // real one added later -- so the classification would silently widen
      // itself as the payload changed.
      if (typeof m.ref !== "string" || !m.ref.startsWith(`${PAYLOAD_DIR}/`)) {
        problems.push(
          `${group.id}: mentions "${m.group}" without a "ref" naming the payload file being referenced ` +
            `— a group-wide exemption would also suppress a real reference added later`,
        );
        continue;
      }
      // `from` is mandatory, not optional. Omitting it exempted every file in
      // the source group, so an entry whose reason named one file silently
      // covered the others -- the same widening the `ref` scoping was added to
      // stop, one level in.
      if (typeof m.from !== "string" || !m.from.startsWith(`${PAYLOAD_DIR}/`)) {
        problems.push(
          `${group.id}: mentions "${m.group}" without a "from" naming the payload file doing the referencing ` +
            `— without it the exemption covers every other file in this group too`,
        );
      }
      // The reason is mandatory and is the whole point. An exemption without
      // one is indistinguishable from a missed dependency, which is the
      // failure this file exists to make loud.
      if (typeof m.why !== "string" || m.why.trim().length === 0) {
        problems.push(
          `${group.id}: mentions "${m.group}" without saying why — an exemption with no stated reason ` +
            `cannot be told apart from a dependency someone forgot to declare`,
        );
      }
      if ((group.requires ?? []).includes(m.group)) {
        problems.push(
          `${group.id}: "${m.group}" is in both requires and mentions — it is either a dependency or it is not`,
        );
      }
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

  for (const group of manifest.groups ?? []) {
    for (const m of group.mentions ?? []) {
      if (typeof m?.group === "string" && !groupsById.has(m.group)) {
        problems.push(`${group.id}: mentions "${m.group}", which is not a group in this manifest`);
      }
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

/**
 * Which group delivers each payload file, by the manifest's own routing.
 * Shared by the coverage check and the dependency derivation so the two can
 * never disagree about ownership.
 */
export function ownersOf(manifest, payloadFiles) {
  const owner = new Map();
  for (const group of manifest.groups ?? []) {
    for (const p of group.paths ?? []) {
      if (!p.from || !p.to) continue;
      const isDir = p.from.endsWith("/");
      const excluded = new Set(p.exclude ?? []);
      for (const f of payloadFiles) {
        if (isDir ? !f.startsWith(p.from) : f !== p.from) continue;
        if (excluded.has(f.slice(p.from.length))) continue;
        if (!owner.has(f)) owner.set(f, group.id);
      }
    }
  }
  return owner;
}

/**
 * Every string by which `target` could legitimately be referenced from `source`.
 *
 * This inverts the earlier design, and the inversion is the point. Extracting
 * path-shaped tokens from prose and then resolving them requires a regex, a
 * regex requires an alphabet, and an alphabet is an enumeration -- so two
 * consecutive review rounds each found something the enumeration omitted:
 * first the file extensions (.py, .ts, .html, .dot, .gitignore, and three
 * files with no extension), then the filename characters themselves (`c++.md`
 * extracts as `.md`). Deriving the alphabet from the payload too would just
 * move the enumeration again.
 *
 * So: do not extract. The payload IS the search set. For each candidate target
 * compute the strings that would actually name it, and look for those. Nothing
 * is enumerated, because every form is computed from the two real paths.
 */
export function referenceFormsFor(sourceFile, targetFile, destOf, uniqueSuffixes) {
  const forms = new Set();
  const rel = posix.relative(posix.dirname(sourceFile), targetFile);
  forms.add(rel);                       // ../b/two.md
  if (!rel.startsWith(".")) forms.add(`./${rel}`); // ./two.md
  const dest = destOf.get(targetFile);
  if (dest) {
    forms.add(dest);                    // docs/ai-context/working-modes.md
    for (const suffix of uniqueSuffixes.get(targetFile) ?? []) forms.add(suffix);
  }
  forms.delete("");
  return [...forms];
}

/**
 * Suffixes of a destination that identify exactly ONE payload file.
 *
 * A templated reference names where a file lands without knowing the root --
 * `{baseDir}/skills/semgrep/references/scanner-task-prompt.md` -- so the
 * resolvable forms are the destination's trailing segments. Only the
 * unambiguous ones count: "README.md" is a suffix of several destinations and
 * identifies none of them, so it is not a reference to any.
 */
export function uniqueSuffixesOf(destOf) {
  const bySuffix = new Map(); // suffix -> Set of payload files
  for (const [file, dest] of destOf) {
    const parts = dest.split("/");
    for (let i = parts.length - 1; i >= 0; i--) {
      const suffix = parts.slice(i).join("/");
      if (!bySuffix.has(suffix)) bySuffix.set(suffix, new Set());
      bySuffix.get(suffix).add(file);
    }
  }
  const out = new Map();
  for (const [suffix, files] of bySuffix) {
    if (files.size !== 1) continue; // ambiguous: identifies no single file
    const [file] = files;
    if (!out.has(file)) out.set(file, []);
    out.get(file).push(suffix);
  }
  return out;
}

/**
 * Does `text` reference `form` as a path, rather than merely containing those
 * characters inside a longer one?
 *
 * The boundary test is on what surrounds the match, so it needs no alphabet of
 * its own: a path character before the match means this is a different, longer
 * path (`xtwo.md` is not `two.md`), and a path character after means the same
 * (`two.md.bak`). A URL is excluded the same way it always was -- by what
 * precedes it.
 */
export function mentionsForm(text, form) {
  let from = 0;
  for (;;) {
    const i = text.indexOf(form, from);
    if (i === -1) return false;
    from = i + 1;
    const before = i === 0 ? "" : text[i - 1];
    const after = text[i + form.length] ?? "";
    if (/[A-Za-z0-9_+~-]/.test(before)) continue; // inside a longer name
    if (before === "/" && !form.startsWith("/")) {
      // A slash before usually means a longer path (or a URL). The exception
      // is a TEMPLATE segment standing in for a root the referring file does
      // not know -- `{baseDir}/skills/x.md` -- which is a real reference and
      // was the form that survived eleven review rounds.
      if (!/\}$/.test(text.slice(0, i - 1))) continue;
    }
    if (/[A-Za-z0-9_+~/-]/.test(after)) continue; // a longer name or deeper path
    // A dot after is sentence punctuation ("covered by .gitignore.") unless a
    // word character follows it, which makes it a different file ("two.md.bak").
    if (after === "." && /[A-Za-z0-9]/.test(text[i + form.length + 1] ?? "")) continue;
    return true;
  }
}

/**
 * Derive the dependency graph from what the files actually reference, and
 * compare it against what the manifest declares.
 *
 * Three separate review rounds corrected this graph by hand and a fourth
 * would have found more: rounds 5 and 7 between them named seven edges, and
 * running this check finds ones no round did. A hand-maintained `requires`
 * list is a sweep, and the lesson this repo has now paid for repeatedly is
 * that sweeps do not converge -- the file links are the ground truth, so read
 * them instead of re-reading the manifest.
 *
 * Transitive edges satisfy the requirement: if A requires B and B requires C,
 * A's reference to a C file is already covered, because a group only goes
 * ready when everything it requires is ready and that property is inductive.
 */
export function checkDerivedDependencies(manifest, payloadFiles, readFile) {
  const problems = [];
  const owner = ownersOf(manifest, payloadFiles);

  // Where each payload file LANDS in a consumer. A file that references
  // another by its consumer path -- which is what a templated or prose
  // reference does -- can only be resolved against this, not against the
  // payload layout.
  const byDestination = new Map(); // consumer path -> payload path
  for (const group of manifest.groups ?? []) {
    for (const p of group.paths ?? []) {
      if (!p.from || !p.to) continue;
      const isDir = p.from.endsWith("/");
      const excluded = new Set(p.exclude ?? []);
      for (const f of payloadFiles) {
        if (isDir ? !f.startsWith(p.from) : f !== p.from) continue;
        const leaf = f.slice(p.from.length);
        if (excluded.has(leaf)) continue;
        const dest = posix.normalize(isDir ? p.to + leaf : p.to);
        if (!byDestination.has(dest)) byDestination.set(dest, f);
      }
    }
  }
  const declared = new Map((manifest.groups ?? []).map((g) => [g.id, g.requires ?? []]));

  const closureOf = (id) => {
    const out = new Set();
    const stack = [...(declared.get(id) ?? [])];
    while (stack.length) {
      const next = stack.pop();
      if (out.has(next)) continue; // cycles are legitimate here and must not hang
      out.add(next);
      stack.push(...(declared.get(next) ?? []));
    }
    return out;
  };

  // Groups this one references WITHOUT depending on: prose that describes
  // another group's files rather than instructing an agent to read them.
  //
  // This distinction is semantic and no extractor can make it. "The refusal
  // lives in `guard-decision.mjs`" and "Use `{baseDir}/skills/x.md` for the
  // full method" are the same shape and only one is a dependency -- the
  // instruction-vs-evidence test this repo already runs on payload, applied to
  // references instead of files. Declaring every syntactic match instead
  // collapses ten of twelve groups into one cycle, which is measured, not
  // feared: it would end the staging design outright.
  //
  // Unlike the syntax list this check replaced, this one is BOUNDED -- by the
  // corpus, not by how many ways a path can be written -- it shrinks as payload
  // is rewritten, every entry must say why, and nothing can be missed, because
  // an unclassified reference still fails the build.
  const mentionsOf = new Map((manifest.groups ?? []).map((g) => [g.id, g.mentions ?? []]));

  // A static import is never exemptible. Everything else about a reference is
  // ambiguous -- a backticked path reads the same whether it instructs or
  // describes -- but `import x from "./y.mjs"` is unambiguous: the module
  // loads at instantiation or the file does not run. This closes the case a
  // scoped exemption alone cannot: a comment about `guard-decision.mjs` is
  // classified as evidence, and then a real import of that same file is added
  // to that same source file.
  const importsIn = (file, text, form) => {
    if (!/\.[cm]?js$/.test(file)) return false;
    const esc = form.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // A comment may legally sit between `from` and the specifier, so the gap
    // is "whitespace and comments" rather than `\s*`. An import the pattern
    // cannot see would be silently exemptible, against the stated invariant.
    const GAP = String.raw`(?:\s|/\*[\s\S]*?\*/|//[^\n]*\n)*`;
    return new RegExp(String.raw`(?:from|import)${GAP}(["'])${esc}\1`).test(text);
  };

  const exempt = (srcGroup, srcFile, text, form, targetFile) =>
    (mentionsOf.get(srcGroup) ?? []).some(
      (m) =>
        m?.ref === targetFile &&
        // The named group must actually own the referenced file. Without this
        // a typo in `group` grants an exemption for a file that group does not
        // deliver, suppressing a real edge while every other check passes.
        m.group === owner.get(targetFile) &&
        m.from === srcFile &&
        !importsIn(srcFile, text, form),
    );

  const missing = new Map(); // "src\u0000dst" -> evidence

  const destOf = new Map([...byDestination].map(([dest, file]) => [file, dest]));
  const uniqueSuffixes = uniqueSuffixesOf(destOf);

  // The third identification mechanism: some payload is named rather than
  // pathed. A skill saying "spawn the semgrep-scanner agent" depends on the
  // group delivering that agent, and no path form appears anywhere. The name
  // set is derived from the payload, so adding an agent extends the check.
  const namedEntities = new Map(); // bare name -> owning group
  for (const [file, group] of owner) {
    const m = /(?:^|\/)\.claude\/agents\/([^/]+)\.md$/.exec(file);
    if (m) namedEntities.set(m[1], group);
  }

  for (const file of payloadFiles) {
    const src = owner.get(file);
    if (!src) continue;
    let text;
    try {
      text = readFile(file);
    } catch {
      continue; // unreadable is the coverage check's business, not this one
    }

    for (const [target, dst] of owner) {
      if (dst === src) continue;
      if (closureOf(src).has(dst)) continue;
      const forms = referenceFormsFor(file, target, destOf, uniqueSuffixes);
      const form = forms.find((f) => mentionsForm(text, f));
      if (!form) continue;
      if (exempt(src, file, text, form, target)) continue;
      // Keyed per REFERENCE, not per group pair. Since an exemption is scoped
      // to one source file, each reference needs its own classification -- and
      // reporting one per pair meant a maintainer fixed one and got the next,
      // one round-trip at a time.
      missing.set(`${file}\u0000${target}`, { src, dst, evidence: `${file} names "${form}"` });
    }

    for (const [name, dst] of namedEntities) {
      if (dst === src) continue;
      // Word-bounded, so `semgrep-scanner` in prose or a `subagent_type:` line
      // matches while a longer identifier containing it does not.
      if (!new RegExp(`(?<![\\w-])${name.replace(/[.*+?^$()|[\]\\]/g, "\\$&")}(?![\\w-])`).test(text)) continue;
      if (closureOf(src).has(dst)) continue;
      const agentFile = [...owner].find(([f, g]) => g === dst && f.endsWith(`/${name}.md`))?.[0];
      if (agentFile && exempt(src, file, text, name, agentFile)) continue;
      missing.set(`${file}\u0000${agentFile ?? name}`, { src, dst, evidence: `${file} names "${name}"` });
    }
  }

  for (const { src, dst, evidence } of missing.values()) {
    problems.push(
      `${src} references files delivered by "${dst}" but neither requires nor classifies it — ${evidence}. ` +
        `Add "${dst}" to ${src}'s requires, or record a scoped mentions entry saying why it is evidence.`,
    );
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
  const problems = [
    ...check(manifest, payloadFiles, (p) => existsSync(join(REPO_ROOT, p))),
    ...checkDerivedDependencies(manifest, payloadFiles, (p) => readFileSync(join(REPO_ROOT, p), "utf8")),
  ];

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
