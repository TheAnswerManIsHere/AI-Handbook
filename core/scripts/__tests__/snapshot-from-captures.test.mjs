// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  VERIFIED_COLLECTIONS,
  digest,
  identifiersOf,
  assertCaptureProvenance,
  main,
} from "../snapshot-from-captures.mjs";

// A capture is a file on disk, so the tests use real ones. Faking the read
// seam would leave the one thing this module does -- read what a tool actually
// wrote -- untested.
function tmp(files = {}) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captures-"));
  const paths = {};
  for (const [name, content] of Object.entries(files)) {
    paths[name] = path.join(dir, name);
    fs.writeFileSync(paths[name], typeof content === "string" ? content : JSON.stringify(content));
  }
  return { dir, paths, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

const REPO = "TheAnswerManIsHere/AI-Handbook";
const reviewUrl = (id) => `https://github.com/${REPO}/pull/43#pullrequestreview-${id}`;
const commentUrl = (id) => `https://github.com/${REPO}/pull/43#issuecomment-${id}`;
const threadUrl = (id) => `https://github.com/${REPO}/pull/43#discussion_r${id}`;

const REVIEWS = [{ id: 5126838121, user: { login: "chatgpt-codex-connector[bot]" }, submitted_at: "2026-09-07T01:02:03Z", commit_id: "abc1234", state: "COMMENTED", body: null, html_url: reviewUrl(5126838121) }];
const COMMENTS = [{ id: 5560235123, user: { login: "TheAnswerManIsHere" }, created_at: "2026-09-07T01:00:00Z", body: "atC0dex r3view", html_url: commentUrl(5560235123) }];
const THREADS = {
  pageInfo: { hasNextPage: false },
  review_threads: [
    {
      id: "PRRT_kwDOUKOPKc6fxvRx",
      is_resolved: false,
      is_outdated: false,
      comments: [
        { body: "The mixed-format refusal is scoped to the whole body.", path: "docs/plans/P.md", line: 12, author: "chatgpt-codex-connector", created_at: "2026-09-07T01:02:03Z", html_url: threadUrl(3946356594) },
      ],
    },
  ],
};

function fixture(overrides = {}) {
  const { dir, paths, cleanup } = tmp({
    "reviews.json": overrides.reviews ?? REVIEWS,
    "comments.json": overrides.comments ?? COMMENTS,
    "threads.json": overrides.threads ?? THREADS,
    "body.md": overrides.body ?? "Workstream: #36.\n",
  });
  return { dir, paths, cleanup };
}

function argv(paths, out, extra = []) {
  return [
    "--pr", "43", "--repo", REPO,
    "--head", "1111111111111111111111111111111111111111",
    "--base", "2222222222222222222222222222222222222222",
    "--head-ref", "plan-review/structured-plan-provenance", "--base-ref", "main",
    "--title", "[PLAN REVIEW] Structured plan provenance",
    "--created-at", "2026-09-07T00:00:00Z",
    "--body-file", paths["body.md"],
    "--reviews", paths["reviews.json"],
    "--comments", paths["comments.json"],
    "--threads", paths["threads.json"],
    "--out", out,
    ...extra,
  ];
}

test("the assembled snapshot copies every identifier from a capture, and says which one", () => {
  const { dir, paths, cleanup } = fixture();
  const out = path.join(dir, "snapshot.json");
  main(argv(paths, out));
  const snap = JSON.parse(fs.readFileSync(out, "utf8"));

  assert.equal(snap.reviewThreads[0].id, "PRRT_kwDOUKOPKc6fxvRx");
  // The comment id is DERIVED from the captured URL, not carried alongside it:
  // GitHub's thread payload gives `#discussion_r<id>` and no separate field,
  // and the whole point is that no number enters the snapshot except by
  // program. 3946356594 is real -- it is thread fxvRx's root comment on #43.
  assert.equal(snap.reviewThreads[0].comments[0].id, 3946356594);
  for (const key of VERIFIED_COLLECTIONS) {
    assert.equal(snap.captureProvenance[key].file, paths[{ reviews: "reviews.json", issueComments: "comments.json", reviewThreads: "threads.json" }[key]]);
    assert.equal(snap.captureProvenance[key].sha256, digest(fs.readFileSync(snap.captureProvenance[key].file, "utf8")));
  }
  assert.doesNotThrow(() => assertCaptureProvenance(snap));
  cleanup();
});

test("a snapshot with no captureProvenance is refused, because nothing establishes its source", () => {
  assert.throws(() => assertCaptureProvenance({ reviews: [], issueComments: [], reviewThreads: [] }), /no `captureProvenance`/);
});

test("every verified collection must name a file and that file's hash", () => {
  for (const key of VERIFIED_COLLECTIONS) {
    const prov = Object.fromEntries(VERIFIED_COLLECTIONS.map((k) => [k, { file: "/x", sha256: "0" }]));
    delete prov[key];
    assert.throws(
      () => assertCaptureProvenance({ captureProvenance: prov }),
      new RegExp(`captureProvenance\\.${key} must name the capture file`),
    );
  }
  assert.throws(
    () => assertCaptureProvenance({ captureProvenance: { ...Object.fromEntries(VERIFIED_COLLECTIONS.map((k) => [k, { file: "/x", sha256: "0" }])), reviews: { file: "/x" } } }),
    /captureProvenance\.reviews must name/,
  );
});

test("a capture that no longer exists, or no longer hashes the same, establishes nothing", () => {
  const { dir, paths, cleanup } = fixture();
  const out = path.join(dir, "snapshot.json");
  main(argv(paths, out));
  const snap = JSON.parse(fs.readFileSync(out, "utf8"));

  fs.writeFileSync(paths["reviews.json"], JSON.stringify([...REVIEWS, { id: 1 }]));
  assert.throws(() => assertCaptureProvenance(snap), /reviews.json now hashes to/);

  fs.rmSync(paths["reviews.json"]);
  assert.throws(() => assertCaptureProvenance(snap), /cannot be read \(ENOENT\)/);
  cleanup();
});

test("an identifier that appears nowhere in its capture is refused", () => {
  const { dir, paths, cleanup } = fixture();
  const out = path.join(dir, "snapshot.json");
  main(argv(paths, out));
  const snap = JSON.parse(fs.readFileSync(out, "utf8"));

  // Exactly the fabrication of 2026-09-07: a well-formed, self-consistent,
  // this-PR thread id that GitHub never returned.
  snap.reviewThreads.push({ id: "PRRT_kwDOUKOPKc6fxwZ1", comments: [{ id: 3946356201, html_url: threadUrl(3946356201) }] });
  assert.throws(
    () => assertCaptureProvenance(snap),
    /2 identifier\(s\) in snapshot.reviewThreads appear nowhere in .*threads\.json: PRRT_kwDOUKOPKc6fxwZ1, 3946356201/,
  );
  cleanup();
});

test("identifiersOf reaches a collection's comments as well as its rows", () => {
  assert.deepEqual(identifiersOf("reviewThreads", [{ id: "PRRT_a", comments: [{ id: 1 }, { id: 2 }] }, { id: "PRRT_b" }]), ["PRRT_a", "1", "2", "PRRT_b"]);
  // A row with no id contributes nothing rather than contributing "undefined",
  // which would then be "found" in any capture containing that word.
  assert.deepEqual(identifiersOf("reviews", [{}, { id: null }, { id: 0 }]), ["0"]);
  assert.deepEqual(identifiersOf("reviews", undefined), []);
});

test("a paginated thread capture is refused rather than assembled into an understated round", () => {
  const { dir, paths, cleanup } = fixture({ threads: { ...THREADS, pageInfo: { hasNextPage: true } } });
  assert.throws(() => main(argv(paths, path.join(dir, "s.json"))), /reports hasNextPage: true/);
  cleanup();
});

test("a missing required flag is a refusal, not a snapshot with a hole in it", () => {
  const { dir, paths, cleanup } = fixture();
  const full = argv(paths, path.join(dir, "s.json"));
  const i = full.indexOf("--head");
  assert.throws(() => main([...full.slice(0, i), ...full.slice(i + 2)]), /--head is required/);
  cleanup();
});
