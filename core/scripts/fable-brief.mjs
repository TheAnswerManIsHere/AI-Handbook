#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * Assemble the brief for one Fable role's dispatch (issue #36).
 *
 * WHY THIS EXISTS. The roles are worth dispatching only if they are
 * independent of the builder, and the builder writes every prompt it sends.
 * #36 states the constraint directly: *"If the builder writes the prompt, the
 * builder can steer the reviewer."* The previous attempt at Fable review was
 * retired at zero-for-fifteen precisely because it read the builder's own
 * classifications, so a persuasive builder got a compliant judge.
 *
 * So a brief is a pure function of inputs the builder cannot slant mid-loop:
 * git over a pinned range, and a snapshot whose provenance is already checked
 * by `snapshot-from-captures.mjs`. Nothing a session types reaches a reviewer,
 * with ONE declared exception -- role D4, whose whole subject IS the builder's
 * framing, and which therefore receives it quoted and labelled as the object
 * under review rather than as context.
 *
 * FAIL LOUD, NEVER OPEN. Every refusal here is a role that does not run.
 * That is the safe direction: this repository has shipped three controls that
 * reported success when they could not read their input (#16, #59, and the
 * entry-point defect closed in #11), and the lesson recorded each time is the
 * same -- a control that cannot evaluate must refuse, never pass.
 */

import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, resolve, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, "..");

/**
 * Which agent definition each role dispatches to, and what the brief must
 * carry for it. `needsSnapshot` is not a convenience flag: a role whose
 * question is about findings cannot be answered from git, and running it
 * against a brief that silently omits them would produce a confident verdict
 * about nothing.
 */
export const ROLES = {
  B1: { agent: "fable-conformance-triage", needsSnapshot: true, needsRange: false, needsDoc: false },
  B2: { agent: "fable-delta-review", needsSnapshot: true, needsRange: true, needsDoc: false },
  B3: { agent: "fable-check-synthesis", needsSnapshot: true, needsRange: true, needsDoc: false },
  D1: { agent: "fable-plan-opinion", needsSnapshot: false, needsRange: false, needsDoc: true },
  D2: { agent: "fable-merge-opinion", needsSnapshot: true, needsRange: true, needsDoc: false },
  D3: { agent: "fable-gaps-translation", needsSnapshot: true, needsRange: true, needsDoc: false },
  D4: { agent: "fable-scope-framing", needsSnapshot: false, needsRange: false, needsDoc: false },
};

/** Roles that see the builder's own words, and the reason each one may. */
export const SEES_BUILDER_FRAMING = { D4: "the framing IS the object under review" };

