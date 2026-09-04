// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  assertAdjudicationSnapshot,
  artifactDiff,
  buildRecord,
  cappedDiff,
  PATCH_CAP_CHARS,
} from "../review-loop-record.mjs";

// The payload no longer knows one repo's name; tests declare their own.
const TEST_SLUG = "TestOwner/TestRepo";

// ---------------------------------------------------------------------------
// assertAdjudicationSnapshot: the evidence-freshness gate added in PR #539
// round 3 -- a record's own analysis is only as current as the issueComments
// it actually read, so that capture time must be present and parseable
// before anything downstream trusts it.
// ---------------------------------------------------------------------------

const validSnapshot = () => ({
  pr: { number: 500, head: { repo: TEST_SLUG } },
  repo: TEST_SLUG,
  issueComments: [],
  complete: { issueComments: true },
  capturedAt: { issueComments: "2026-08-19T21:00:00Z" },
});

test("assertAdjudicationSnapshot: a snapshot with no capturedAt.issueComments is rejected", () => {
  const snap = validSnapshot();
  delete snap.capturedAt;
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /parseable capturedAt\.issueComments/);
});

test("assertAdjudicationSnapshot: an unparseable capturedAt.issueComments is rejected", () => {
  const snap = validSnapshot();
  snap.capturedAt.issueComments = "not a date";
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /parseable capturedAt\.issueComments/);
});

test("assertAdjudicationSnapshot: a well-formed snapshot passes", () => {
  assert.doesNotThrow(() => assertAdjudicationSnapshot(500, validSnapshot(), TEST_SLUG));
});

// ---------------------------------------------------------------------------
// buildRecord: evidenceCapturedAt and budget.ambiguous, exercised end to end
// against a minimal but real MCP snapshot shape (review-counting.mjs's own
// assertions run inside fromMcp -- constructing a fixture that satisfies
// them for real is worth more than hand-guessing the shape).
// ---------------------------------------------------------------------------

const minimalSnapshot = ({ issueComments = [], reviews = [] } = {}) => ({
  pr: { number: 500, title: "test", created_at: "2026-08-01T00:00:00Z", closed_at: null, head: { sha: null, repo: TEST_SLUG } },
  repo: TEST_SLUG,
  reviews,
  files: [],
  reviewThreads: [],
  issueComments,
  complete: { reviews: true, files: true, reviewThreads: true, issueComments: true },
  capturedAt: { issueComments: "2026-08-19T21:00:00Z" },
});

// `loadLoop` needs a real io/filesystem; buildRecord only needs its RETURN
// shape, so a minimal valid budgetState is constructed directly rather than
// exercising the guard's own file discovery here (that's review-budget.test.mjs's job).
const minimalBudgetState = () => ({
  tier: "product",
  budget: { budget: 3, criticality: 10, artifact: "x" },
  extensions: [],
  nextSeq: 1,
});

test("buildRecord: evidenceCapturedAt is the snapshot's own issueComments capture time, not generatedAt", () => {
  const snapshot = minimalSnapshot();
  const record = buildRecord({
    pr: 500,
    snapshot,
    derived: { pr: snapshot.pr, reviews: [], files: [], comments: [], issueComments: [] },
    budgetState: minimalBudgetState(),
    changes: { resolved: false, reason: "test -- no diff needed for this assertion" },
    now: "2026-08-19T22:00:00Z", // deliberately LATER than the snapshot's capture time
  });
  assert.equal(record.evidenceCapturedAt, "2026-08-19T21:00:00Z");
  assert.equal(record.generatedAt, "2026-08-19T22:00:00Z");
  assert.notEqual(record.evidenceCapturedAt, record.generatedAt);
});

test("buildRecord: budget.ambiguous is threaded through from countRounds, not silently dropped", () => {
  // A trigger comment and the last completed pass sharing the exact same
  // second is what countRounds flags ambiguous -- construct that shape
  // directly via issueComments/reviews rather than re-deriving countRounds'
  // own logic here.
  const tie = "2026-08-19T20:00:00Z";
  const snapshot = minimalSnapshot({
    issueComments: [{ user: { login: "someone" }, body: "@codex review", created_at: tie }],
    reviews: [
      {
        user: { login: "chatgpt-codex-connector" },
        body: "**Reviewed commit:** `aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa`",
        submitted_at: tie,
      },
    ],
  });
  const record = buildRecord({
    pr: 500,
    snapshot,
    derived: {
      pr: snapshot.pr,
      reviews: snapshot.reviews,
      files: [],
      comments: [],
      issueComments: snapshot.issueComments,
    },
    budgetState: minimalBudgetState(),
    changes: { resolved: false, reason: "test -- no diff needed for this assertion" },
    now: "2026-08-19T22:00:00Z",
  });
  assert.equal(record.budget.ambiguous, true);
  // And the non-ambiguous case doesn't regress: a request answered well
  // before generation reports ambiguous: false.
  const clean = buildRecord({
    pr: 500,
    snapshot: minimalSnapshot(),
    derived: { pr: snapshot.pr, reviews: [], files: [], comments: [], issueComments: [] },
    budgetState: minimalBudgetState(),
    changes: { resolved: false, reason: "test" },
    now: "2026-08-19T22:00:00Z",
  });
  assert.equal(clean.budget.ambiguous, false);
});

