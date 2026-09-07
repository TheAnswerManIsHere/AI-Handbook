// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  VERIFIED_COLLECTIONS,
  OPTIONAL_COLLECTIONS,
  captureSource,
  diffKeys,
  digest,
  flagValues,
  assertCaptureProvenance,
  main,
} from "../snapshot-from-captures.mjs";
import { assertMcpSnapshotComplete } from "../review-counting.mjs";

// A capture is a file on disk, so the tests use real ones. Faking the read
// seam would leave the one thing this module does -- read what a tool actually
// wrote -- untested.
const REPO = "TheAnswerManIsHere/AI-Handbook";
const U = `https://github.com/${REPO}/pull/43`;
const repo = { full_name: REPO };

const PR = {
  number: 43,
  title: "[PLAN REVIEW] Structured plan provenance",
  state: "open",
  draft: true,
  merged: false,
  mergeable_state: "blocked",
  created_at: "2026-09-07T00:35:55Z",
  updated_at: "2026-09-07T04:06:36Z",
  closed_at: null,
  body: "Workstream: #36.\n",
  base: { ref: "main", sha: "25c1df885d104e0a8918fc09a993a0bf24d9b257", repo },
  head: { ref: "plan-review/structured-plan-provenance", sha: "6eb3b5e5ccd03fdcfb825d7a280de584ee1a8f0a", repo },
};
const REVIEWS = [
  {
    id: 5127962627,
    state: "COMMENTED",
    body: "**Reviewed commit:** `6eb3b5e5cc`",
    html_url: `${U}#pullrequestreview-5127962627`,
    user: { login: "chatgpt-codex-connector[bot]" },
    commit_id: PR.head.sha,
    submitted_at: "2026-09-07T04:06:32Z",
  },
];
const COMMENTS = [
  {
    id: 5564728682,
    body: "round 5 context",
    html_url: `${U}#issuecomment-5564728682`,
    user: { login: "TheAnswerManIsHere" },
    created_at: "2026-09-07T03:44:48Z",
  },
];
const THREADS = {
  totalCount: 1,
  pageInfo: { hasNextPage: false },
  review_threads: [
    {
      id: "PRRT_kwDOUKOPKc6fxvRx",
      is_resolved: false,
      is_outdated: false,
      comments: [
        {
          body: "The mixed-format refusal is scoped to the whole body.",
          path: "docs/plans/P.md",
          line: 12,
          author: "chatgpt-codex-connector",
          created_at: "2026-09-07T04:06:32Z",
          html_url: `${U}#discussion_r3946356594`,
        },
      ],
    },
  ],
};

