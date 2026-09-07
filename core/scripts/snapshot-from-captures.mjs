#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
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
 * reads raw response files and emits a snapshot that is a pure function of
 * them. It records, for each collection, the files it read and their SHA-256s,
 * so `assertCaptureProvenance` can RE-DERIVE the snapshot from those files and
 * refuse anything that differs.
 *
 * THE CHECK IS STRUCTURAL EQUALITY, NOT AN IDENTIFIER SEARCH. The first
 * version of this file verified that every id in the snapshot appeared
 * somewhere in the capture's text. Round 1 of #45 showed that is both too
 * weak and too loose: a snapshot edited after assembly to flip `isResolved`,
 * rewrite a finding's body, or move a comment onto a different thread leaves
 * every id exactly where it was -- and `isResolved` is the field that already
 * produced a wrong verdict on #43 -- while `text.includes("234")` is
 * satisfied by a capture containing only `12345`. Deriving the collections
 * again and comparing the whole structure answers both, and it makes no shape
 * assumption the assembler does not already make: it is literally the same
 * function.
 *
 * NOTHING ABOUT THE PULL REQUEST IS TYPED ON THE COMMAND LINE. The first
 * version took `--head`, `--base`, `--title` and the rest as flags, which put
 * the two shas that decide `artifact`, territory and plan-file discovery back
 * in the hand-typed category this file exists to abolish -- and a
 * wrong-but-real base sha passes the generator's endpoint check and then
 * silently describes a different diff. They come from the captured `get`
 * response now.
 *
 * HOW TO GET THE CAPTURE FILES. Request the full page (`perPage: 100`). A
 * response large enough to exceed the inline limit is written by the harness
 * to a path the tool result names; that file is evidence no agent touched.
 *
 * A SMALLER RESPONSE COMES BACK INLINE AND MUST BE WRITTEN OUT BY HAND, and
 * this file does not pretend otherwise. Copying one contiguous blob is a much
 * narrower act than typing a snapshot field by field -- the failure being
 * fixed was inventing ids for entries whose bodies came from somewhere else
 * entirely -- but it is still a hand step, and a blob corrupted on the way in
 * would satisfy every check here, because the snapshot is then a faithful
 * transform of a corrupted source. So each capture RECORDS which case it is,
 * derived from the path rather than declared, and the record carries it.
 * Refusing the agent-written case instead would strand any pull request small
 * enough to answer inline -- and a loop that cannot build a record cannot
 * obtain a verdict to continue OR to stop.
 *
 * Usage:
 *   node core/scripts/snapshot-from-captures.mjs \
 *     --pr-capture <get> \
 *     --reviews <get_reviews page> [--reviews <next page> ...] \
 *     --comments <get_comments page> [--comments <next page> ...] \
 *     --threads <get_review_comments page> [--threads <next page> ...] \
 *     --out <path>
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, statSync } from "node:fs";
import { resolve } from "node:path";

/**
 * The collections whose contents this file can prove, in the order the
 * refusals should be read. `pr` is one of them now: its two shas decide the
 * artifact diff, and a typed sha is exactly the class of value that has gone
 * wrong here before.
 */
export const VERIFIED_COLLECTIONS = ["pr", "reviews", "issueComments", "reviewThreads"];

/**
 * `--threads` is the one optional capture, and omitting it produces a
 * ROUND-CHECK-ONLY snapshot.
 *
 * `review-budget.mjs check` reads `pr`, `reviews` and `issueComments` and
 * nothing else, while `review-loop-record.mjs` refuses any snapshot whose
 * `complete.reviewThreads` is not explicitly true. So a snapshot built
 * without threads serves the round check and is REFUSED BY NAME by the
 * generator -- the omission cannot become a silently empty finding list,
 * which is the failure this file exists to prevent.
 *
 * It matters because captures small enough to return inline have to be
 * written out by hand, and a threads payload carrying a loop's own replies is
 * the largest of them. A round check that demanded it would make the honest
 * path the expensive one, and an expensive discipline is one that gets
 * skipped.
 */
export const OPTIONAL_COLLECTIONS = ["reviewThreads"];

/** Which flag supplies each collection's captures. */
const FLAG_OF = {
  pr: "pr-capture",
  reviews: "reviews",
  issueComments: "comments",
  reviewThreads: "threads",
};

/**
 * A REST page is proven to be the last one only by being SHORT. GitHub's
 * `perPage` maximum is 100, so a page holding exactly that many entries may
 * have a successor and may not -- and the difference is a reviewer pass the
 * record does not know happened, or a clean round never counted.
 */
const PAGE_MAX = 100;

