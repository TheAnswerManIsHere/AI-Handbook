#!/usr/bin/env node
/**
 * Assemble an MCP snapshot from raw captured API responses on disk.
 *
 * WHY THIS EXISTS. Every snapshot in this machinery used to be assembled by
 * hand: the agent read a tool result in its context and typed the values into
 * a file. That step is generation, not transcription, and generation fills a
 * missing field with a plausible value rather than failing. On 2026-09-07 it
 * produced adjudication evidence with **invented** thread and comment ids
 * (`PRRT_kwDOUKOPKc6fxwZ1`, `3946356201`), which reached the judge and were
 * caught only because a later live fetch disagreed. Two round-4 findings were
 * also missing entirely, because the capture came from webhook notification
 * text rather than a fetch of PR state.
 *
 * `assertThreadProvenance` did not stop it and could not: it checks that an
 * id is well-formed and that a thread agrees with its own comments. Both were
 * true. Nothing checked that the id had ever come from GitHub.
 *
 * THE FIX IS TO REMOVE THE HAND STEP, NOT TO CHECK IT HARDER. This script
 * reads the raw response files the harness writes when a tool result is too
 * large to return inline, and emits a snapshot whose every identifier is
 * copied by a program. It records, for each collection, the file it came from
 * and that file's SHA-256, so `review-loop-record.mjs` can verify the snapshot
 * against its own sources rather than trusting its shape.
 *
 * HOW TO GET THE CAPTURE FILES. Request the full page (`perPage: 100`). A
 * response large enough to exceed the inline limit is written to a path the
 * tool result names. A small response is returned inline and never lands on
 * disk -- which is why the `pr` object is deliberately NOT covered here: it
 * carries no external identifiers this check could verify, and its two shas
 * are checked against git by the generator anyway.
 *
 * Usage:
 *   node core/scripts/snapshot-from-captures.mjs \
 *     --pr 43 --repo Owner/Name --head <sha> --base <sha> \
 *     --head-ref <branch> --base-ref main --title <t> --created-at <iso> \
 *     --body-file <path> \
 *     --reviews <capture> --comments <capture> --threads <capture> --out <path>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";

/** The collections whose entries carry identifiers a fabricator could invent. */
export const VERIFIED_COLLECTIONS = ["reviews", "issueComments", "reviewThreads"];

export function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Every identifier in a collection, as strings, for the containment check.
 *
 * Ids only -- not bodies. A body can legitimately differ from its captured
 * form (the record truncates long ones), while an id is copied or it is
 * invented. Checking the narrow thing that cannot legitimately change is what
 * keeps this from producing false refusals that would get it switched off.
 */
export function identifiersOf(collection, rows) {
  const out = [];
  for (const row of rows ?? []) {
    if (row?.id !== undefined && row?.id !== null) out.push(String(row.id));
    for (const c of row?.comments ?? []) {
      if (c?.id !== undefined && c?.id !== null) out.push(String(c.id));
    }
  }
  return out;
}

/**
 * Verify a snapshot against the captures it claims to come from.
 *
 * Three questions, in order, because a later one is meaningless if an earlier
 * one fails: does the snapshot name a source for every verified collection;
 * does that source still hash to what was recorded; and does every identifier
 * in the collection appear in that source's raw text.
 *
 * The containment test is deliberately textual. Re-parsing the capture and
 * comparing structures would re-implement the shape assumptions this file
 * already makes, and would then agree with itself for the same reason the
 * hand-assembly did. A substring search over the bytes the API returned
 * cannot agree with an id that was never in them.
 */