function tmp(files) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "captures-"));
  const paths = {};
  for (const [name, content] of Object.entries(files)) {
    paths[name] = path.join(dir, name);
    fs.writeFileSync(paths[name], typeof content === "string" ? content : JSON.stringify(content));
  }
  return { dir, paths, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

function fixture(o = {}) {
  return tmp({
    "pr.json": o.pr ?? PR,
    "reviews.json": o.reviews ?? REVIEWS,
    "comments.json": o.comments ?? COMMENTS,
    "threads.json": o.threads ?? THREADS,
  });
}

// Every fixture here is written by the test, so every capture classifies as
// `agent-written` and needs a declared fetch time. The oldest mtime in the set
// is the one value that satisfies the rule for all of them: a declaration may
// not be later than a file's save time.
const fetchedAt = (paths) =>
  new Date(Math.min(...Object.values(paths).map((f) => fs.statSync(f).mtimeMs))).toISOString();

const argv = (paths, out, extra = []) => [
  "--pr-capture", paths["pr.json"],
  "--reviews", paths["reviews.json"],
  "--comments", paths["comments.json"],
  "--threads", paths["threads.json"],
  "--fetched-at", fetchedAt(paths),
  "--out", out,
  ...extra,
];

function built(o = {}) {
  const f = fixture(o);
  const out = path.join(f.dir, "snapshot.json");
  main(argv(f.paths, out));
  return { ...f, out, snapshot: JSON.parse(fs.readFileSync(out, "utf8")) };
}

test("everything about the pull request comes from the captured `get`, not from a flag", () => {
  // The first version took --head/--base/--title as flags, which left the two
  // shas that decide artifact size, territory and plan-file discovery in the
  // hand-typed category this file exists to abolish. A wrong-but-real base sha
  // passes the generator's endpoint check and then describes a different diff.
  // (Codex, #45 round 1.)
  const { snapshot, cleanup } = built();
  assert.equal(snapshot.repo, REPO);
  assert.equal(snapshot.pr.number, 43);
  assert.equal(snapshot.pr.base.sha, PR.base.sha);
  assert.equal(snapshot.pr.head.sha, PR.head.sha);
  assert.equal(snapshot.pr.body, PR.body);
  assert.equal(snapshot.reviewThreads[0].id, "PRRT_kwDOUKOPKc6fxvRx");
  // The comment id is DERIVED from the captured URL: GitHub's thread payload
  // gives `#discussion_r<id>` and no separate field, and no number enters a
  // snapshot except by program.
  assert.equal(snapshot.reviewThreads[0].comments[0].id, 3946356594);
  assert.doesNotThrow(() => assertCaptureProvenance(snapshot));
  cleanup();
});

test("a `get` capture missing a field the artifact depends on is refused, not defaulted", () => {
  for (const drop of ["number", "title", "created_at", "body"]) {
    const pr = { ...PR };
    delete pr[drop];
    const { dir, paths, cleanup } = fixture({ pr });
    assert.throws(() => main(argv(paths, path.join(dir, "s.json"))), new RegExp(`has no ${drop}`));
    cleanup();
  }
  const { dir, paths, cleanup } = fixture({ pr: { ...PR, base: { ref: "main", repo } } });
  assert.throws(() => main(argv(paths, path.join(dir, "s.json"))), /has no base\.sha/);
  cleanup();
});

test("a snapshot with no captureProvenance is refused, because nothing establishes its source", () => {
  assert.throws(() => assertCaptureProvenance({ reviews: [] }), /no `captureProvenance`/);
});

test("every verified collection must list its capture files", () => {
  const entry = { files: [{ file: "/x", sha256: "0", source: "agent-written" }], capturedAt: "2026-09-07T00:00:00Z" };
  const all = () => Object.fromEntries(VERIFIED_COLLECTIONS.map((k) => [k, structuredClone(entry)]));
  // The shape pass runs across ALL collections before any file is opened:
  // otherwise the refusal you get depends on which filesystem error came
  // first, and a snapshot naming no source for `reviewThreads` reports an
  // unreadable `pr` capture instead.
  for (const key of VERIFIED_COLLECTIONS) {
    const prov = all();
    delete prov[key];
    if (OPTIONAL_COLLECTIONS.includes(key)) {
      // Absent is a legitimate shape for the optional capture -- it is what a
      // round-check-only snapshot looks like, and the generator refuses that
      // one by name rather than reading it as zero findings. (It still fails
      // further down on the unreadable fixture path, which is not this
      // assertion's subject.)
      assert.throws(
        () => assertCaptureProvenance({ captureProvenance: prov }),
        (e) => !/must list the capture file/.test(e.message),
      );
    } else {
      assert.throws(
        () => assertCaptureProvenance({ captureProvenance: prov }),
        new RegExp(`captureProvenance\\.${key} must list the capture file`),
      );
    }
    // Present-but-empty is NOT the same as absent: a collection that names
    // itself and then lists nothing is a hole, not an omission.
    const empty = all();
    empty[key].files = [];
    assert.throws(
      () => assertCaptureProvenance({ captureProvenance: empty }),
      new RegExp(`captureProvenance\\.${key} must list the capture file`),
    );
  }
  const noSha = all();
  noSha.reviews.files = [{ file: "/x" }];
  assert.throws(
    () => assertCaptureProvenance({ captureProvenance: noSha }),
    /files\[0\] must name a file and its sha256/,
  );
});

test("a capture that no longer exists, or no longer hashes the same, establishes nothing", () => {
  const { paths, snapshot, cleanup } = built();
  fs.writeFileSync(paths["reviews.json"], JSON.stringify([...REVIEWS, { id: 1 }]));
  assert.throws(() => assertCaptureProvenance(snapshot), /reviews\.json now hashes to/);
  fs.rmSync(paths["reviews.json"]);
  assert.throws(() => assertCaptureProvenance(snapshot), /cannot be read \(ENOENT\)/);
  cleanup();
});

test("a snapshot edited after assembly is refused, identifiers unchanged", () => {
  // THE FINDING THAT REPLACED THE IDENTIFIER CHECK. Flipping `isResolved`,
  // rewriting a body, or moving a comment onto a different thread leaves every
  // id exactly where it was in the capture -- and a stale `isResolved` already
  // produced a wrong verdict on #43 once. (Codex, #45 round 1.)
  const { snapshot, cleanup } = built();
  const edited = structuredClone(snapshot);
  edited.reviewThreads[0].isResolved = true;
  assert.throws(() => assertCaptureProvenance(edited), /is not what its own captures derive: reviewThreads differ/);

  const reworded = structuredClone(snapshot);
  reworded.reviewThreads[0].comments[0].body = "a paraphrase of the reviewer";
  assert.throws(() => assertCaptureProvenance(reworded), /reviewThreads differ/);

  // And the same for the PR object, whose shas decide the artifact diff.
  const rebased = structuredClone(snapshot);
  rebased.pr.base.sha = "0000000000000000000000000000000000000000";
  assert.throws(() => assertCaptureProvenance(rebased), /is not what its own captures derive: pr differ/);

  // An invented thread is caught by the same rule rather than by a search --
  // this is the 2026-09-07 fabrication, well-formed and self-consistent.
  const invented = structuredClone(snapshot);
  invented.reviewThreads.push({
    id: "PRRT_kwDOUKOPKc6fxwZ1",
    isResolved: false,
    isOutdated: false,
    path: null,
    line: null,
    comments: [],
  });
  assert.throws(() => assertCaptureProvenance(invented), /reviewThreads differ/);
  cleanup();
});

test("a numeric id that is merely a substring of the capture no longer passes", () => {
  // `text.includes("234")` was satisfied by a capture containing only 12345,
  // and `"0"` by almost any response. Structural equality has no such notion.
  // (Codex, #45 round 1, P2.)
  const { snapshot, cleanup } = built();
  const substring = structuredClone(snapshot);
  substring.reviews = [{ ...REVIEWS[0], id: 512796 }];
  assert.throws(() => assertCaptureProvenance(substring), /reviews differ/);
  cleanup();
});

test("capture times come from the files, not from the clock at assembly", () => {
  // A capture fetched hours earlier and assembled now was stamped `now`, so it
  // satisfied the round check's one-hour bound and appeared to postdate a
  // reviewer pass it predated. (Codex, #45 round 1.)
  const { paths, snapshot, cleanup } = built();
  // These fixtures are agent-written, so the recorded time is the DECLARED
  // fetch, and the provenance says so rather than passing it off as measured.
  const declared = fetchedAt(paths);
  for (const key of VERIFIED_COLLECTIONS) {
    assert.equal(snapshot.capturedAt[key], declared);
    assert.equal(snapshot.captureProvenance[key].files[0].capturedAtSource, "declared");
    assert.equal(snapshot.captureProvenance[key].files[0].capturedAt, declared);
  }
  // Not the invocation time: assembling later must not refresh the evidence.
  assert.ok(Date.parse(declared) <= Date.now());
  cleanup();
});

test("an inline capture must declare when GitHub was read; a harness capture must not", () => {
  // mtime is the SAVE time for a blob an agent wrote out, and the gap to the
  // fetch is invisible to this program -- a response fetched hours earlier but
  // saved just now would pass the freshness gate while missing a reviewer
  // pass. So it is declared, and bounded on both sides. (Codex, #45 round 2.)
  const { dir, paths, cleanup } = fixture();
  const full = argv(paths, path.join(dir, "s.json"));
  const i = full.indexOf("--fetched-at");
  const without = [...full.slice(0, i), ...full.slice(i + 2)];
  assert.throws(() => main(without), /Pass --fetched-at <iso> with the time of the fetch/);

  // Later than the save is the unsafe direction and is refused: nothing is
  // saved before it is fetched.
  const later = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.throws(() => main([...without, "--fetched-at", later]), /is later than .*mtime/);

  // Earlier is the SAFE direction -- both gates mean "not older than", so an
  // over-old claim only refuses work -- but a mistyped date is not a claim.
  const ancient = new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString();
  assert.throws(() => main([...without, "--fetched-at", ancient]), /by more than a day/);
  assert.throws(() => main([...without, "--fetched-at", "last tuesday"]), /is not a parseable date/);
  cleanup();

  // A MIXED BATCH IS THE NORMAL BATCH: on a loop with rounds behind it the
  // threads payload spills to disk while the smaller responses come back
  // inline. A harness capture ignores the declaration and keeps its measured
  // mtime; refusing the declaration outright made this case unassemblable,
  // which is a refusal with no remedy. (Found running it, not by review.)
  const hdir = fs.mkdtempSync(path.join(os.tmpdir(), "hc-"));
  const nested = path.join(hdir, ".claude", "projects", "p", "s", "tool-results");
  fs.mkdirSync(nested, { recursive: true });
  const hfile = path.join(nested, "mcp-github-threads.txt");
  fs.writeFileSync(hfile, JSON.stringify(THREADS));
  assert.equal(captureSource(hfile), "harness-capture");
  const f2 = fixture();
  const out2 = path.join(f2.dir, "s.json");
  const withHarness = [...argv(f2.paths, out2)];
  withHarness[withHarness.indexOf("--threads") + 1] = hfile;
  main(withHarness);
  const mixed = JSON.parse(fs.readFileSync(out2, "utf8"));
  assert.equal(mixed.captureProvenance.reviewThreads.files[0].source, "harness-capture");
  assert.equal(mixed.captureProvenance.reviewThreads.files[0].capturedAtSource, "file-mtime");
  assert.equal(mixed.captureProvenance.reviews.files[0].capturedAtSource, "declared");
  // The measurement wins: the declaration did not overwrite the harness time.
  assert.equal(
    mixed.capturedAt.reviewThreads,
    new Date(fs.statSync(hfile).mtimeMs).toISOString(),
  );
  assert.doesNotThrow(() => assertCaptureProvenance(mixed));
  fs.rmSync(hdir, { recursive: true, force: true });
  f2.cleanup();
});

test("a collection's capture time is its OLDEST page", () => {
  const { dir, paths, cleanup } = fixture();
  const second = path.join(dir, "reviews-2.json");
  fs.writeFileSync(second, JSON.stringify([]));
  const earlier = new Date(Date.now() - 30 * 60 * 1000);
  fs.utimesSync(paths["reviews.json"], earlier, earlier);
  const out = path.join(dir, "s.json");
  main([...argv(paths, out), "--reviews", second]);
  const snap = JSON.parse(fs.readFileSync(out, "utf8"));
  // Both gates that read this mean "not older than", so a fresh final page
  // must not be able to carry a stale first one past them. Read the mtime back
  // rather than trusting the Date passed to utimes: the filesystem's
  // resolution is its own, and the assertion is about what the tool saw.
  const backdated = new Date(fs.statSync(paths["reviews.json"]).mtimeMs).toISOString();
  assert.equal(snap.capturedAt.reviews, backdated);
  assert.equal(snap.captureProvenance.reviews.files.length, 2);
  assert.equal(snap.captureProvenance.reviews.files[1].capturedAt, backdated);
  cleanup();
});

test("a full page is never attested complete on its own", () => {
  // `complete: true` is an attestation the generator trusts absolutely, and a
  // page of exactly 100 may have a successor. (Codex, #45 round 1.)
  const page = Array.from({ length: 100 }, (_, i) => ({ id: i, html_url: `${U}#pullrequestreview-${i}` }));
  const { dir, paths, cleanup } = fixture({ reviews: page });
  assert.throws(
    () => main(argv(paths, path.join(dir, "s.json"))),
    /holds 100 entries, which is GitHub's page maximum/,
  );
  // A short following page proves the end and is accepted.
  const second = path.join(dir, "reviews-2.json");
  fs.writeFileSync(second, JSON.stringify([{ id: 100 }]));
  const out = path.join(dir, "s.json");
  main([...argv(paths, out), "--reviews", second]);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).reviews.length, 101);
  cleanup();
});

