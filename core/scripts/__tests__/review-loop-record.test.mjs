// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
import { test } from "node:test";
import assert from "node:assert/strict";

import {
  applyCaps,
  approvedPlanCommit,
  artifactDiff,
  assertCapturedAfterLatestPass,
  artifactFileList,
  artifactStats,
  assertAdjudicationSnapshot,
  assertArtifactEndpoints,
  assertCapturedProvenance,
  assertThreadProvenance,
  buildRecord,
  cappedDiff,
  declineCitationFor,
  findingsByTerritory,
  parseFrontmatter,
  planOracleFor,
  planReviewSignals,
  readAtCommit,
  sectionOf,
  planFilesIntroducedBy,
  PATCH_CAP_CHARS,
  RECORD_LINE_CAP_CHARS,
  RECORD_TOTAL_CAP_CHARS,
} from "../review-loop-record.mjs";

// The payload no longer knows one repo's name; tests declare their own.
const TEST_SLUG = "TestOwner/TestRepo";

// ---------------------------------------------------------------------------
// assertAdjudicationSnapshot: the evidence-freshness gate added in PR #539
// round 3 -- a record's own analysis is only as current as the issueComments
// it actually read, so that capture time must be present and parseable
// before anything downstream trusts it.
// ---------------------------------------------------------------------------

// Dated NOW, in every counted collection: the gate requires all four and
// applies the same age bound as the round check. (Codex, #38 round 8.)
const freshCapturedAt = () => {
  const now = new Date().toISOString();
  return { pr: now, reviews: now, issueComments: now, reviewThreads: now };
};
const validSnapshot = () => ({
  pr: { number: 500, head: { repo: TEST_SLUG } },
  repo: TEST_SLUG,
  issueComments: [],
  complete: { issueComments: true },
  capturedAt: freshCapturedAt(),
});

test("assertAdjudicationSnapshot: a snapshot with no capture time is rejected", () => {
  const snap = validSnapshot();
  delete snap.capturedAt;
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /missing capturedAt/);
});

test("assertAdjudicationSnapshot: every counted collection must be dated, not just issueComments", () => {
  // Round 7 closed this in the budget check and left this sibling consumer
  // on a single-collection check: a fresh issueComments beside undated reviews
  // and threads made an incomplete history look current. (Codex, #38 round 8.)
  const snap = validSnapshot();
  snap.capturedAt.issueComments = "not a date";
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /missing issueComments/);
  const partial = validSnapshot();
  partial.capturedAt = { issueComments: new Date().toISOString() };
  assert.throws(() => assertAdjudicationSnapshot(500, partial, TEST_SLUG), /missing pr, reviews, reviewThreads/);
});

test("assertAdjudicationSnapshot: a capture older than the round check would accept is refused", () => {
  const stale = validSnapshot();
  stale.capturedAt = { ...stale.capturedAt, reviews: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString() };
  assert.throws(() => assertAdjudicationSnapshot(500, stale, TEST_SLUG), /oldest capture time .* outside the 60-minute bound/);
  // The scalar form covers every collection with one time.
  const scalar = validSnapshot();
  scalar.capturedAt = new Date().toISOString();
  assert.doesNotThrow(() => assertAdjudicationSnapshot(500, scalar, TEST_SLUG));
});

test("assertAdjudicationSnapshot: a collection dated in the future is refused", () => {
  // Reporting only the oldest capture time let a future-dated collection
  // pass; it then became `evidenceCapturedAt`, and the merge fallback read
  // real requests posted after generation as already known.
  // (Codex, #38 round 9.)
  const snap = validSnapshot();
  snap.capturedAt.issueComments = new Date(Date.now() + 60 * 60 * 1000).toISOString();
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /dates issueComments in the future/);
});

test("threads and the request set must be captured after the latest completed pass", () => {
  // Reviews captured after a findings-bearing pass, threads captured before
  // it: fresh, complete, attested -- and that pass read as clean because its
  // threads were absent. Age alone cannot see it. (Codex, #38 round 9.)
  const passAt = "2026-09-06T18:34:22Z";
  const passes = [{ at: passAt, commit: "abc" }];
  const before = "2026-09-06T18:34:00.000Z";
  const after = "2026-09-06T18:34:25.000Z";
  assert.throws(
    () => assertCapturedAfterLatestPass({ capturedAt: { pr: after, reviews: after, issueComments: after, reviewThreads: before } }, passes),
    /reviewThreads was captured before the latest completed reviewer pass/,
  );
  assert.throws(
    () => assertCapturedAfterLatestPass({ capturedAt: { pr: after, reviews: after, issueComments: before, reviewThreads: before } }, passes),
    /reviewThreads and issueComments were captured before/,
  );
  // The END of the response's reported second is the boundary: a read in the
  // same second cannot be shown to postdate it.
  assert.throws(
    () => assertCapturedAfterLatestPass({ capturedAt: { pr: after, reviews: after, issueComments: after, reviewThreads: "2026-09-06T18:34:22.900Z" } }, passes),
    /reviewThreads was captured before/,
  );
  assert.doesNotThrow(() => assertCapturedAfterLatestPass({ capturedAt: { pr: after, reviews: after, issueComments: after, reviewThreads: after } }, passes));
  // A scalar capture time covers every collection; no passes means nothing to order against.
  assert.doesNotThrow(() => assertCapturedAfterLatestPass({ capturedAt: after }, passes));
  assert.doesNotThrow(() => assertCapturedAfterLatestPass({ capturedAt: { reviewThreads: before, issueComments: before } }, []));
  // An unparseable latest pass cannot anchor the check -- it refuses rather
  // than silently ordering nothing. (Codex, #38 round 11.)
  assert.throws(
    () => assertCapturedAfterLatestPass({ capturedAt: { reviewThreads: before, issueComments: before } }, [{ at: "whenever" }]),
    /unparseable timestamp/,
  );
});