export function assertCaptureProvenance(snapshot, { read = readFileSync } = {}) {
  const prov = snapshot?.captureProvenance;
  if (!prov || typeof prov !== "object") {
    throw new Error(
      "snapshot carries no `captureProvenance`, so nothing establishes that its entries came from GitHub " +
        "rather than from an agent's context. Assemble it with core/scripts/snapshot-from-captures.mjs, " +
        "which copies every identifier from a captured response and records the file it copied from",
    );
  }
  // SHAPE FIRST, ACROSS ALL COLLECTIONS, before any file is opened. Checking
  // one collection through to completion before looking at the next makes the
  // refusal you get depend on which filesystem error happened to come first:
  // a snapshot naming no source for `reviewThreads` reports an unreadable
  // `reviews` file instead, and the reader fixes the wrong thing.
  for (const key of VERIFIED_COLLECTIONS) {
    const entry = prov[key];
    if (!entry || typeof entry.file !== "string" || typeof entry.sha256 !== "string") {
      throw new Error(
        `captureProvenance.${key} must name the capture file this collection was assembled from and that ` +
          `file's sha256. A collection with no named source is exactly the hand-typed case this refuses`,
      );
    }
  }
  for (const key of VERIFIED_COLLECTIONS) {
    const entry = prov[key];
    let text;
    try {
      text = read(entry.file, "utf8");
    } catch (e) {
      throw new Error(
        `captureProvenance.${key} names ${entry.file}, which cannot be read (${e.code ?? e.message}). ` +
          `The capture a snapshot was built from must still exist to be checked against`,
      );
    }
    const actual = digest(text);
    if (actual !== entry.sha256) {
      throw new Error(
        `captureProvenance.${key}: ${entry.file} now hashes to ${actual.slice(0, 12)} but the snapshot ` +
          `records ${String(entry.sha256).slice(0, 12)}. The capture changed after assembly, so it no longer ` +
          `establishes anything about this snapshot's contents`,
      );
    }
    const missing = identifiersOf(key, snapshot[key]).filter((id) => !text.includes(id));
    if (missing.length) {
      throw new Error(
        `${missing.length} identifier(s) in snapshot.${key} appear nowhere in ${entry.file}: ` +
          `${missing.slice(0, 5).join(", ")}${missing.length > 5 ? ", ..." : ""}. An id that is not in the ` +
          `captured response was not returned by GitHub -- refusing rather than letting invented evidence ` +
          `reach the judge`,
      );
    }
  }
}

const flag = (args, name) => {
  const i = args.indexOf(`--${name}`);
  return i === -1 ? null : args[i + 1] ?? null;
};

function loadCapture(path) {
  const text = readFileSync(path, "utf8");
  return { text, json: JSON.parse(text), sha256: digest(text), file: path };
}

const normaliseThread = (t) => ({
  id: t.id,
  isResolved: t.is_resolved,
  isOutdated: t.is_outdated ?? false,
  path: t.comments?.[0]?.path ?? null,
  line: t.comments?.[0]?.line ?? null,
  comments: (t.comments ?? []).map((c) => ({
    id: Number(/#discussion_r(\d+)/.exec(c.html_url)?.[1]),
    body: c.body,
    path: c.path ?? null,
    line: c.line ?? null,
    author: c.author,
    user: { login: c.author?.startsWith("chatgpt-codex") ? `${c.author}[bot]` : c.author },
    created_at: c.created_at,
    html_url: c.html_url,
  })),
});

export function main(argv = process.argv.slice(2)) {
  const need = (name) => {
    const v = flag(argv, name);
    if (!v) throw new Error(`--${name} is required`);
    return v;
  };
  const capturedAt = flag(argv, "captured-at") ?? new Date().toISOString();
  const reviews = loadCapture(need("reviews"));
  const comments = loadCapture(need("comments"));
  const threads = loadCapture(need("threads"));

  if (threads.json?.pageInfo?.hasNextPage) {
    throw new Error(
      `${threads.file} reports hasNextPage: true, so it is one page of a longer list. A partial capture ` +
        `understates findings, which is wrong in the loop's favour -- re-request with a larger perPage`,
    );
  }

  const snapshot = {
    repo: need("repo"),
    capturedAt: Object.fromEntries(
      ["pr", "reviews", "issueComments", "reviewThreads"].map((k) => [k, capturedAt]),
    ),
    pr: {
      number: Number(need("pr")),
      title: need("title"),
      created_at: need("created-at"),
      closed_at: null,
      body: readFileSync(need("body-file"), "utf8"),
      base: { ref: need("base-ref"), sha: need("base"), repo: { full_name: need("repo") } },
      head: { ref: need("head-ref"), sha: need("head"), repo: { full_name: need("repo") } },
    },
    reviews: reviews.json,
    issueComments: comments.json,
    reviewThreads: (threads.json.review_threads ?? []).map(normaliseThread),
    complete: { reviews: true, issueComments: true, reviewThreads: true },
    captureProvenance: {
      reviews: { file: reviews.file, sha256: reviews.sha256 },
      issueComments: { file: comments.file, sha256: comments.sha256 },
      reviewThreads: { file: threads.file, sha256: threads.sha256 },
    },
  };
  assertCaptureProvenance(snapshot);
  const out = need("out");
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  return (
    `wrote ${out}: ${snapshot.reviews.length} reviews, ${snapshot.issueComments.length} comments, ` +
    `${snapshot.reviewThreads.length} threads ` +
    `(${snapshot.reviewThreads.filter((t) => t.isResolved).length} resolved). ` +
    `Every identifier copied from a capture and verified against it.`
  );
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop())) {
  try {
    process.stdout.write(`${main()}\n`);
  } catch (e) {
    process.stderr.write(`${e.message}\n`);
    process.exit(1);
  }
}