test("a threads capture with no review_threads array is refused, not read as a clean round", () => {
  // An API error object or an old snapshot format became zero threads, and
  // zero threads is indistinguishable from a round that found nothing.
  // (Codex, #45 round 1.)
  for (const bad of [{ message: "Not Found" }, [], { review_threads: null }]) {
    const { dir, paths, cleanup } = fixture({ threads: bad });
    assert.throws(() => main(argv(paths, path.join(dir, "s.json"))), /carries no review_threads array/);
    cleanup();
  }
});

test("the end of the thread list must be STATED by the last page, not merely uncontradicted", () => {
  const { dir, paths, cleanup } = fixture({ threads: { ...THREADS, pageInfo: { hasNextPage: true } } });
  assert.throws(
    () => main(argv(paths, path.join(dir, "s.json"))),
    /does not state pageInfo\.hasNextPage: false \(it is true\)/,
  );
  // With the next page supplied, the earlier page's flag is no longer the end
  // of the story.
  const second = path.join(dir, "threads-2.json");
  fs.writeFileSync(second, JSON.stringify({ totalCount: 1, pageInfo: { hasNextPage: false }, review_threads: [] }));
  const out = path.join(dir, "s.json");
  main([...argv(paths, out), "--threads", second]);
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).reviewThreads.length, 1);
  cleanup();

  // ABSENCE OF A CLAIM IS NOT A CLAIM. `pageInfo?.hasNextPage` read as falsy
  // accepted a payload carrying no pageInfo at all -- a hand-trimmed capture,
  // or an older tool's shape -- as a proven terminal page. (Codex, #45 round 2.)
  const f2 = fixture({ threads: { totalCount: 1, review_threads: THREADS.review_threads } });
  assert.throws(
    () => main(argv(f2.paths, path.join(f2.dir, "s.json"))),
    /does not state pageInfo\.hasNextPage: false \(it is null\)/,
  );
  f2.cleanup();
});