test("the record's repository must be supplied by the caller, never defaulted", () => {
  // It defaulted to `repoSlug()` -- the working tree -- and the record itself
  // carried no repository at all, so a spoofed identity paired with a
  // same-numbered fork or mirror produced evidence the adjudicator would rule
  // on as if it were this loop's. The caller now passes the identity out of
  // the durable budget, and the record records it. (Codex, PR #7 round 8.)
  assert.throws(
    () => assertAdjudicationSnapshot(500, validSnapshot()),
    /must be supplied by the caller, from the durable budget/,
    "no working-tree fallback",
  );
  for (const bad of [null, "", "   "]) {
    assert.throws(() => assertAdjudicationSnapshot(500, validSnapshot(), bad), /must be supplied by the caller/);
  }
  // And a snapshot for a different repository is refused against it.
  assert.throws(
    () => assertAdjudicationSnapshot(500, validSnapshot(), "Someone/Else"),
    /Someone\/Else/,
  );
});

// ---------------------------------------------------------------------------
// cappedDiff / artifactDiff: the adjudicator's view of the artifact.
//
// None of this had a test before #12, which is how the defect below survived:
// the cap is applied to a lexicographically-ordered diff, `.agents/` sorts
// ahead of almost every implementation path, and a loop commits its own
// records AS IT RUNS. So by the time an adjudication is dispatched -- which
// only happens after several rounds -- the retained prefix is the loop's own
// bookkeeping and the code the findings are about has fallen off the end.
// Measured on PR #10: a 242,289-char diff capped to 60,000, with
// `+++ b/.claude/settings.json` absent entirely, and two verdicts withdrawn
// because of it.
// ---------------------------------------------------------------------------

const EXCLUDE_PREFIX = ":(exclude,literal)";

/**
 * A git stand-in that actually honours exclude pathspecs, so these tests
 * prove the implementation ASKS for the right thing rather than merely
 * post-filtering text it already fetched.
 */
function fakeGit(files) {
  const names = files.map((f) => f.name);
  return (args) => {
    if (args.includes("--name-only")) return `${names.join("\0")}\0`;
    const excluded = new Set(
      args.filter((a) => a.startsWith(EXCLUDE_PREFIX)).map((a) => a.slice(EXCLUDE_PREFIX.length)),
    );
    return files
      .filter((f) => !excluded.has(f.name))
      .map((f) => `diff --git a/${f.name} b/${f.name}\n+++ b/${f.name}\n${f.body}\n`)
      .join("");
  };
}

/** A record big enough to consume the whole cap on its own. */
const fatRecord = (name) => ({ name, body: "R".repeat(PATCH_CAP_CHARS + 5_000) });

test("a record large enough to fill the cap no longer hides the implementation", () => {
  const runGit = fakeGit([
    fatRecord(".agents/adjudications/10-1.json"),
    { name: ".claude/settings.json", body: "-  relative\n+  absolute" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  // The regression, stated as the thing that actually went wrong.
  assert.ok(
    patch.includes("+++ b/.claude/settings.json"),
    "the implementation file must survive a record that would otherwise eat the entire cap",
  );
  assert.ok(patch.includes("+  absolute"), "and its hunk body, not just its header");
  assert.ok(
    !patch.includes(".agents/adjudications/10-1.json\n+++"),
    "while the record's own content is gone rather than merely reordered",
  );
});

test("excluded records are announced -- never silently dropped", () => {
  const runGit = fakeGit([
    { name: ".agents/adjudications/10-1.json", body: "x" },
    { name: ".agents/receipts/loop-budget-10.json", body: "y" },
    { name: "core/scripts/pr-ready.mjs", body: "z" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.match(patch, /excluded 2 generated record file/);
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});

test("a diff with no records is untouched, and gains no spurious note", () => {
  const runGit = fakeGit([{ name: "core/scripts/pr-ready.mjs", body: "z" }]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(!/excluded \d+ generated record/.test(patch), "no note when nothing was excluded");
  assert.ok(!patch.includes("TRUNCATED"), "and no truncation note when it fits");
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});

test("truncation is still announced when the filtered diff is itself over the cap", () => {
  const runGit = fakeGit([
    { name: ".agents/receipts/loop-budget-10.json", body: "r" },
    { name: "core/big.mjs", body: "C".repeat(PATCH_CAP_CHARS + 100) },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.match(patch, /TRUNCATED at 60000 chars/, "the existing truncation notice still fires");
  assert.match(patch, /excluded 1 generated record file/, "and both notices coexist");
});

test("records are excluded even when the diff would have fit -- they are not the artifact", () => {
  const runGit = fakeGit([
    { name: ".agents/adjudications/10-1.json", body: "x" },
    { name: "CLAUDE.md", body: "y" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(!patch.includes("10-1.json"), "consistent regardless of size");
  assert.ok(patch.includes("+++ b/CLAUDE.md"));
});

test("a git failure still reports unavailable rather than throwing", () => {
  const patch = cappedDiff(() => {
    throw new Error("no such ref");
  }, "base...head");
  assert.match(patch, /\[unavailable/);
});

test("artifactDiff still refuses without both endpoints", () => {
  assert.match(artifactDiff(null, "head"), /\[unavailable/);
  assert.match(artifactDiff("base", null), /\[unavailable/);
});

test("artifactDiff passes the three-dot range through and filters records", () => {
  let seenRange = null;
  const inner = fakeGit([
    { name: ".agents/receipts/loop-budget-10.json", body: "r" },
    { name: "core/scripts/pr-ready.mjs", body: "z" },
  ]);
  const runGit = (args) => {
    if (!args.includes("--name-only")) seenRange = args.find((a) => a.includes("..."));
    return inner(args);
  };

  const patch = artifactDiff("base", "head", { runGit });

  assert.equal(seenRange, "base...head", "three-dot, so a base-branch merge is not dragged in");
  assert.match(patch, /excluded 1 generated record file/);
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});