export function digest(text) {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * Where a capture came from, from its path alone.
 *
 * The harness writes an oversized tool result under
 * `…/projects/<project>/<session>/tool-results/`, and nothing else writes
 * there in the course of this work. Deriving the classification rather than
 * accepting a declared one is the whole point: a field the assembler sets
 * from a flag is a field that says what its caller wanted it to say.
 *
 * This is not a forgery defence -- the directory is writable, and the stated
 * threat model here is my own mistakes, not an adversary. It makes the weaker
 * case visible instead of silently equivalent to the stronger one.
 */
export function captureSource(file) {
  return /(^|\/)\.claude\/projects\/(?:[^/]+\/)+tool-results\//.test(resolve(file))
    ? "harness-capture"
    : "agent-written";
}

/** How long before a file was written its fetch may plausibly be claimed. */
const MAX_DECLARED_LAG_MS = 24 * 60 * 60 * 1000;

/**
 * One capture file, read.
 *
 * `mtime` is when the response was written, not when this script ran.
 * Stamping the invocation time let a capture taken hours earlier satisfy the
 * round check's one-hour freshness bound and appear to postdate a reviewer
 * pass it actually predated, which is precisely what
 * `assertCapturedAfterLatestPass` exists to refuse. (Codex, #45 round 1.)
 *
 * FOR AN INLINE RESPONSE, MTIME IS THE SAVE TIME, NOT THE FETCH TIME, and the
 * gap between them is invisible to this program (Codex, #45 round 2). A
 * harness capture has no gap: the harness writes the file as the response
 * arrives. An agent-written one does, and nothing here can measure it -- so it
 * must be DECLARED, with `--fetched-at`, and the declaration is bounded on
 * both sides. It cannot be later than the file's mtime, because nothing is
 * saved before it is fetched; and it cannot precede it by more than a day,
 * because a mistyped date would otherwise age the evidence silently and every
 * downstream refusal would name the wrong cause. Declaring EARLIER than the
 * truth is the safe direction and is left alone: both gates that read this
 * mean "not older than", so an over-old claim only ever refuses work.
 */
function loadCapture(path, declared = null) {
  const file = resolve(path);
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch (e) {
    throw new Error(`capture ${file} cannot be read (${e.code ?? e.message})`);
  }
  let json;
  try {
    json = JSON.parse(text);
  } catch (e) {
    throw new Error(`capture ${file} is not JSON (${e.message}). Pass the raw tool result, unedited`);
  }
  const source = captureSource(file);
  const mtime = new Date(statSync(file).mtimeMs).toISOString();
  return { file, json, sha256: digest(text), source, ...resolveCaptureTime({ file, source, mtime }, declared) };
}

/**
 * When GitHub was actually read, for one capture, and where that answer came
 * from. Exported because the verifier must reach the same answer from the
 * recorded provenance, and two implementations would drift.
 */
export function resolveCaptureTime({ file, source, mtime }, declared) {
  // A HARNESS CAPTURE IGNORES THE DECLARATION rather than refusing it. The
  // flag is per-batch, and the normal batch is MIXED: on a loop with rounds
  // behind it the threads payload is large enough for the harness to spill,
  // while the smaller responses come back inline. Refusing a declaration here
  // made that ordinary case unassemblable -- a refusal with no remedy, which
  // is worse than the fail-open it replaced. (Found running this against #43's
  // real captures, not by review.) The measurement still wins: a declaration
  // never overwrites a time the harness recorded.
  if (source === "harness-capture") return { capturedAt: mtime, capturedAtSource: "file-mtime" };
  if (!declared) {
    throw new Error(
      `${file} was written by an agent from an inline response, so its mtime is when the blob was SAVED, ` +
        `not when GitHub was read -- and a response fetched hours earlier but saved just now would pass the ` +
        `freshness gate while missing a reviewer pass. Pass --fetched-at <iso> with the time of the fetch`,
    );
  }
  const at = Date.parse(declared);
  if (!Number.isFinite(at)) throw new Error(`--fetched-at ${JSON.stringify(declared)} is not a parseable date`);
  const saved = Date.parse(mtime);
  if (at > saved) {
    throw new Error(
      `--fetched-at ${declared} is later than ${file}'s mtime ${mtime}: nothing is saved before it is ` +
        `fetched, so the declaration is wrong in the direction that makes evidence look fresher than it is`,
    );
  }
  if (saved - at > MAX_DECLARED_LAG_MS) {
    throw new Error(
      `--fetched-at ${declared} precedes ${file}'s mtime ${mtime} by more than a day. Declaring an older ` +
        `fetch is the safe direction, but this far out is a mistyped date -- which would age the evidence ` +
        `silently and make every downstream refusal name the wrong cause`,
    );
  }
  return { capturedAt: new Date(at).toISOString(), capturedAtSource: "declared" };
}

/**
 * The capture time for a collection is its OLDEST page. Both gates that read
 * it mean "not older than", so a fresh final page must not be able to carry a
 * stale first one past them.
 */
const oldest = (captures) => captures.map((c) => c.capturedAt).sort()[0];

const requireArray = (capture, what) => {
  if (!Array.isArray(capture.json)) {
    throw new Error(
      `${capture.file} is not a ${what} array -- it is ${capture.json === null ? "null" : typeof capture.json}. ` +
        `An error object or a snapshot fragment passed here would become an empty collection, and an empty ` +
        `collection reads as a clean round`,
    );
  }
  return capture.json;
};

/**
 * Concatenate a collection's pages, refusing a set that does not prove it
 * reached the end. `complete: true` is an attestation the generator trusts
 * absolutely; asserting it from one unexamined page is how a loop undercounts
 * its own rounds. (Codex, #45 round 1.)
 */
function pagedArray(captures, collection) {
  const pages = captures.map((c) => requireArray(c, collection));
  const last = pages[pages.length - 1];
  if (last.length >= PAGE_MAX) {
    throw new Error(
      `the last ${collection} capture (${captures[captures.length - 1].file}) holds ${last.length} entries, ` +
        `which is GitHub's page maximum -- so there may be another page, and this snapshot would attest a ` +
        `completeness it has not established. Fetch the next page and pass it as a further ` +
        `--${FLAG_OF[collection]}`,
    );
  }
  return pages.flat();
}

/**
 * GitHub's review-thread payload is cursor-paginated and carries its own
 * end-of-list proof, so this one does not have to infer the end from a length.
 */
function pagedThreads(captures) {
  const out = [];
  const last = captures.length - 1;
  captures.forEach((c, i) => {
    if (!c.json || typeof c.json !== "object" || !Array.isArray(c.json.review_threads)) {
      throw new Error(
        `${c.file} carries no review_threads array. An API error object or an older snapshot format would ` +
          `otherwise become zero threads, and zero threads is indistinguishable from a clean round`,
      );
    }
    // THE END OF THE LIST MUST BE STATED, NOT MERELY UNCONTRADICTED. Reading
    // `pageInfo?.hasNextPage` as falsy accepted a capture with no `pageInfo`
    // at all -- a hand-trimmed payload, an older tool's shape -- as a proven
    // terminal page. Absence of a claim is not a claim. (Codex, #45 round 2.)
    if (i === last) {
      if (c.json.pageInfo?.hasNextPage !== false) {
        throw new Error(
          `${c.file} is the last --threads capture supplied but does not state pageInfo.hasNextPage: false ` +
            `(it is ${JSON.stringify(c.json.pageInfo?.hasNextPage ?? null)}). Only the payload's own ` +
            `end-of-list flag proves the list ended; a partial capture understates findings, which is wrong ` +
            `in the loop's favour -- pass the remaining pages as further --threads`,
        );
      }
    }
    out.push(...c.json.review_threads);
  });
  // ...AND THE COUNT MUST RECONCILE. `{ totalCount: 250, review_threads: [] }`
  // satisfied every check above and became a complete zero-thread round, which
  // is the shape that produces a stop verdict on a loop that is not finished.
  // GitHub reports the whole list's size on every page, so the concatenated
  // threads must equal it. Checked only when present, because it is the
  // payload's field to supply, not one to demand of a shape that lacks it.
  const declared = captures.map((c) => c.json.totalCount).filter((n) => Number.isFinite(n));
  const total = declared.length ? Math.max(...declared) : null;
  if (total !== null && out.length !== total) {
    throw new Error(
      `the --threads captures hold ${out.length} thread(s) but the payload reports totalCount ${total}. ` +
        `A short list attested complete understates findings -- pass every page, and if the count still ` +
        `disagrees the captures are from different reads and must be retaken together`,
    );
  }
  return out;
}

const commentIdOf = (url) => {
  const m = /#discussion_r(\d+)/.exec(url ?? "");
  return m ? Number(m[1]) : null;
};

const normaliseThread = (t) => ({
  id: t.id,
  isResolved: t.is_resolved,
  isOutdated: t.is_outdated ?? false,
  path: t.comments?.[0]?.path ?? null,
  line: t.comments?.[0]?.line ?? null,
  comments: (t.comments ?? []).map((c) => ({
    id: commentIdOf(c.html_url),
    body: c.body,
    path: c.path ?? null,
    line: c.line ?? null,
    author: c.author,
    user: { login: c.author?.startsWith("chatgpt-codex") ? `${c.author}[bot]` : c.author },
    created_at: c.created_at,
    html_url: c.html_url,
  })),
});

/** The fields of `get` the snapshot carries, each required rather than defaulted. */
function normalisePr(capture) {
  const g = capture.json;
  const need = (dotted) => {
    const v = dotted.split(".").reduce((o, k) => (o == null ? undefined : o[k]), g);
    if (v === undefined || v === null || v === "") {
      throw new Error(
        `the PR capture ${capture.file} has no ${dotted}. Pass the unedited result of ` +
          `pull_request_read(method: "get") -- everything the artifact is measured over comes from it`,
      );
    }
    return v;
  };
  return {
    number: need("number"),
    title: need("title"),
    state: g.state ?? null,
    draft: g.draft ?? null,
    merged: g.merged ?? null,
    mergeable_state: g.mergeable_state ?? null,
    created_at: need("created_at"),
    updated_at: g.updated_at ?? null,
    closed_at: g.closed_at ?? null,
    body: need("body"),
    base: { ref: need("base.ref"), sha: need("base.sha"), repo: { full_name: need("base.repo.full_name") } },
    head: { ref: need("head.ref"), sha: need("head.sha"), repo: { full_name: need("head.repo.full_name") } },
  };
}

/**
 * THE ONE DERIVATION, used both to build a snapshot and to verify one.
 *
 * Two implementations of "what this capture means" would drift, and the
 * verifier would then certify snapshots the assembler could not produce. One
 * function cannot.
 */
export function deriveSnapshot(captures) {
  const present = VERIFIED_COLLECTIONS.filter((k) => (captures[k] ?? []).length > 0);
  const withThreads = present.includes("reviewThreads");
  const pr = normalisePr(captures.pr[0]);
  const snapshot = {
    repo: pr.base.repo.full_name,
    capturedAt: Object.fromEntries(present.map((k) => [k, oldest(captures[k])])),
    pr,
    reviews: pagedArray(captures.reviews, "reviews"),
    issueComments: pagedArray(captures.issueComments, "issueComments"),
    ...(withThreads ? { reviewThreads: pagedThreads(captures.reviewThreads).map(normaliseThread) } : {}),
    complete: { reviews: true, issueComments: true, ...(withThreads ? { reviewThreads: true } : {}) },
    captureProvenance: Object.fromEntries(
      present.map((k) => [
        k,
        {
          files: captures[k].map((c) => ({
            file: c.file,
            sha256: c.sha256,
            source: c.source,
            capturedAt: c.capturedAt,
            capturedAtSource: c.capturedAtSource,
          })),
          capturedAt: oldest(captures[k]),
        },
      ]),
    ),
  };
  // Through JSON once, so that what is compared is what a reader of the file
  // would see: an `undefined` this derivation produced would vanish on write
  // and then differ from itself on the way back in.
  return JSON.parse(JSON.stringify(snapshot));
}

/** The top-level keys that differ, so a refusal names where to look. */
export function diffKeys(expected, actual) {
  const keys = new Set([...Object.keys(expected), ...Object.keys(actual ?? {})]);
  return [...keys].filter((k) => JSON.stringify(expected[k]) !== JSON.stringify(actual?.[k]));
}

/**
 * Verify a snapshot by rebuilding it from the captures it names.
 *
 * Three questions, in order, because a later one is meaningless if an earlier
 * one fails: does the snapshot name its sources; do those files still hash to
 * what was recorded; and is the snapshot equal to what they derive.
 */
export function assertCaptureProvenance(snapshot, { load = loadCapture } = {}) {
  const prov = snapshot?.captureProvenance;
  if (!prov || typeof prov !== "object") {
    throw new Error(
      "snapshot carries no `captureProvenance`, so nothing establishes that its entries came from GitHub " +
        "rather than from an agent's context. Assemble it with core/scripts/snapshot-from-captures.mjs, " +
        "which derives every field from a captured response and records the files it read",
    );
  }
  // SHAPE FIRST, ACROSS ALL COLLECTIONS, before any file is opened. Checking
  // one collection through to completion before looking at the next makes the
  // refusal you get depend on which filesystem error happened first: a
  // snapshot naming no source for `reviewThreads` reports an unreadable
  // `reviews` file instead, and the reader fixes the wrong thing.
  for (const key of VERIFIED_COLLECTIONS) {
    const entry = prov[key];
    if (!entry && OPTIONAL_COLLECTIONS.includes(key)) continue;
    if (!entry || !Array.isArray(entry.files) || entry.files.length === 0) {
      throw new Error(
        `captureProvenance.${key} must list the capture file(s) this collection was derived from. A ` +
          `collection with no named source is exactly the hand-typed case this refuses`,
      );
    }
    entry.files.forEach((f, i) => {
      if (!f || typeof f.file !== "string" || typeof f.sha256 !== "string") {
        throw new Error(`captureProvenance.${key}.files[${i}] must name a file and its sha256`);
      }
    });
  }

  const captures = {};
  for (const key of VERIFIED_COLLECTIONS) {
    captures[key] = (prov[key]?.files ?? []).map((f, i) => {
      const c = load(f.file, f.capturedAtSource === "declared" ? f.capturedAt : null);
      if (c.sha256 !== f.sha256) {
        throw new Error(
          `captureProvenance.${key}.files[${i}]: ${f.file} now hashes to ${c.sha256.slice(0, 12)} but the ` +
            `snapshot records ${String(f.sha256).slice(0, 12)}. The capture changed after assembly, so it no ` +
            `longer establishes anything about this snapshot's contents`,
        );
      }
      if (f.source !== c.source) {
        throw new Error(
          `captureProvenance.${key}.files[${i}] records source ${JSON.stringify(f.source ?? null)} for ` +
            `${f.file}, but that path is a ${c.source}. The classification is derived from the path, never ` +
            `declared -- a field the writer chooses is a field that says whatever the writer wanted`,
        );
      }
      return c;
    });
  }

  const differing = diffKeys(deriveSnapshot(captures), JSON.parse(JSON.stringify(snapshot)));
  if (differing.length) {
    throw new Error(
      `the snapshot is not what its own captures derive: ${differing.join(", ")} differ. Every field here is ` +
        `a pure function of the recorded files, so a difference means the snapshot was edited or built some ` +
        `other way. Re-run core/scripts/snapshot-from-captures.mjs rather than editing a snapshot -- an ` +
        `edited \`isResolved\` or finding body is invisible to an identifier check, and has produced a wrong ` +
        `verdict here before`,
    );
  }
}

/** Every value given for a repeatable flag, in the order supplied. */
export function flagValues(args, name) {
  const out = [];
  args.forEach((a, i) => {
    if (a === `--${name}`) {
      const v = args[i + 1];
      if (v === undefined || v.startsWith("--")) throw new Error(`--${name} needs a path`);
      out.push(v);
    }
  });
  return out;
}

export function main(argv = process.argv.slice(2)) {
  // One fetch time for the batch, because the recipe captures every collection
  // in one go; a per-file flag would invite pairing mistakes for no gain.
  // Harness captures reject it, so passing it is never a way to overwrite a
  // measured time with a claimed one.
  const fetchedAt = flagValues(argv, "fetched-at")[0] ?? null;
  const captures = {};
  for (const key of VERIFIED_COLLECTIONS) {
    const paths = flagValues(argv, FLAG_OF[key]);
    if (paths.length === 0 && !OPTIONAL_COLLECTIONS.includes(key)) {
      throw new Error(`--${FLAG_OF[key]} is required (repeat it for further pages)`);
    }
    if (key === "pr" && paths.length > 1) throw new Error("--pr-capture takes exactly one file");
    captures[key] = paths.map((f) => loadCapture(f, fetchedAt));
  }
  const out = flagValues(argv, "out")[0];
  if (!out) throw new Error("--out is required");

  const snapshot = deriveSnapshot(captures);
  // The verifier runs on the way out as well as on the way in: a snapshot
  // this script cannot itself certify is one nothing downstream will accept,
  // and learning that here costs a second rather than a round.
  assertCaptureProvenance(snapshot);
  writeFileSync(out, `${JSON.stringify(snapshot, null, 1)}\n`);

  const sources = VERIFIED_COLLECTIONS.filter((k) => captures[k].length)
    .map((k) => `${k} ${[...new Set(captures[k].map((c) => c.source))].join("+")}`)
    .join(", ");
  const threads = snapshot.reviewThreads
    ? `${snapshot.reviewThreads.length} threads ` +
      `(${snapshot.reviewThreads.filter((t) => t.isResolved).length} resolved)`
    : "NO THREADS -- round-check-only; review-loop-record.mjs will refuse this snapshot";
  return (
    `wrote ${out}: PR #${snapshot.pr.number} at ${snapshot.pr.head.sha.slice(0, 7)}, ` +
    `${snapshot.reviews.length} reviews, ${snapshot.issueComments.length} comments, ${threads}. ` +
    `Derived from the captures and verified against them. Sources: ${sources}`
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