const git = (args) => execFileSync("git", args, { cwd: ROOT, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
const sha256 = (text) => createHash("sha256").update(text).digest("hex");

/**
 * The model the role's own definition pins, read from that definition.
 *
 * #36's prerequisite: *"The agent definition says `model: fable`, an alias,
 * and the dispatch result carries no model id -- so 'it is using 5.1' is
 * probably true and not established."* One source, read at assembly time, and
 * stamped into the brief so a receipt can record what was ASKED for. What was
 * served is a separate fact and this cannot know it -- so the field is named
 * `modelRequested`, never `model`.
 */
export function modelRequestedFor(agent, { read = (p) => readFileSync(p, "utf8") } = {}) {
  const path = join(ROOT, ".claude", "agents", `${agent}.md`);
  const front = /^---\r?\n([\s\S]*?)\r?\n---\r?\n/.exec(read(path));
  if (!front) throw new Error(`${agent}: no frontmatter, so no pinned model -- refusing to dispatch unpinned`);
  const model = /^model:\s*(.+)$/m.exec(front[1]);
  if (!model) throw new Error(`${agent}: frontmatter declares no model -- refusing to dispatch unpinned`);
  const value = model[1].trim().replace(/^["']|["']$/g, "");
  if (/^(best|inherit|fable|opus|sonnet|haiku)$/i.test(value)) {
    throw new Error(
      `${agent}: model "${value}" is an alias, not a pinned id. #36's prerequisite is that the ` +
        `definition pins a concrete model so the receipt can record what was requested.`,
    );
  }
  return value;
}

/** Findings as the reviewer wrote them -- never the builder's account of them. */
export function rawFindings(snapshot) {
  const threads = snapshot.reviewThreads;
  if (!Array.isArray(threads)) {
    throw new Error(
      "this snapshot carries no reviewThreads, so it is round-check-only. A role that reads findings " +
        "cannot run on it -- rebuild the snapshot with --threads.",
    );
  }
  return threads.map((t) => ({
    id: t.id,
    isResolved: t.isResolved === true,
    path: t.comments?.[0]?.path ?? null,
    line: t.comments?.[0]?.line ?? t.comments?.[0]?.original_line ?? null,
    // The FIRST comment only. Later comments in a thread are the builder's
    // replies, which is exactly the channel #36 says must not reach a role.
    body: t.comments?.[0]?.body ?? null,
    replyCount: Math.max(0, (t.comments?.length ?? 0) - 1),
  }));
}

/**
 * A document read from git at a pinned commit, never from the working tree.
 *
 * D1 reads the plan it is giving an opinion on. Reading it from disk would let
 * an uncommitted edit reach the reviewer, so the plan a role sees is the plan
 * that is committed at the sha the dispatch names.
 */
export function docAtCommit(commit, path) {
  if (!/^[0-9a-f]{7,40}$/i.test(commit)) throw new Error(`--doc-commit "${commit}" is not a commit sha`);
  let text;
  try {
    text = git(["show", `${commit}:${path}`]);
  } catch {
    throw new Error(`${path} does not exist at ${commit} -- refusing rather than reading the working tree`);
  }
  return { path, commit, text };
}

/** The diff over a pinned range, plus the file list, both git-derived. */
export function rangeFacts(base, head) {
  for (const [label, ref] of [["base", base], ["head", head]]) {
    if (!/^[0-9a-f]{7,40}$/i.test(ref)) throw new Error(`${label} "${ref}" is not a commit sha -- refusing a symbolic range`);
  }
  const numstat = git(["diff", "--numstat", "-z", "--no-renames", `${base}...${head}`]);
  const files = numstat
    .split("\0")
    .filter(Boolean)
    .map((r) => {
      const p = r.split("\t");
      return { added: p[0] === "-" ? null : Number(p[0]), removed: p[1] === "-" ? null : Number(p[1]), file: p.slice(2).join("\t") };
    });
  return { base, head, files, patch: git(["diff", `${base}...${head}`]) };
}

export function buildBrief({ role, pr, snapshot = null, base = null, head = null, options = null, doc = null, now = new Date() }) {
  const spec = ROLES[role];
  if (!spec) throw new Error(`unknown role "${role}" -- one of ${Object.keys(ROLES).join(", ")}`);

  // FIRST, ahead of every completeness check. This is the independence
  // guarantee, and the others are only about having enough to read. Refusing a
  // leak with "you are missing a document" would send the operator back to add
  // the document and retry -- with the leak still attached. (Caught by this
  // script's own suite: D1 refused a framing leak for the wrong reason.)
  if (options && !SEES_BUILDER_FRAMING[role]) {
    throw new Error(
      `role ${role} was given --options, but only ${Object.keys(SEES_BUILDER_FRAMING).join(", ")} may see the builder's ` +
        `framing. Passing it here would hand a role the prose it exists to be independent of.`,
    );
  }

  if (spec.needsSnapshot && !snapshot) {
    throw new Error(`role ${role} reads findings, so --snapshot is required. Refusing rather than dispatching a role with nothing to read.`);
  }
  if (spec.needsRange && !(base && head)) {
    throw new Error(`role ${role} reads a diff, so --base and --head are required.`);
  }
  if (spec.needsDoc && !doc) {
    throw new Error(
      `role ${role} gives an opinion on a document, so --doc and --doc-commit are required. An empty brief ` +
        `would dispatch a reviewer with nothing to read and collect a confident opinion about nothing.`,
    );
  }
  if (doc && !spec.needsDoc) {
    throw new Error(`role ${role} does not read a document, so --doc is not accepted.`);
  }
  if (SEES_BUILDER_FRAMING[role] && !options) {
    throw new Error(`role ${role} reviews the builder's framing, so --options is required: it is the object under review.`);
  }

  const provenance = [];
  const brief = { role, agent: spec.agent, pr, assembledAt: now.toISOString() };
  brief.modelRequested = modelRequestedFor(spec.agent);

  if (spec.needsSnapshot) {
    brief.findings = rawFindings(snapshot.parsed);
    provenance.push({ input: "snapshot", path: snapshot.path, sha256: sha256(snapshot.text) });
  }
  if (spec.needsRange) {
    brief.range = rangeFacts(base, head);
    provenance.push({ input: "git", range: `${base}...${head}` });
  }
  if (spec.needsDoc) {
    brief.document = doc;
    provenance.push({ input: "git-show", path: doc.path, commit: doc.commit, sha256: sha256(doc.text) });
  }
  if (options) {
    brief.builderFraming = { why: SEES_BUILDER_FRAMING[role], verbatim: options.text };
    provenance.push({ input: "options", path: options.path, sha256: sha256(options.text) });
  }
  brief.provenance = provenance;
  brief.contract =
    "Assembled by fable-brief.mjs from the inputs listed in provenance. No text written by the session " +
    "driving the loop is present" +
    (options ? ", except builderFraming, which is the object under review for this role." : ".");
  return brief;
}

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  if (i === -1) return null;
  const v = argv[i + 1];
  if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a value`);
  return v;
}

export function main(argv = process.argv.slice(2)) {
  const role = flag(argv, "role");
  if (!role) throw new Error(`--role is required -- one of ${Object.keys(ROLES).join(", ")}`);
  const prRaw = flag(argv, "pr");
  if (!prRaw || !/^\d+$/.test(prRaw)) throw new Error("--pr is required and must be a number");

  const loadFile = (name) => {
    const p = flag(argv, name);
    if (!p) return null;
    if (!existsSync(p)) throw new Error(`--${name} ${p} does not exist`);
    const text = readFileSync(p, "utf8");
    return { path: p, text, parsed: name === "snapshot" ? JSON.parse(text) : null };
  };

  const brief = buildBrief({
    role,
    pr: Number(prRaw),
    snapshot: loadFile("snapshot"),
    base: flag(argv, "base"),
    head: flag(argv, "head"),
    options: loadFile("options"),
    doc: flag(argv, "doc") ? docAtCommit(flag(argv, "doc-commit") ?? "", flag(argv, "doc")) : null,
  });

  const out = flag(argv, "out");
  const json = `${JSON.stringify(brief, null, 1)}\n`;
  if (out) writeFileSync(out, json);
  else process.stdout.write(json);

  return (
    `brief for ${brief.role} (${brief.agent}), PR #${brief.pr}, modelRequested ${brief.modelRequested}: ` +
    `${brief.findings ? `${brief.findings.length} raw finding(s), ` : ""}` +
    `${brief.range ? `${brief.range.files.length} changed file(s) over ${brief.range.base.slice(0, 7)}...${brief.range.head.slice(0, 7)}, ` : ""}` +
    `${brief.document ? `document ${brief.document.path} at ${brief.document.commit.slice(0, 7)}, ` : ""}` +
    `${brief.builderFraming ? "builder framing INCLUDED as the object under review, " : "no session-written text, "}` +
    `${out ? `written to ${out}` : "on stdout"}`
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    console.log(main());
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