test("a thread list shorter than its own totalCount is refused", () => {
  // `{ totalCount: 250, review_threads: [] }` satisfied every other check and
  // became a complete zero-thread round -- the shape that produces a stop
  // verdict on a loop that is not finished. (Codex, #45 round 2.)
  const { dir, paths, cleanup } = fixture({
    threads: { totalCount: 250, pageInfo: { hasNextPage: false }, review_threads: [] },
  });
  assert.throws(
    () => main(argv(paths, path.join(dir, "s.json"))),
    /hold 0 thread\(s\) but the payload reports totalCount 250/,
  );
  cleanup();

  // A payload that does not carry totalCount is not refused for lacking it:
  // this reconciles a number the response supplies, it does not demand one.
  const f2 = fixture({ threads: { pageInfo: { hasNextPage: false }, review_threads: THREADS.review_threads } });
  const out = path.join(f2.dir, "s.json");
  main(argv(f2.paths, out));
  assert.equal(JSON.parse(fs.readFileSync(out, "utf8")).reviewThreads.length, 1);
  f2.cleanup();
});

test("a capture's source is derived from its path, never taken from the file", () => {
  // The real layout, from the path this session's own oversized results land
  // in: `projects/<project>/<session>/tool-results/`.
  assert.equal(
    captureSource("/root/.claude/projects/-home-user-Overhypeme/badfaaa0-24b8/tool-results/mcp-github-x.txt"),
    "harness-capture",
  );
  assert.equal(captureSource("/tmp/scratch/threads.json"), "agent-written");
  // A relative path is resolved first, so the classification cannot be changed
  // by where the command was run from.
  assert.equal(captureSource("./threads.json"), "agent-written");
  // "tool-results" outside the harness layout is not the harness layout.
  assert.equal(captureSource("/tmp/tool-results/x.txt"), "agent-written");

  const { snapshot, cleanup } = built();
  for (const key of VERIFIED_COLLECTIONS) {
    // These fixtures are written by the test, so they classify honestly as the
    // weaker case rather than as harness captures.
    assert.equal(snapshot.captureProvenance[key].files[0].source, "agent-written");
  }
  // Claiming the stronger provenance for an agent-written file is refused: the
  // point of the field is that it reports what happened, not what the writer
  // would prefer to have happened.
  const lying = structuredClone(snapshot);
  lying.captureProvenance.reviews.files[0].source = "harness-capture";
  assert.throws(
    () => assertCaptureProvenance(lying),
    /records source "harness-capture" for .*, but that path is a agent-written/,
  );
  cleanup();
});