test("assertAdjudicationSnapshot: every review's submitted_at must parse", () => {
  const snap = validSnapshot();
  snap.reviews = [{ id: 1, user: { login: "x" }, submitted_at: "not a time" }];
  assert.throws(() => assertAdjudicationSnapshot(500, snap, TEST_SLUG), /reviews\[0\] carries an unparseable submitted_at/);
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

  assert.ok(
    !patch.includes("+++ b/.agents/adjudications/10-1.json"),
    "its hunk is gone regardless of size -- the notice still names it, which is the point",
  );
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

// --- Round 1 of #14: two ways the first cut of this filter was too coarse ---

test("tracked scaffolding is NOT excluded -- it is synced payload, not a generated record", () => {
  // classifyPath calls every file under .agents/receipts and
  // .agents/adjudications a "record", but the sync DELIVERS three tracked
  // files into those directories. Excluding them would hide real contract
  // changes from the adjudicator and mislabel them as bookkeeping -- the same
  // blindness this filter exists to remove, pointed at a different target.
  // (Codex, #14 round 1.)
  const runGit = fakeGit([
    { name: ".agents/adjudications/README.md", body: "docs change" },
    { name: ".agents/receipts/README.md", body: "docs change" },
    { name: ".agents/receipts/.gitignore", body: "+loop-new-shape-*.json" },
    { name: ".agents/receipts/loop-budget-10.json", body: "generated" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(patch.includes("+++ b/.agents/receipts/.gitignore"), "the ignore rules are reviewable");
  assert.ok(patch.includes("+loop-new-shape-*.json"), "including their content");
  assert.ok(patch.includes("+++ b/.agents/receipts/README.md"));
  assert.ok(patch.includes("+++ b/.agents/adjudications/README.md"));
  assert.ok(
    !patch.includes("+++ b/.agents/receipts/loop-budget-10.json"),
    "while the generated receipt beside them still goes",
  );
  assert.match(patch, /excluded 1 generated record file/);
});

test("every shape the receipts README documents is recognised as generated", () => {
  const generated = [
    ".agents/receipts/pr-10.json",
    ".agents/receipts/loop-round-check-10.json",
    ".agents/receipts/loop-budget-10.json",
    ".agents/receipts/loop-extension-10-3.json",
    ".agents/adjudications/10-7.json",
  ];
  const runGit = fakeGit([
    ...generated.map((name) => ({ name, body: "g" })),
    { name: "core/scripts/pr-ready.mjs", body: "code" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  for (const name of generated) {
    assert.ok(!patch.includes(`+++ b/${name}`), `${name} should be excluded`);
  }
  assert.match(patch, /excluded 5 generated record files/);
  assert.ok(patch.includes("+++ b/core/scripts/pr-ready.mjs"));
});

test("a renamed record is excluded on BOTH sides, not just its destination", () => {
  // Discovery must disable rename detection. With it on, `--name-only`
  // reports only the destination; the old path then survives as a deletion
  // hunk and a large renamed record can consume the cap all over again.
  // (Codex, #14 round 1 -- verified against real git.)
  let sawNoRenames = false;
  const inner = fakeGit([
    { name: ".agents/adjudications/10-1.json", body: "old" },
    { name: ".agents/adjudications/10-2.json", body: "new" },
    { name: "CLAUDE.md", body: "code" },
  ]);
  const runGit = (args) => {
    if (args.includes("--name-only")) {
      sawNoRenames = args.includes("--no-renames");
      // Model git's DEFAULT behaviour if the flag is absent: destination only.
      if (!sawNoRenames) return ".agents/adjudications/10-2.json\0";
    }
    return inner(args);
  };

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(sawNoRenames, "discovery must pass --no-renames");
  assert.ok(
    !patch.includes("+++ b/.agents/adjudications/10-1.json"),
    "the rename SOURCE is excluded too",
  );
  assert.ok(
    !patch.includes("+++ b/.agents/adjudications/10-2.json"),
    "as is the destination",
  );
  assert.ok(patch.includes("+++ b/CLAUDE.md"));
});

test("the exclusion notice NAMES what it withheld, so the omission is auditable", () => {
  // An earlier draft pointed at "the numstat fields" for the list. `artifact`
  // carries only counts, and `sinceLastReview.files` covers a different range
  // and is empty exactly when the judge is dispatched -- so the notice was
  // sending a fresh-context reader somewhere there was nothing to find, in the
  // register of an assurance. (Codex, #14 round 1.)
  const runGit = fakeGit([
    { name: ".agents/receipts/loop-budget-10.json", body: "g" },
    { name: ".agents/adjudications/10-7.json", body: "g" },
    { name: "CLAUDE.md", body: "code" },
  ]);

  const patch = cappedDiff(runGit, "base...head");

  assert.ok(patch.includes(".agents/receipts/loop-budget-10.json"), "named, not merely counted");
  assert.ok(patch.includes(".agents/adjudications/10-7.json"));
  assert.ok(!/numstat/.test(patch), "and no longer points at a list that does not exist");
});

test("a pathological number of records is summarised rather than dumped", () => {
  const many = Array.from({ length: 20 }, (_, i) => ({
    name: `.agents/adjudications/10-${i + 1}.json`,
    body: "g",
  }));
  const runGit = fakeGit([...many, { name: "CLAUDE.md", body: "code" }]);

  const patch = cappedDiff(runGit, "base...head");
  const notice = patch.split("\n")[0];

  assert.match(notice, /excluded 20 generated record files/);
  assert.match(notice, /and 8 more/, "12 named, the remainder counted");
  assert.ok(patch.includes("+++ b/CLAUDE.md"));
});

// ---------------------------------------------------------------------------
// ONE git-derived source for size, territory and patch (#34 gap 2)
//
// The defect these cover, measured on #28 and #33: the snapshot's `files` was
// empty, `artifactSize` read it, and the record reported an artifact of zero
// files beside a 50 KB patch -- so `territory` said every finding was outside
// a diff that contained all of them. The fix is not a better check on that
// field; it is deriving the fact from the same range the patch comes from.
// ---------------------------------------------------------------------------

/** A numstat stand-in: records are `added\tremoved\tpath\0`. */
const numstatGit = (rows, { fail = null } = {}) => (args) => {
  if (fail && args.includes(fail)) throw new Error(`fake git: ${fail} unresolvable`);
  if (args.includes("--numstat")) return rows.map((r) => r.join("\t")).join("\0") + (rows.length ? "\0" : "");
  if (args[0] === "cat-file") return "";
  return "";
};

test("size excludes this machinery's own records; territory includes them", () => {
  const { files } = artifactFileList("base", "head", {
    runGit: numstatGit([
      ["9", "0", ".agents/receipts/loop-budget-37.json"],
      ["100", "5", "core/scripts/review-budget.mjs"],
      ["20", "1", "core/scripts/pr-ready.mjs"],
    ]),
  });
  const stats = artifactStats(files);
  assert.deepEqual(
    { files: stats.files, added: stats.added, removed: stats.removed, excluded: stats.excludedGeneratedRecords },
    { files: 2, added: 120, removed: 6, excluded: 1 },
    "the artifact is the code under review, not the loop's own bookkeeping",
  );
  // Territory classifies against the FULL set: a finding anchored on a receipt
  // this PR changed is still inside this PR's diff, and saying otherwise is
  // exactly the lie #34 gap 2 reported.
  const territory = findingsByTerritory(
    [{ path: ".agents/receipts/loop-budget-37.json" }, { path: "core/scripts/review-budget.mjs" }],
    files.map((f) => ({ filename: f.file })),
  );
  assert.deepEqual({ inDiff: territory.inDiff, outsideDiff: territory.outsideDiff }, { inDiff: 2, outsideDiff: 0 });
});

test("a binary change reports null counts and a binaryFiles count, never a false zero", () => {
  const { files } = artifactFileList("base", "head", {
    runGit: numstatGit([
      ["-", "-", "docs/img/diagram.png"],
      ["3", "0", "core/scripts/pr-ready.mjs"],
    ]),
  });
  const stats = artifactStats(files);
  assert.equal(files[0].added, null, "a binary file's line count is unknown, not zero");
  assert.deepEqual({ files: stats.files, added: stats.added, binaryFiles: stats.binaryFiles }, { files: 2, added: 3, binaryFiles: 1 });
});

test("a non-numeric, non-binary count refuses rather than coercing to zero", () => {
  assert.throws(
    () => artifactFileList("base", "head", { runGit: numstatGit([["?", "0", "a.ts"]]) }),
    /non-numeric, non-binary count/,
  );
});

test("a rename lands BOTH paths in the set, so a finding on either is inDiff", () => {
  // --no-renames is why: with rename detection on, git reports only the
  // destination and a finding anchored on the source classifies outside the
  // diff. The fake asserts the flag is actually asked for.
  let sawNoRenames = false;
  const runGit = (args) => {
    if (args.includes("--numstat")) {
      sawNoRenames = args.includes("--no-renames");
      return ["12\t0\tnew/path.mjs", "0\t12\told/path.mjs"].join("\t\0").replace("\t\0", "\0") + "\0";
    }
    return "";
  };
  const { files } = artifactFileList("base", "head", { runGit });
  assert.ok(sawNoRenames, "rename detection must be off, or the source path disappears");
  const paths = files.map((f) => f.file);
  assert.deepEqual(paths.sort(), ["new/path.mjs", "old/path.mjs"]);
});

test("a path with a space and a non-ASCII byte round-trips", () => {
  // -z is why: git's default output C-quotes such a path, and a quoted path
  // never equals the path a finding is anchored on.
  const { files } = artifactFileList("base", "head", {
    runGit: numstatGit([["1", "0", "docs/plans/PLAN — my plan.md"]]),
  });
  assert.equal(files[0].file, "docs/plans/PLAN — my plan.md");
});

test("an empty artifact against DISTINCT endpoints is allowed, and says so", () => {
  // A branch whose every change was reverted is legitimate and reachable, and
  // refusing it would block the tripwire and direct-stop flows that need a
  // record to close the loop at all. (Codex, #37 round 3.)
  const { files, emptyAgainstDistinctEndpoints } = artifactFileList("base", "head", { runGit: numstatGit([]) });
  assert.deepEqual(files, []);
  assert.equal(emptyAgainstDistinctEndpoints, true, "the state is marked, not refused");
});

test("both endpoints are validated before anything derives from the range", () => {
  const full = "a".repeat(40);
  assert.throws(() => assertArtifactEndpoints(null, full, { runGit: () => "" }), /carries no pr\.base\.sha/);
  assert.throws(
    () => assertArtifactEndpoints(full, full, { runGit: numstatGit([], { fail: "cat-file" }) }),
    /is not a resolvable commit/,
  );
});

// ---------------------------------------------------------------------------
// Reading payload at the reviewed commit, in either layout
// ---------------------------------------------------------------------------

/**
 * A git stand-in over a committed tree: `{ path: {mode, text} }`. The handbook
 * fixture stores a symlink whose blob is its target's path, exactly as
 * `git ls-tree` and `git show` report one.
 */
const treeGit = (tree) => (args) => {
  if (args[0] === "ls-tree") {
    const wanted = args[args.length - 1];
    const entry = tree[wanted];
    return entry ? `${entry.mode} blob deadbeef\t${wanted}\0` : "";
  }
  if (args[0] === "show") {
    const wanted = args[1].split(":").slice(1).join(":");
    if (!tree[wanted]) throw new Error(`fake git: no ${wanted}`);
    return tree[wanted].text;
  }
  return "";
};

const DEFINITION = ".claude/agents/review-loop-adjudicator.md";
const FRONTMATTER = "---\nname: review-loop-adjudicator\nmodel: best\neffort: xhigh\n---\n\nbody\n";

test("a head-pinned read follows the handbook's symlink into core/", () => {
  const runGit = treeGit({
    [DEFINITION]: { mode: "120000", text: "../../core/.claude/agents/review-loop-adjudicator.md" },
    "core/.claude/agents/review-loop-adjudicator.md": { mode: "100644", text: FRONTMATTER },
  });
  const read = readAtCommit("head", DEFINITION, { runGit });
  assert.equal(read.path, "core/.claude/agents/review-loop-adjudicator.md");
  assert.equal(read.followedLink, DEFINITION);
  assert.deepEqual(parseFrontmatter(read.text), { name: "review-loop-adjudicator", model: "best", effort: "xhigh" });
});

test("the same read works in an assembled consumer, where the path is an ordinary file", () => {
  const runGit = treeGit({ [DEFINITION]: { mode: "100644", text: FRONTMATTER } });
  const read = readAtCommit("head", DEFINITION, { runGit });
  assert.equal(read.path, DEFINITION);
  assert.equal(read.followedLink, null);
});

test("a consumer path absent entirely retries once under core/", () => {
  // The handbook has no `.agents/memory/…` at all -- the tracked source is
  // `core/.agents/memory/…`, so a bare `git show <sha>:<consumer path>` reads
  // nothing and the field would have been silently empty.
  const note = ".agents/memory/machinery-threat-model-is-my-own-mistakes.md";
  const runGit = treeGit({ [`core/${note}`]: { mode: "100644", text: "the threat model" } });
  const citation = declineCitationFor("internal", "head", { runGit });
  assert.equal(citation.text, "the threat model");
  assert.equal(citation.path, `core/${note}`);
});

test("a symlink escaping the repository is refused, not followed", () => {
  const runGit = treeGit({ [DEFINITION]: { mode: "120000", text: "../../../etc/passwd" } });
  assert.throws(() => readAtCommit("head", DEFINITION, { runGit }), /escapes the repository/);
});

test("a path resolving in neither layout refuses, naming both attempts", () => {
  assert.throws(() => readAtCommit("head", DEFINITION, { runGit: treeGit({}) }), /tried .*core\//s);
});

test("the decline citation is tier-selected, and degrades with a stated reason", () => {
  assert.equal(declineCitationFor("product", "head", { runGit: treeGit({}) }).text, null);
  // Absent in this repository: a stated null, not a refusal -- `memory` is a
  // separate sync group and requiring it would couple the machinery to most
  // of the handbook.
  const absent = declineCitationFor("internal", "head", { runGit: treeGit({}) });
  assert.equal(absent.text, null);
  assert.match(absent.reason, /unavailable at head/);
});

// ---------------------------------------------------------------------------
// The plan oracle, both modes
// ---------------------------------------------------------------------------

const PLAN = "docs/plans/PLAN_NEW.md";
const planText = "# Plan\n\n## Direction\nthe direction\n\n## Product Intent\nthe intent\n\n## Must Not Change\nthe invariants\n\n## Settled Decisions\n1. a decision\n";

const planGit = (introduced, text = planText) => (args) => {
  if (args[0] === "diff-tree") return introduced.join("\0") + (introduced.length ? "\0" : "");
  if (args[0] === "cat-file") return "";
  if (args[0] === "show") return text;
  return "";
};

test("a [PLAN REVIEW] loop reads its own plan at the head -- the deadlock #37 round 2 found", () => {
  // Without this mode the record refuses on every plan-review loop, because a
  // plan under review has no approved-plan source by definition. The loop then
  // cannot obtain the verdict it needs to continue OR stop.
  const oracle = planOracleFor(
    { title: "[PLAN REVIEW] something — DO NOT MERGE", body: "## Review mode\nPlan review only. Never merge." },
    "head",
    { runGit: planGit([PLAN]) },
  );
  assert.equal(oracle.mode, "plan-review");
  assert.deepEqual(oracle.sections, {
    Direction: "the direction",
    "Product Intent": "the intent",
    "Must Not Change": "the invariants",
    "Settled Decisions": "1. a decision",
  });
});

test("plan review needs BOTH defining signals, and refuses when they disagree", () => {
  const bodyOnly = { title: "Ordinary implementation PR", body: "## Review mode\nPlan review only." };
  assert.throws(() => planOracleFor(bodyOnly, "head", { runGit: planGit([PLAN]) }), /declares plan review in its body but not the other/);
  assert.equal(planReviewSignals(bodyOnly).isPlanReview, false);
});

test("a plan-review PR introducing no plan file refuses", () => {
  assert.throws(
    () => planOracleFor({ title: "[PLAN REVIEW] x — DO NOT MERGE", body: "## Review mode\nPlan review only." }, "head", { runGit: planGit([]) }),
    /must introduce exactly one/,
  );
});

test("the approved plan is the one the cited commit INTRODUCED, not the one file present", () => {
  // A repository may retain an older plan on main, which the loop permits. A
  // "exactly one file present" rule would then refuse every future plan.
  const body = "**Approved-plan source:** Plan-review PR #37, final plan commit abc1234, approved by David on 2026-09-06";
  const oracle = planOracleFor({ title: "Implement the thing", body }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.mode, "approved-plan");
  assert.equal(oracle.sha, "abc1234");
  assert.equal(oracle.path, PLAN);
});

test("a feature body with no approved-plan source REFUSES rather than nulling", () => {
  assert.throws(
    () => planOracleFor({ title: "Implement the thing", body: "## Summary\nsome prose" }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
});

// The two bugfix oracle blocks EXACTLY as core/.claude/skills/bugfix/SKILL.md
// specifies them -- :251-258 and :264-271 -- filled in. Transcribed from the
// document rather than recalled, and kept whole here so a change to either
// schema shows up as a failing test rather than as a matcher that silently
// stopped agreeing with the contract.
const TIER_B_ORACLE = [
  "**Fix tier:** B — Q2 fired (product-visible)",
  "**Reported symptom:** the retry double-charges",
  "**Intended correct behavior:** one charge per confirmed order",
  "**Must not change:** the refund path sharing this client",
  "**Root cause:** the retry wrapper re-enters before the idempotency key is set",
  "**Blast radius:** three callers, all checked",
].join("\n");
const TIER_C_ORACLE = [
  "**Fix tier:** C — trivial schema/migration fix, no plan",
  "**Reported symptom:** the column is nullable and should not be",
  "**Root cause:** the original migration omitted NOT NULL",
  "**Why this is trivial:** single-step, no data transformation, no behavior change",
  "**David's go-ahead:** confirmed in chat 2026-09-06",
  "**Migration ceremony checklist:** idempotent, counts observed, no destructive op",
].join("\n");

test("each permitted no-plan form yields a stated null", () => {
  const forms = [
    // The bugfix oracle is the block bugfix/SKILL.md actually specifies --
    // see the dedicated test below for why the imagined line is not it.
    [TIER_B_ORACLE, "bugfix oracle (tier B)"],
    [TIER_C_ORACLE, "bugfix oracle (tier C)"],
    ["**Approved-plan source:** n/a — no plan (trivial change)", "trivial change"],
    [
      "**Approved-plan source:** PLAN_X.md, shasum -a 256 3b1f8c2d9e4a7b6c5d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e, approved 2026-09-06",
      "private path",
    ],
  ];
  for (const [body, reason] of forms) {
    const oracle = planOracleFor({ title: "Implement the thing", body }, "head", { runGit: planGit([PLAN]) });
    assert.deepEqual({ mode: oracle.mode, reason: oracle.reason }, { mode: null, reason });
  }
});

// ---------------------------------------------------------------------------
// Provenance, bodies and caps
// ---------------------------------------------------------------------------

test("an oracle heading inside a fenced example is not the section", () => {
  // Plans and PR bodies quote oracle blocks in fenced examples --
  // `bugfix/SKILL.md` shows two — so a scanner blind to fences takes the
  // EXAMPLE and omits the real invariants below it. Same consequence as the
  // nested-heading bug: a verdict against an oracle that looks complete.
  // (Codex, #38 round 7.)
  const md = [
    "## Notes",
    "",
    "```markdown",
    "## Must Not Change",
    "the EXAMPLE invariant",
    "```",
    "",
    "## Must Not Change",
    "the REAL invariant",
    "",
    "## Next",
    "x",
  ].join("\n");
  assert.equal(sectionOf(md, "Must Not Change"), "the REAL invariant");

  // A fence that OPENS inside the section does not end it either.
  const inside = "## Must Not Change\nfirst\n\n```\n## Next\nnot a heading\n```\n\nlast\n\n## Next\nx";
  assert.equal(sectionOf(inside, "Must Not Change"), "first\n\n```\n## Next\nnot a heading\n```\n\nlast");

  // Tildes fence too, and a longer backtick run is not closed by a shorter one.
  assert.equal(sectionOf("~~~\n## A\n~~~\n\n## A\nreal", "A"), "real");
  assert.equal(sectionOf("````\n```\n## A\n````\n\n## A\nreal", "A"), "real");

  // And the round-1 nested-heading behaviour is unchanged.
  assert.match(sectionOf("## Must Not Change\nfirst\n\n### Security\nrule\n\n## Next\nx", "Must Not Change"), /### Security/);
});

test("both documented approved-plan provenance forms are accepted", () => {
  // The contract specifies TWO forms (claude-core.md:453-457), and the split
  // form names its PRs in the PLURAL — `Plan-review PRs #701 and #702` — which
  // `\bPR\s*#` cannot match. Every split loop therefore reported no approved-plan
  // source and could not run its mandatory adjudication. (Codex, #38 round 7.)
  assert.deepEqual(
    approvedPlanCommit("Plan-review PR #37, final plan commit `972b60d`, approved by David on 2026-09-06."),
    { sha: "972b60d", form: "single plan-review PR" },
  );
  assert.deepEqual(
    approvedPlanCommit(
      "Plan-review PRs #701 and #702, combined plan commit abcdef1 on plan-review/foo-combined, " +
        "approved by David on 2026-09-01",
    ),
    { sha: "abcdef1", form: "split loop (combined plan)" },
  );
  // The `-combined` branch is what makes the split form checkable: it is the
  // one branch this repository never deletes, because no PR retains its commit.
  assert.equal(
    approvedPlanCommit("Plan-review PRs #701 and #702, combined plan commit abcdef1, approved by David on 2026-09-01"),
    null,
  );
  // The two forms are not interchangeable adjectives.
  assert.equal(approvedPlanCommit("Plan-review PR #37, combined plan commit abcdef1, approved by David on 2026-09-06"), null);
  // "naming EVERY subsystem PR": the plural with one number is incomplete
  // provenance, not a variant. (Codex, #38 round 8.)
  assert.equal(
    approvedPlanCommit("Plan-review PRs #701, combined plan commit abcdef1 on plan-review/foo-combined, approved by David on 2026-09-01"),
    null,
  );
});

test("a fenced Review-mode example does not declare plan review", () => {
  // A process PR documenting the template shows `## Review mode / Plan review
  // only` inside a fence. Body-wide, that set the body signal, the ordinary
  // title left the title signal false, and the generator refused the PR as
  // half-declared -- a deadlock on a documentation PR. (Codex, #38 round 8.)
  const documenting = [
    "## Summary",
    "This documents the plan-review template:",
    "",
    "```markdown",
    "## Review mode",
    "Plan review only. Never merge.",
    "```",
  ].join("\n");
  assert.deepEqual(planReviewSignals({ title: "Document the template", body: documenting }).body, false);
  // The real declaration, outside a fence, still counts -- and it is the shape
  // #37 actually wrote.
  assert.equal(
    planReviewSignals({ title: "[PLAN REVIEW] x", body: "## Review mode\nPlan review only. Never merge. Do not implement." }).isPlanReview,
    true,
  );
});

test("a complete bugfix template inside a fence is documentation, not this PR's oracle", () => {
  // A documentation PR showing the Tier C template inside a fenced example
  // was accepted as `bugfix oracle (tier C)`: at adjudication the judge got a
  // stated null where the missing-source refusal belonged. Third heading
  // scanner made fence-aware in three rounds. (Codex, #38 round 9.)
  const documenting = ["## Docs", "The Tier C block looks like this:", "", "```markdown", TIER_C_ORACLE, "```"].join("\n");
  assert.throws(
    () => planOracleFor({ title: "Document the bugfix skill", body: documenting }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
  // Outside a fence the same block is the oracle.
  assert.equal(planOracleFor({ title: "Fix it", body: TIER_C_ORACLE }, "head", { runGit: planGit([PLAN]) }).reason, "bugfix oracle (tier C)");
});

test("the approver is part of the form: approved by David, not by anyone", () => {
  // `\bapproved\b` matched `approved by Alice on`. Only David's approval
  // authorises a plan, and the contract names him in the form.
  // (Codex, #38 round 9.)
  assert.equal(approvedPlanCommit("Plan-review PR #12, final plan commit abcdef1, approved by Alice on 2026-09-01"), null);
  assert.equal(
    approvedPlanCommit("Plan-review PRs #701 and #702, combined plan commit abcdef1 on plan-review/foo-combined, approved by Alice on 2026-09-01"),
    null,
  );
  assert.equal(approvedPlanCommit("Plan-review PR #12, final plan commit abcdef1, approved 2026-09-01"), null);
  assert.deepEqual(
    approvedPlanCommit("Plan-review PR #37, final plan commit `972b60d`, approved by David on 2026-09-06."),
    { sha: "972b60d", form: "single plan-review PR" },
  );
});

test("the first real bugfix body: typography is tolerated, a missing field is named", () => {
  // Overhypeme #611, the first real bugfix body the execution bar was run
  // against, writes `**Fix tier:** **B** —` (the letter emphasised) and
  // `**Reported symptom.**` (a period, not a colon) -- and omits `Blast
  // radius` entirely. The first two are typography and must not read as
  // missing fields; the third is a missing field and must be named.
  const real611 = [
    "## Bugfix oracle",
    "",
    "**Fix tier:** **B** — the guard path is the sensitive subsystem by definition.",
    "",
    "**Reported symptom.** All three `PreToolUse` hooks invoked the guard as `bash .claude/guard.sh`.",
    "",
    "**Root cause.** A hook command resolves against the **current working directory**, not the project root.",
    "",
    "**Intended correct behavior.** A guard must refuse, or fail to run *loudly*.",
    "",
    "**Must not change.** The guard's exit-code contract (2 blocks, 0 allows).",
  ].join("\n");
  assert.throws(
    () => planOracleFor({ title: "Make the guard hook path absolute", body: real611 }, "head", { runGit: planGit([PLAN]) }),
    /declares Tier B but its bugfix oracle is missing `Blast radius`\./,
  );
  // With the one missing field supplied, the same typography is a complete oracle.
  const completed = real611 + "\n\n**Blast radius.** Three hooks, all checked.";
  assert.equal(
    planOracleFor({ title: "Make the guard hook path absolute", body: completed }, "head", { runGit: planGit([PLAN]) }).reason,
    "bugfix oracle (tier B)",
  );
});

test("a captured entry must come from THIS pull request, not just agree with itself", () => {
  // An id/URL agreement check leaves the foreign-capture hole open: reviews
  // concatenated from another PR, or from another repository's #38, agree with
  // themselves perfectly and would be counted into rounds and trend on a
  // record labelled as this loop. (Codex, #38 round 7.)
  const base = { repo: "TheAnswerManIsHere/AI-Handbook", pr: { number: 38 } };
  const url = (pull, id) => `https://github.com/TheAnswerManIsHere/AI-Handbook/pull/${pull}#pullrequestreview-${id}`;
  // The thread anchor has no hyphen -- `#discussion_r5`, not `#discussion_r-5`.
  const threadUrl = (pull, id) => `https://github.com/TheAnswerManIsHere/AI-Handbook/pull/${pull}#discussion_r${id}`;

  assertCapturedProvenance({ ...base, reviews: [{ id: 1, html_url: url(38, 1) }] });
  assert.throws(
    () => assertCapturedProvenance({ ...base, reviews: [{ id: 1, html_url: url(33, 1) }] }),
    /was captured from PR #33, not #38/,
  );
  assert.throws(
    () =>
      assertCapturedProvenance({
        ...base,
        issueComments: [{ id: 2, html_url: "https://github.com/other/repo/pull/38#issuecomment-2" }],
      }),
    /was captured from other\/repo/,
  );
  // Threads carry the same URLs and the same hole...
  assert.throws(
    () =>
      assertCapturedProvenance({
        ...base,
        reviewThreads: [{ id: "PRRT_x", comments: [{ html_url: threadUrl(9, 5) }] }],
      }),
    /reviewThreads\[0\].comments\[0\] was captured from PR #9/,
  );
  // ...but a thread identified by its stable node id alone stays supported:
  // refusing that shape is the shared-contract divergence round 3 found.
  assertCapturedProvenance({ ...base, reviewThreads: [{ id: "PRRT_x", comments: [{}] }] });
  // A URL WITHOUT a #discussion_r fragment is still a URL with a path: a
  // foreign one is refused, an absent one is not. (Codex, #38 round 11.)
  assert.throws(
    () =>
      assertCapturedProvenance({
        ...base,
        reviewThreads: [{ id: "PRRT_x", comments: [{ html_url: "https://github.com/TheAnswerManIsHere/AI-Handbook/pull/9" }] }],
      }),
    /was captured from PR #9/,
  );
});

test("reviews and issue comments must come from a capture too", () => {
  // `assertThreadProvenance` closed the array I was caught on. #38's own
  // round-4 snapshot then carried four review ids and one issue comment id
  // that I typed -- 5125910000, 5125910100, 5125910200, 5125940000,
  // 5560235000, round numbers rather than GitHub's -- and fed the record the
  // judge ruled on. `rounds` and `trend` are counted from exactly these two
  // arrays. (Round 7, found by inspecting my own input.)
  assert.throws(
    () => assertCapturedProvenance({ reviews: [{ id: 5125910000, submitted_at: "2026-09-06T16:15:15Z" }] }),
    /carries no #pullrequestreview-<id> html_url/,
  );
  assert.throws(
    () => assertCapturedProvenance({ issueComments: [{ id: 5560235000, body: "x" }] }),
    /carries no #issuecomment-<id> html_url/,
  );
  // A fabricated id beside a real URL disagrees with itself.
  assert.throws(
    () =>
      assertCapturedProvenance({
        reviews: [{ id: 5125910000, html_url: "https://github.com/o/r/pull/38#pullrequestreview-5125908676" }],
      }),
    /has id 5125910000 but its html_url names 5125908676/,
  );
  // A real capture passes, in both arrays.
  assertCapturedProvenance({
    reviews: [{ id: 5125908676, html_url: "https://github.com/o/r/pull/38#pullrequestreview-5125908676" }],
    issueComments: [{ id: 5560231827, html_url: "https://github.com/o/r/pull/38#issuecomment-5560231827" }],
  });
  // Absent arrays are the shared contract's business, not this check's.
  assertCapturedProvenance({});
});

test("findings must come from captured threads, not a reconstruction", () => {
  // The fix for my own mistake on #37: prior rounds' threads were filled in by
  // hand, with invented ids and my paraphrase of the reviewer, and handed to
  // the judge as GitHub's record. A real thread carries a PRRT_ node id and a
  // #discussion_r html_url; neither is something a session assembles.
  assert.throws(
    () => assertThreadProvenance([{ id: "r1-0", comments: [{ html_url: "https://example.invalid" }] }]),
    /not a GitHub review-thread node id/,
  );
  // A thread with NEITHER a stable node id NOR a #discussion_r URL has nothing
  // identifying it as GitHub's record at all.
  assert.throws(
    () => assertThreadProvenance([{ id: "made-up", comments: [{ html_url: "https://example.invalid" }] }]),
    /not a GitHub review-thread node id/,
  );
  assertThreadProvenance([{ id: "PRRT_ok", comments: [{ html_url: "https://github.com/o/r/pull/1#discussion_r42" }] }]);
});

test("a patch cut before applyCaps still lands in the truncation summary", () => {
  // `cappedDiff` cuts the patch BEFORE `applyCaps` assembles the summary, so
  // the cut used to leave `truncation.fields` empty on a record whose note
  // promises that an empty `fields` means nothing was withheld -- an assurance
  // that was false exactly when 60,000 characters of the artifact were
  // missing. (Codex, #38 round 6.)
  const runGit = (args) => {
    if (args[0] === "diff" && args.includes("--numstat")) return "";
    if (args[0] === "diff") return "d".repeat(PATCH_CAP_CHARS + 500);
    return "";
  };
  let cut = null;
  const patch = artifactDiff("base", "head", { runGit, onTruncate: (c) => (cut = c) });
  assert.match(patch, /\[TRUNCATED at/);
  assert.deepEqual(cut, { keptChars: PATCH_CAP_CHARS, fullChars: PATCH_CAP_CHARS + 500 });

  const record = applyCaps({ findings: { items: [] }, artifact: { patch, patchTruncation: cut } });
  assert.deepEqual(record.truncation.fields, [
    { field: "artifact.patch", keptChars: PATCH_CAP_CHARS, fullChars: PATCH_CAP_CHARS + 500 },
  ]);
  assert.equal(record.artifact.patchTruncation, undefined, "the cut is named once, in the summary");

  // And an uncut patch still reports an honestly empty `fields`.
  const small = artifactDiff("base", "head", { runGit: () => "diff --git a/x b/x" });
  const clean = applyCaps({ findings: { items: [] }, artifact: { patch: small, patchTruncation: null } });
  assert.deepEqual(clean.truncation.fields, []);
});

test("every variable-length field is bounded, and truncation is named", () => {
  const huge = "x".repeat(RECORD_TOTAL_CAP_CHARS);
  const record = applyCaps({
    findings: {
      items: [
        { threadId: "PRRT_a", resolved: false, createdAt: "2026-09-01", body: huge },
        { threadId: "PRRT_b", resolved: true, createdAt: "2026-09-02", body: huge },
      ],
    },
    planOracle: { sections: { Direction: huge } },
    declineCitation: { text: huge },
  });
  assert.ok(record.truncation.fields.length >= 3, "every over-long field names itself");
  assert.ok(
    record.truncation.serializedChars <= RECORD_TOTAL_CAP_CHARS,
    `the emitted record must fit the total cap, got ${record.truncation.serializedChars}`,
  );
  // Unresolved findings are served first: the verdict turns on those.
  assert.ok((record.findings.items[0].body ?? "").length >= (record.findings.items[1].body ?? "").length);
});

// ---------------------------------------------------------------------------
// The shipped definition declares what this machinery reads
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Round-1 regressions (#38)
// ---------------------------------------------------------------------------

test("an oracle section keeps its nested headings and everything under them", () => {
  // Stopping at ANY heading dropped a `### Security` subsection and its
  // constraints -- the record would then hand the judge a Must Not Change
  // section with its security rules silently missing.
  const md = "## Must Not Change\nfirst rule\n\n### Security\nthe security rule\n\n## Next Section\nunrelated";
  const body = sectionOf(md, "Must Not Change");
  assert.match(body, /### Security/);
  assert.match(body, /the security rule/);
  assert.doesNotMatch(body, /unrelated/, "but it still ends at the next same-level heading");
});

test("the documented bugfix oracle block is recognised, not just an imagined line", () => {
  // bugfix/SKILL.md tells an author to write `**Fix tier:**` with its
  // companion fields. Matching an "Approved-plan source: n/a — bugfix" line
  // that no bugfix PR carries made every bugfix loop refuse record generation
  // at its mandatory round-3 adjudication -- unable to write the next fix OR
  // close on a verdict.
  const body = [
    "**Fix tier:** A — Q1 and Q2 both ruled out",
    "**Reported symptom:** the card renders twice",
    "**Intended correct behavior:** it renders once",
    "**Must not change:** the sibling card path",
    "**Root cause:** the effect re-subscribes on every render",
    "**Blast radius:** two callers, both checked",
  ].join("\n");
  const oracle = planOracleFor({ title: "Fix the double render", body }, "head", { runGit: planGit([PLAN]) });
  assert.deepEqual({ mode: oracle.mode, reason: oracle.reason }, { mode: null, reason: "bugfix oracle (tier A)" });
});

test("a partial or invented bugfix oracle is refused, not accepted as a no-plan form", () => {
  // Accepting a bare `**Fix tier:** C`, or a Tier A/B line with one companion
  // field, or a tier the contract does not define, handed the mandatory
  // adjudication `planOracle.sections: null` for a malformed oracle and called
  // it permitted -- with nothing else in the pipeline checking the block.
  // (Codex, #38 round 6.)
  const at = (body) => () => planOracleFor({ title: "Fix it", body }, "head", { runGit: planGit([PLAN]) });

  assert.throws(at("**Fix tier:** C"), /missing .*Reported symptom.*Root cause/s);
  assert.throws(at("**Fix tier:** C"), /Why this is trivial/);
  assert.throws(
    at("**Fix tier:** B — Q2 fired\n**Root cause:** the retry double-charges"),
    /missing .*Reported symptom.*Intended correct behavior.*Must not change.*Blast radius/s,
  );
  assert.throws(at("**Fix tier:** Z — invented\n**Root cause:** whatever"), /not a tier the bugfix contract defines/);
  // The unfilled template's own tier placeholder is not a tier either.
  assert.throws(at("**Fix tier:** <A or B> — fill this in"), /names no approved-plan source/);
  // A smart-quoted apostrophe is the same field, not a missing one.
  assert.equal(
    planOracleFor({ title: "Fix it", body: TIER_C_ORACLE.replace("David's", "David\u2019s") }, "head", {
      runGit: planGit([PLAN]),
    }).reason,
    "bugfix oracle (tier C)",
  );
});

test("the provenance is read from the heading form this repo actually writes", () => {
  // The matchers required the label and the provenance ON ONE LINE -- a shape
  // taken from the contract's prose sentence, not from a PR. Every body using
  // an `## Approved-plan source` HEADING, which is what this repository writes
  // (#38's own body included), matched nothing and refused record generation:
  // the mandatory adjudication could not run on the PR shipping this file.
  // Found by running the generator against the real body. (Round 6.)
  const heading = [
    "Workstream: #36 (phase 1a).",
    "",
    "## Approved-plan source",
    "",
    "Plan-review PR #37, final plan commit `972b60d`, approved by David on 2026-09-06.",
    "",
    "## Product intent (from the approved plan, verbatim)",
    "",
    "Something else entirely.",
  ].join("\n");
  const oracle = planOracleFor({ title: "Implement phase 1a", body: heading }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.mode, "approved-plan");
  assert.equal(oracle.sha, "972b60d");

  // The inline label form still works -- both are in live use.
  assert.equal(
    planOracleFor(
      {
        title: "x",
        body: "**Approved-plan source:** Plan-review PR #37, final plan commit 972b60d, approved by David on 2026-09-06",
      },
      "head",
      { runGit: planGit([PLAN]) },
    ).sha,
    "972b60d",
  );

  // And scoping keeps round 1's property: provenance-shaped prose OUTSIDE the
  // declared source region is still not this PR's oracle.
  assert.throws(
    () =>
      planOracleFor(
        {
          title: "x",
          body: [
            "## Approved-plan source",
            "",
            "TBD — pending David's approval.",
            "",
            "## Notes",
            "",
            "PR #12, final plan commit deadbee, approved by David on 2026-01-01 covered the other phase.",
          ].join("\n"),
        },
        "head",
        { runGit: planGit([PLAN]) },
      ),
    /names no approved-plan source/,
  );
});

test("indented and blockquoted examples are not live declarations either", () => {
  // Fences were masked in rounds 8-10; a four-space-indented Tier C template
  // and a blockquoted provenance line survived. (Codex, #38 round 11.)
  const indented = ["## Docs", "", ...TIER_C_ORACLE.split("\n").map((l) => "    " + l)].join("\n");
  assert.throws(
    () => planOracleFor({ title: "Document it", body: indented }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
  const quoted = "## Notes\n> **Approved-plan source:** Plan-review PR #37, final plan commit 972b60d, approved by David on 2026-09-06";
  assert.throws(
    () => planOracleFor({ title: "Document it", body: quoted }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
  // An indented line inside a LIST ITEM is list content, not code: the block
  // is still recognised when the indentation continues a paragraph.
  const listed = ["## Bugfix oracle", "1. The oracle:", ...TIER_C_ORACLE.split("\n").map((l) => "    " + l)].join("\n");
  assert.equal(planOracleFor({ title: "Fix it", body: listed }, "head", { runGit: planGit([PLAN]) }).reason, "bugfix oracle (tier C)");
});

test("the Plan-review prefix is part of the public form", () => {
  // `Implementation PR #12, final plan commit …` matched on `PR #` alone; the
  // plan-review PR is the approval's home and the prefix names it.
  // (Codex, #38 round 11.)
  assert.equal(approvedPlanCommit("Implementation PR #12, final plan commit abcdef1, approved by David on 2026-09-01"), null);
  assert.equal(approvedPlanCommit("PRs #701 and #702, combined plan commit abcdef1 on plan-review/x-combined, approved by David on 2026-09-01"), null);
  assert.deepEqual(
    approvedPlanCommit("Plan-review PR #37, final plan commit `972b60d`, approved by David on 2026-09-06."),
    { sha: "972b60d", form: "single plan-review PR" },
  );
});

test("a fenced Approved-plan source example is documentation, not this PR's provenance", () => {
  // The section path was fence-aware; the labelled-line fallback read the raw
  // text, so a documentation PR quoting a complete provenance line inside a
  // fence resolved that example's commit as the approved oracle.
  // (Codex, #38 round 10.)
  const documenting = [
    "## Summary",
    "The provenance line is written like this:",
    "",
    "```markdown",
    "**Approved-plan source:** Plan-review PR #37, final plan commit 972b60d, approved by David on 2026-09-06",
    "```",
  ].join("\n");
  assert.throws(
    () => planOracleFor({ title: "Document the template", body: documenting }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
});

test("the since-last-review patch is emitted as lines too", () => {
  // One escaped JSON line is the unreadable shape round 5 removed from the
  // artifact patch; the other patch had the same shape. (Codex, #38 round 10.)
  const record = applyCaps({
    findings: { items: [] },
    artifact: { patch: "a\nb", patchTruncation: null },
    sinceLastReview: { patch: "diff --git a/x b/x\n+moved\n" },
  });
  assert.deepEqual(record.sinceLastReview.patch, ["diff --git a/x b/x", "+moved", ""]);
  assert.deepEqual(record.artifact.patch, ["a", "b"]);
});

test("an explicit approved-plan source outranks incidental no-plan text", () => {
  // A feature PR that merely QUOTES a no-plan form -- a process change
  // discussing the Tier C block, a changelog, this loop's own PR body --
  // returned `planOracle: null` and dropped the human-approved oracle without
  // ever parsing the provenance line in the same body. (Codex, #38 round 6.)
  const body = [
    "**Approved-plan source:** Plan-review PR #37, final plan commit 972b60d, approved by David on 2026-09-06",
    "",
    "## Notes",
    "This change also documents the bugfix oracle, whose Tier C block opens `**Fix tier:** C`.",
  ].join("\n");
  const oracle = planOracleFor({ title: "Implement phase 1a", body }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.mode, "approved-plan");
  assert.equal(oracle.sha, "972b60d");
});

test("a plan commit is read only from an Approved-plan source line", () => {
  // Unanchored, the phrase matches anywhere -- a quoted comment, a changelog,
  // a sentence about a different PR -- and that commit's plan would then be
  // presented to the judge as this PR's approved oracle.
  const incidental = "## Notes\nWe discussed the final plan commit abc1234 in standup; it is not this PR's.";
  assert.throws(
    () => planOracleFor({ title: "Implement the thing", body: incidental }, "head", { runGit: planGit([PLAN]) }),
    /names no approved-plan source/,
  );
});

test("the total cap terminates, and an overflow it cannot fix is stated", () => {
  // The obvious loop -- blank a non-empty body, re-serialize, repeat -- never
  // terminates, because blanking replaces the body with a non-empty marker
  // the next pass selects again. It hung record generation outright.
  const big = "x".repeat(700_000);
  const record = applyCaps({
    findings: {
      items: [
        { threadId: "PRRT_a", resolved: false, createdAt: "2026-01-01", body: big },
        { threadId: "PRRT_b", resolved: true, createdAt: "2026-01-02", body: big },
      ],
    },
  });
  assert.ok(record.truncation.serializedChars <= RECORD_TOTAL_CAP_CHARS);

  // And when the overflow is in metadata this function does not own, it says
  // so in the record rather than emitting a silently oversized one.
  const stuck = applyCaps({ findings: { items: [] }, padding: "y".repeat(RECORD_TOTAL_CAP_CHARS + 10) });
  assert.equal(stuck.truncation.overCap, true);
  assert.match(stuck.truncation.overCapNote, /already been shed/);
});

// ---------------------------------------------------------------------------
// Round-2 regressions (#38)
// ---------------------------------------------------------------------------

test("the reported size is the size of the record as emitted, metadata included", () => {
  // Measuring, then adding the fields that describe the measurement, then
  // never re-measuring, is how a record crosses the cap on the strength of its
  // own truncation metadata -- with `overCap` unset and `serializedChars`
  // understating the truth. The boundary case is Codex's own.
  const record = applyCaps({ findings: { items: [] }, padding: "z".repeat(599_575) });
  const emitted = JSON.stringify(record, null, 2).length;
  assert.equal(record.truncation.serializedChars, emitted, "the reported size must be the emitted size");
  assert.equal(record.truncation.overCap, true, "and an emitted record over the cap must say so");

  // The ordinary case still reports exactly, with nothing flagged.
  const small = applyCaps({ findings: { items: [{ threadId: "PRRT_a", resolved: false, body: "short" }] } });
  assert.equal(small.truncation.serializedChars, JSON.stringify(small, null, 2).length);
  assert.equal(small.truncation.overCap, undefined);
});

test("an explicit plan path is read from the provenance line, and must be one the commit introduced", () => {
  // A body-wide match takes the first plan path anywhere -- a quoted Product
  // Intent, a reference to the next phase's plan -- and would then present
  // that file's sections as this PR's approved oracle.
  const decoy = [
    "**Approved-plan source:** Plan-review PR #37, final plan commit abc1234, approved by David on 2026-09-06",
    "",
    "## Product intent",
    "This delivers phase 1a; phase 1b is specified in docs/plans/PLAN_OTHER.md and is not in scope.",
  ].join("\n");
  const oracle = planOracleFor({ title: "Implement phase 1a", body: decoy }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.path, PLAN, "the decoy path outside the provenance line must not win");

  // And an explicit path IS a disambiguator among what the commit introduced,
  // never an override of it.
  const overriding = "**Approved-plan source:** Plan-review PR #37, final plan commit abc1234, docs/plans/PLAN_ELSEWHERE.md, approved by David on 2026-09-06";
  assert.throws(
    () => planOracleFor({ title: "x", body: overriding }, "head", { runGit: planGit([PLAN]) }),
    /refusing rather than reading a plan the cited commit did not deliver/,
  );
});

// ---------------------------------------------------------------------------
// Recorded gaps from #38's stop verdict, worked under David's grant (#39)
// ---------------------------------------------------------------------------

test("the approved-plan pointer is read in the shape this repository actually writes it", () => {
  // Found by running the machinery on its own PR, not by reading it: #38's
  // body carries "final plan commit `972b60d`" -- the sha in backticks, which
  // is this repo's house style -- and the first record generated for it
  // REFUSED. Every feature PR written the way this repo writes them would
  // have. (#39 gap 2.)
  const body = "**Approved-plan source:** Plan-review PR #37, final plan commit `972b60d`, approved by David on 2026-09-06.";
  const oracle = planOracleFor({ title: "Implement phase 1a", body }, "head", { runGit: planGit([PLAN]) });
  assert.equal(oracle.mode, "approved-plan");
  assert.equal(oracle.sha, "972b60d");

  // Quoted and bare forms keep working, and a backticked PATH resolves too.
  for (const variant of [
    "**Approved-plan source:** Plan-review PR #37, final plan commit 972b60d, approved by David on 2026-09-06",
    "**Approved-plan source:** Plan-review PR #37, final plan commit \"972b60d\", approved by David on 2026-09-06",
    "**Approved-plan source:** Plan-review PR #37, final plan commit `972b60d`, `docs/plans/PLAN_NEW.md`, approved by David on 2026-09-06",
  ]) {
    assert.equal(planOracleFor({ title: "x", body: variant }, "head", { runGit: planGit([PLAN]) }).sha, "972b60d");
  }
});

test("thread provenance matches the shared snapshot contract, no stricter", () => {
  // `assertMcpSnapshotShape` recovers a comment's identity from its
  // #discussion_r URL and deliberately falls back to the stable thread id.
  // Requiring both here rejected captures `fromMcp` accepts, in the one place
  // a refusal strands a mandatory round. (#39 gap 1.)
  const url = "https://github.com/o/r/pull/1#discussion_r42";
  assertThreadProvenance([{ id: "PRRT_ok", comments: [{ html_url: url }] }]);
  assertThreadProvenance([{ id: "PRRT_ok", comments: [{}] }]); // the documented fallback

  // The anti-reconstruction property is untouched: it rests on the node id,
  // which is the check that caught my own hand-written threads.
  assert.throws(
    () => assertThreadProvenance([{ id: "r1-0", comments: [{ html_url: url }] }]),
    /not a GitHub review-thread node id/,
  );
  assert.throws(
    () => assertThreadProvenance([{ id: "r1-0", comments: [{}] }]),
    /not a GitHub review-thread node id/,
  );
});

test("every long field is emitted as lines the judge's Read can actually page", () => {
  // A cap on SIZE is not a guarantee of READABILITY. On PR #38 the judge's
  // read of a 103,547-character `artifact.patch` was cut at 52,593 and it
  // never saw the implementation hunks — with every declared cap satisfied
  // and `truncation.fields` empty. JSON escapes newlines, so a multi-line
  // value is one enormous JSON line, and a line is what the transport cannot
  // page past. (Codex, #38 round 4, evidenced by the loop's own receipt.)
  const record = applyCaps({
    findings: { items: [{ threadId: "PRRT_a", resolved: false, body: `first\nsecond\n${"z".repeat(6000)}` }] },
    planOracle: { sections: { Direction: "a\nb" } },
    declineCitation: { text: "note one\nnote two" },
    artifact: { patch: "diff --git a/x b/x\n+added\n" },
  });
  for (const value of [
    record.findings.items[0].body,
    record.planOracle.sections.Direction,
    record.declineCitation.text,
    record.artifact.patch,
  ]) {
    assert.ok(Array.isArray(value), "every multi-line field is an array of lines");
  }
  const emitted = JSON.stringify(record, null, 2).split("\n");
  const longest = Math.max(...emitted.map((l) => l.length));
  assert.ok(longest <= RECORD_LINE_CAP_CHARS + 32, `longest emitted line was ${longest}`);

  // Chunked, not truncated: an over-long source line stays complete.
  assert.ok(record.findings.items[0].body.join("").includes("z".repeat(6000)), "no content is lost to chunking");
});

test("a merge commit still yields the plan it introduced", () => {
  // This repository requires merging newly-landed main into a pushed branch
  // rather than rebasing, so a plan-review head IS routinely a merge — and
  // `diff-tree` without `-m` reports nothing at all for one, which refused
  // the mandatory adjudication on a loop containing exactly one plan.
  let sawMergeTraversal = false;
  const runGit = (args) => {
    if (args[0] === "diff-tree") {
      sawMergeTraversal = args.includes("-m");
      // `-m` emits one diff per parent, so a path can repeat.
      return ["docs/plans/PLAN_NEW.md", "b.txt", "docs/plans/PLAN_NEW.md"].join("\0") + "\0";
    }
    return "";
  };
  const plans = planFilesIntroducedBy("head", { runGit });
  assert.ok(sawMergeTraversal, "merge traversal must be requested, or a merge head reports nothing");
  assert.deepEqual(plans, ["docs/plans/PLAN_NEW.md"], "and the per-parent repeats are deduplicated");
});

test("artifact endpoints must be immutable object ids, not names", () => {
  // `git cat-file -e` resolves HEAD, main and abbreviated shas alike, so the
  // previous check let a snapshot carrying a NAME derive the artifact range
  // and the dispatch declaration from whatever the checkout points at.
  const full = "a".repeat(40);
  for (const bad of ["HEAD", "main", "a6c0cc7"]) {
    assert.throws(
      () => assertArtifactEndpoints(bad, full, { runGit: () => "" }),
      /not a full 40-character object id/,
      `${bad} must be refused`,
    );
  }
  assertArtifactEndpoints(full, full, { runGit: () => "" });
});

test("the private path must carry its whole provenance, not the word shasum", () => {
  const complete = "**Approved-plan source:** PLAN_THING.md, shasum -a 256 3b1f8c2d9e4a7b6c5d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e, approved 2026-09-06";
  assert.equal(
    planOracleFor({ title: "Implement it", body: complete }, "head", { runGit: planGit([PLAN]) }).reason,
    "private path",
  );
  for (const placeholder of [
    "**Approved-plan source:** shasum",
    // The contract says `shasum -a 256`: a bare `shasum` with a short digest
    // let a placeholder stand for the one field the private path can be
    // checked on. (Codex, #38 round 8.)
    "**Approved-plan source:** PLAN_THING.md, shasum 3b1f8c2d9e4a7b6c5d0e1f2a3b4c5d6e, approved 2026-09-06",
    "**Approved-plan source:** PLAN_THING.md, shasum -a 256 3b1f8c2d9e4a7b6c5d0e1f2a3b4c5d6e, approved 2026-09-06",
    "**Approved-plan source:** PLAN_THING.md, shasum -a 256 <digest>, approved <date>",
    "**Approved-plan source:** shasum -a 256 3b1f8c2d9e4a7b6c5d0e1f2a3b4c5d6e7f8091a2b3c4d5e6f708192a3b4c5d6e",
  ]) {
    assert.throws(
      () => planOracleFor({ title: "Implement it", body: placeholder }, "head", { runGit: planGit([PLAN]) }),
      /names no approved-plan source/,
      `placeholder provenance must refuse: ${placeholder}`,
    );
  }
});

test("a merge of two branches that each introduced a plan resolves to this branch's plan", () => {
  // `-m` fixed a merge head reporting nothing, and left a second merge shape
  // wrong: a plan-review branch introducing PLAN_A merges a main that
  // independently introduced PLAN_B, and `-m` emits one against each parent —
  // two candidates survive deduplication and the oracle refuses a loop that
  // plainly contains one plan. The range asks the question that was meant:
  // which plans does THIS BRANCH contribute. (Codex, #38 round 5.)
  const runGit = (args) => {
    if (args[0] === "diff" && args.includes("--name-only")) {
      // base...head — only the branch's own contribution
      return "docs/plans/PLAN_A.md\0";
    }
    if (args[0] === "diff-tree") {
      // what the commit-only view would have said: both plans
      return "docs/plans/PLAN_A.md\0docs/plans/PLAN_B.md\0";
    }
    return "";
  };
  assert.deepEqual(planFilesIntroducedBy("head", { runGit, base: "base" }), ["docs/plans/PLAN_A.md"]);
  // Without a base there is no range to ask, and the commit-only view stands.
  assert.deepEqual(planFilesIntroducedBy("head", { runGit }), ["docs/plans/PLAN_A.md", "docs/plans/PLAN_B.md"]);
});

test("the public approved-plan provenance must be complete, not just a resolvable sha", () => {
  const complete = "**Approved-plan source:** Plan-review PR #37, final plan commit `972b60d`, approved by David on 2026-09-06";
  assert.equal(planOracleFor({ title: "x", body: complete }, "head", { runGit: planGit([PLAN]) }).sha, "972b60d");
  for (const partial of [
    "**Approved-plan source:** final plan commit 972b60d",
    "**Approved-plan source:** Plan-review PR #37, final plan commit 972b60d",
    "**Approved-plan source:** final plan commit 972b60d, approved by David on 2026-09-06",
  ]) {
    assert.throws(
      () => planOracleFor({ title: "x", body: partial }, "head", { runGit: planGit([PLAN]) }),
      /names no approved-plan source/,
      `incomplete provenance must refuse: ${partial}`,
    );
  }
});

test("the patch and the artifact counts describe the same rename", () => {
  // numstat disables rename detection so both sides land in the set; leaving
  // it on for the patch emitted one zero-line rename hunk against two files
  // and every line counted. The judge weighs both.
  let patchFlags = null;
  const runGit = (args) => {
    if (args[0] === "diff" && args.includes("--no-color")) { patchFlags = args; return ""; }
    return "";
  };
  cappedDiff(runGit, "base...head");
  assert.ok(patchFlags.includes("--no-renames"), "the patch must use the same rename setting as the file list");
});