test("a capture named by a relative path is recorded absolutely", () => {
  // The generator verifies a snapshot from the repository root, not from
  // wherever the captures happened to sit when the assembler ran. Recording
  // `reviews.json` verbatim made the check report a missing capture in every
  // directory but one. (Found running this against #43's real captures.)
  const { dir, paths, cleanup } = fixture();
  const out = path.join(dir, "snapshot.json");
  const cwd = process.cwd();
  process.chdir(dir);
  try {
    main(argv(Object.fromEntries(Object.keys(paths).map((k) => [k, `./${k}`])), out));
  } finally {
    process.chdir(cwd);
  }
  const snap = JSON.parse(fs.readFileSync(out, "utf8"));
  for (const key of VERIFIED_COLLECTIONS) {
    assert.equal(path.isAbsolute(snap.captureProvenance[key].files[0].file), true);
  }
  assert.doesNotThrow(() => assertCaptureProvenance(snap));
  cleanup();
});

test("a capture that is not JSON, and a missing flag, are refusals rather than holes", () => {
  const { dir, paths, cleanup } = fixture();
  fs.writeFileSync(paths["comments.json"], "Error: result exceeds maximum allowed tokens");
  assert.throws(() => main(argv(paths, path.join(dir, "s.json"))), /comments\.json is not JSON/);
  cleanup();

  const f2 = fixture();
  const full = argv(f2.paths, path.join(f2.dir, "s.json"));
  const i = full.indexOf("--reviews");
  assert.throws(() => main([...full.slice(0, i), ...full.slice(i + 2)]), /--reviews is required/);
  assert.throws(() => main([...full, "--pr-capture", f2.paths["pr.json"]]), /--pr-capture takes exactly one file/);
  f2.cleanup();
});

test("flagValues collects repeats in order and refuses a flag with no value", () => {
  assert.deepEqual(flagValues(["--reviews", "a", "--reviews", "b", "--out", "c"], "reviews"), ["a", "b"]);
  assert.deepEqual(flagValues(["--out", "c"], "reviews"), []);
  assert.throws(() => flagValues(["--reviews", "--out", "c"], "reviews"), /--reviews needs a path/);
  assert.throws(() => flagValues(["--reviews"], "reviews"), /--reviews needs a path/);
});

test("diffKeys names every top-level key that differs, in both directions", () => {
  assert.deepEqual(diffKeys({ a: 1, b: 2 }, { a: 1, b: 3 }), ["b"]);
  assert.deepEqual(diffKeys({ a: 1 }, { a: 1, extra: true }), ["extra"]);
  assert.deepEqual(diffKeys({ a: 1 }, null), ["a"]);
  assert.deepEqual(diffKeys({ a: [1, 2] }, { a: [1, 2] }), []);
  assert.equal(digest("x"), digest("x"));
  assert.notEqual(digest("x"), digest("y"));
});

test("omitting --threads builds a round-check-only snapshot the generator refuses", () => {
  // Captures small enough to return inline have to be written out by hand, and
  // a threads payload carrying a loop's own replies is the largest of them. The
  // round check reads `pr`, `reviews` and `issueComments` and nothing else, so
  // demanding threads for it would make the honest path the expensive one --
  // and an expensive discipline is the one that gets skipped.
  const { dir, paths, cleanup } = fixture();
  const out = path.join(dir, "round-check.json");
  const full = argv(paths, out);
  const i = full.indexOf("--threads");
  const line = main([...full.slice(0, i), ...full.slice(i + 2)]);
  assert.match(line, /NO THREADS -- round-check-only/);

  const snap = JSON.parse(fs.readFileSync(out, "utf8"));
  // The omission is total: no empty array anywhere for something to read as a
  // clean round, and no completeness attestation for it either.
  assert.equal("reviewThreads" in snap, false);
  assert.equal("reviewThreads" in snap.complete, false);
  assert.equal("reviewThreads" in snap.captureProvenance, false);
  assert.equal("reviewThreads" in snap.capturedAt, false);
  assert.deepEqual(Object.keys(snap.complete), ["reviews", "issueComments"]);
  assert.doesNotThrow(() => assertCaptureProvenance(snap));

  // ...and it is fail-CLOSED: the shared completeness gate refuses it by name,
  // so it can never reach a judge as a round that found nothing.
  assert.throws(
    () => assertMcpSnapshotComplete(snap),
    /complete\.reviewThreads must be explicitly true/,
  );

  // Adding threads back to the snapshot without adding the capture is caught
  // by structural equality, not waved through as an optional field.
  const smuggled = structuredClone(snap);
  smuggled.reviewThreads = [];
  smuggled.complete.reviewThreads = true;
  assert.throws(() => assertCaptureProvenance(smuggled), /is not what its own captures derive/);
  cleanup();
});
