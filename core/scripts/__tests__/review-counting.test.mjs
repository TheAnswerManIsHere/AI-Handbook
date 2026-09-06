// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
// Tests for the review-counting library -- the counting functions that stayed
// on the enforcement path (review-budget.mjs, review-loop-record.mjs) when the
// loop ledger was deleted (2026-08-20). Recovered from the deleted
// loop-metrics.test.mjs; tests for the ledger's own deleted derivation are
// gone with it. (Codex, #543 round 3.)
import { test } from "node:test";
import assert from "node:assert/strict";

const BOT = { login: "chatgpt-codex-connector[bot]" };
const ME = { login: "TheAnswerManIsHere" };

/**
 * The connector's clean-pass announcement, verbatim in shape from this repo's
 * PR #286/#288/#290 — a plain ISSUE comment (not a review record) whose only
 * stable machine-readable content is the reviewed-commit line. The sentiment
 * suffix varies ("Delightful!" / "Swish!" / ":+1:"), which is exactly why
 * detection keys on the marker and not the prose.
 */
let cleanPassAutoId = 900000;
const cleanPass = (sha, at, id = ++cleanPassAutoId, flourish = "Delightful!") => ({
  id,
  user: BOT,
  created_at: at,
  body: `Codex Review: Didn't find any major issues. ${flourish}\n\n**Reviewed commit:** \`${sha}\`\n`,
});

/** A review record that ANNOUNCES a completed pass — the found-something shape. */
const announced = (id, sha, at) => ({
  id,
  user: BOT,
  commit_id: sha,
  submitted_at: at,
  body: `\n### 💡 Codex Review\n\nHere are some automated review suggestions.\n\n**Reviewed commit:** \`${sha.slice(0, 10)}\`\n`,
});

/** A bodiless review record — the inline-comment carrier half of one pass. */
const carrier = (id, sha, at) => ({ id, user: BOT, commit_id: sha, submitted_at: at });


test("a carrier attaches to a same-commit announcement over an earlier unrelated one", () => {
  // With two announcements following a carrier, the one on its own commit is
  // the pass it belongs to — otherwise its findings land in the wrong round.
  const reviews = [
    carrier(1, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "2026-07-30T01:00:00Z"),
    announced(2, "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", "2026-07-30T01:01:00Z"),
    announced(3, "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb", "2026-07-30T01:02:00Z"),
  ];
  const passes = reviewerPasses(reviews);
  assert.equal(passes.length, 2);
  assert.deepEqual(passes.find((p) => p.commit.startsWith("bbb")).reviewIds.sort(), [1, 3]);
});


test("author replies never count as findings", () => {
  // Our workflow mandates a reply per thread, which roughly doubles a naive
  // comment count. PR #269: 31 comments, ~23 findings.
  const comments = [
    { id: 10, user: BOT },
    { id: 11, user: ME, in_reply_to_id: 10 },
    { id: 12, user: BOT },
    { id: 13, user: ME, in_reply_to_id: 12 },
  ];
  assert.equal(countFindings(comments), 2);
});

test("a reviewer reply on an existing thread is not a new finding", () => {
  const comments = [
    { id: 20, user: BOT },
    { id: 21, user: BOT, in_reply_to_id: 20 },
  ];
  assert.equal(countFindings(comments), 1);
});

test("re-raised findings ARE counted mechanically and left to judgment", () => {
  // Deliberate: "Reconciliation" has no machine-readable marker
  // (plan-review-contract.md names it in prose; code-review.md has no such
  // category at all), so excluding it by regex would be a guess presented as a
  // measurement. It is counted here and separated in the judgment column.
  const comments = [
    { id: 30, user: BOT, body: "**Reconciliation (6.1 — Still Open)** ..." },
    { id: 31, user: BOT, body: "New finding" },
  ];
  assert.equal(countFindings(comments), 2);
});

test("findings are attributed to the round that produced them", () => {
  const reviews = [
    { id: 1, user: BOT, submitted_at: "2026-07-27T01:00:00Z" },
    { id: 2, user: BOT, submitted_at: "2026-07-27T02:00:00Z" },
  ];
  const comments = [
    { id: 40, user: BOT, pull_request_review_id: 1 },
    { id: 41, user: BOT, pull_request_review_id: 1 },
    { id: 42, user: BOT, pull_request_review_id: 2 },
    { id: 43, user: ME, in_reply_to_id: 40, pull_request_review_id: 1 },
  ];
  assert.deepEqual(
    findingsByRound(reviews, comments).map((r) => [r.round, r.findings]),
    [
      [1, 2],
      [2, 1],
    ],
  );
});

test("findingsByRound dedupes a repeated review record instead of double-mapping its findings", () => {
  const reviews = [
    { id: 1, user: BOT, submitted_at: "2026-07-27T01:00:00Z" },
    { id: 1, user: BOT, submitted_at: "2026-07-27T01:00:00Z" }, // duplicate record
  ];
  const comments = [{ id: 40, user: BOT, pull_request_review_id: 1 }];
  assert.deepEqual(
    findingsByRound(reviews, comments).map((r) => [r.round, r.findings]),
    [[1, 1]],
  );
});


test("artifact size keeps both dimensions", () => {
  const size = artifactSize([
    { filename: "a.md", additions: 100, deletions: 5 },
    { filename: "b.md", additions: 300, deletions: 0 },
  ]);
  assert.deepEqual(size, { files: 2, added: 400, removed: 5 });
});

test("artifact size dedupes a repeated file record instead of double-counting it", () => {
  // A bad fixture or two overlapping concatenated pages can repeat a file
  // entry, which would otherwise inflate every dimension of a number this
  // ledger persists as mechanically authoritative.
  const size = artifactSize([
    { filename: "a.md", additions: 100, deletions: 5 },
    { filename: "a.md", additions: 100, deletions: 5 },
  ]);
  assert.deepEqual(size, { files: 1, added: 100, removed: 5 });
});


// ---------------------------------------------------------------------------
// Transport. The live API is unreachable from the dev container (the token
// there is proxy-scoped), so pagination and error handling are tested with an
// injected fetch rather than left unverified — an untested wrapper would
// undercount rounds on exactly the large loops this ledger exists to measure.
// ---------------------------------------------------------------------------

function stub(pages) {
  let i = 0;
  return async () => {
    const p = pages[i++];
    return {
      ok: p.ok ?? true,
      status: p.status ?? 200,
      statusText: p.statusText ?? "OK",
      json: async () => p.body,
      headers: { get: (h) => (h.toLowerCase() === "link" ? (p.link ?? null) : null) },
    };
  };
}


// ---------------------------------------------------------------------------
// MCP adapter. Fixtures below are drawn verbatim from real `pull_request_read`
// output against this repo's own PR #270 (2026-07-27) — not hand-imagined
// shapes. That's the whole point: a plausible-looking mapping is not the same
// as one checked against a real response.
// ---------------------------------------------------------------------------

import {
  capturedAtDetail,
  capturedAtOf,
  headRepoOf,
  countFindings,
  findingsByRound,
  reviewerPasses,
  artifactSize,
  flattenMcpThreads,
  fromMcp,
  assertMcpSnapshotComplete,
  normalizeLogin,
  summaryRows,
  summaryCodeReviewPasses,
  SUMMARY_COMMENT_MARKER,
} from "../review-counting.mjs";

const MCP_REVIEW = {
  id: 4791129869,
  user: { login: "chatgpt-codex-connector[bot]" },
  submitted_at: "2026-07-27T20:15:30Z",
};

// Real shape from get_review_comments against PR #270: comments grouped by
// thread, `author` as a bare string, no `id`/`in_reply_to_id`/
// `pull_request_review_id` — id only recoverable from html_url.
const MCP_THREAD_UNANSWERED = {
  id: "PRRT_kwDOR3LTYs6UMcPj",
  comments: [
    {
      body: "Provide a usable API transport in the agent environment",
      path: "scripts/loop-metrics.mjs",
      line: 205,
      author: "chatgpt-codex-connector",
      created_at: "2026-07-27T20:15:31Z",
      html_url:
        "https://github.com/TheAnswerManIsHere/Overhypeme/pull/270#discussion_r3660595551",
    },
  ],
};

const MCP_THREAD_WITH_REPLY = {
  id: "PRRT_kwDOR3LTYs6UMcPm",
  comments: [
    {
      body: "Recognize scoped fix titles as bugfixes",
      author: "chatgpt-codex-connector",
      created_at: "2026-07-27T20:15:31Z",
      html_url:
        "https://github.com/TheAnswerManIsHere/Overhypeme/pull/270#discussion_r3660595556",
    },
    {
      body: "Fixed — broadened the regex.",
      author: "TheAnswerManIsHere",
      created_at: "2026-07-27T20:30:00Z",
      html_url:
        "https://github.com/TheAnswerManIsHere/Overhypeme/pull/270#discussion_r3660777777",
    },
  ],
};

test("flattenMcpThreads recovers the numeric id from html_url", () => {
  const [c] = flattenMcpThreads([MCP_THREAD_UNANSWERED], [MCP_REVIEW]);
  assert.equal(c.id, 3660595551);
});

test("flattenMcpThreads wraps the bare author string as user.login", () => {
  const [c] = flattenMcpThreads([MCP_THREAD_UNANSWERED], [MCP_REVIEW]);
  assert.equal(c.user.login, "chatgpt-codex-connector");
});

test("flattenMcpThreads: first comment in a thread is the root, not a reply", () => {
  const [root] = flattenMcpThreads([MCP_THREAD_WITH_REPLY], [MCP_REVIEW]);
  assert.equal(root.in_reply_to_id, undefined);
});

test("flattenMcpThreads: later comments reply to the thread's root id", () => {
  const [root, reply] = flattenMcpThreads([MCP_THREAD_WITH_REPLY], [MCP_REVIEW]);
  assert.equal(reply.in_reply_to_id, root.id);
});

test("flattenMcpThreads infers pull_request_review_id across the bot's two login spellings", () => {
  // MCP_REVIEW.user.login is "chatgpt-codex-connector[bot]" (from
  // get_reviews); the comment's author is "chatgpt-codex-connector" (from
  // get_review_comments, no [bot] suffix). An exact-match lookup between the
  // two would silently find nothing here — this failed before normalizeLogin.
  const [c] = flattenMcpThreads([MCP_THREAD_UNANSWERED], [MCP_REVIEW]);
  assert.equal(c.pull_request_review_id, MCP_REVIEW.id);
});


test("fromMcp refuses an issue comment missing the fields pass detection reads", () => {
  const bad = realSnapshot({
    issueComments: [{ id: 1, user: { login: "chatgpt-codex-connector[bot]" }, created_at: "2026-07-30T02:00:00Z" }],
    complete: { reviews: true, files: true, reviewThreads: true, issueComments: true },
  });
  assert.throws(() => fromMcp(bad), /issueComments\[0\] must have a stable id.*a string body/);
});

test("fromMcp refuses an issue comment with no stable id", () => {
  // reviewerPasses dedupes issue comments by id; an id-less comment would
  // either collide with every other id-less comment or, left unvalidated,
  // could repeat across concatenated pages and fabricate a phantom round.
  const bad = realSnapshot({
    issueComments: [cleanPass("aaaaaaaaaa", "2026-07-30T02:00:00Z")],
    complete: { reviews: true, files: true, reviewThreads: true, issueComments: true },
  });
  delete bad.issueComments[0].id;
  assert.throws(() => fromMcp(bad), /issueComments\[0\] must have a stable id/);
});

test("flattenMcpThreads assigns no review id when the comment predates every review by that author", () => {
  const earlyComment = {
    ...MCP_THREAD_UNANSWERED,
    comments: [{ ...MCP_THREAD_UNANSWERED.comments[0], created_at: "2020-01-01T00:00:00Z" }],
  };
  const [c] = flattenMcpThreads([earlyComment], [MCP_REVIEW]);
  assert.equal(c.pull_request_review_id, undefined);
});

function realSnapshot(overrides = {}) {
  return {
    pr: {
      number: 270,
      title: "Add the loop ledger: track every review loop, count what can be counted",
      created_at: "2026-07-27T20:07:03Z",
      closed_at: "2026-07-29T18:41:12Z",
    },
    reviews: [MCP_REVIEW],
    files: [{ filename: "scripts/loop-metrics.mjs", additions: 100, deletions: 0 }],
    reviewThreads: [MCP_THREAD_UNANSWERED, MCP_THREAD_WITH_REPLY],
    complete: { reviews: true, files: true, reviewThreads: true },
    ...overrides,
  };
}

test("fromMcp refuses a snapshot with no completeness attestation at all", () => {
  // PR #279's loop — 32 rounds, 166 findings, our worst case, and exactly the
  // shape this adapter is for — will paginate at least one collection.
  // Deriving from an unmarked partial snapshot silently undercounts precisely
  // there.
  const { complete: _drop, ...noAttestation } = realSnapshot();
  assert.throws(() => fromMcp(noAttestation), /complete\.reviews/);
});

// `files` is deliberately absent from both loops below: the artifact's file
// list now comes from git over base...head, one source shared with the patch
// and territory, so the snapshot no longer attests to it (see
// review-loop-record.mjs's artifactFileList).
for (const key of ["reviews", "reviewThreads"]) {
  test(`fromMcp refuses a snapshot where complete.${key} is explicitly false`, () => {
    assert.throws(
      () => fromMcp(realSnapshot({ complete: { reviews: true, files: true, reviewThreads: true, [key]: false } })),
      new RegExp(`complete\\.${key}`),
    );
  });
}

test("assertMcpSnapshotComplete passes silently when all three are true", () => {
  assert.doesNotThrow(() => assertMcpSnapshotComplete(realSnapshot()));
});

test("fromMcp refuses complete:true attesting to a collection that is not actually present", () => {
  // The attestation only proves a claim was made — it says nothing about
  // whether the data behind it exists. Without this check, complete.reviewThreads
  // true plus a missing reviewThreads field would fall through flattenMcpThreads'
  // ?? [] default and silently report zero findings: indistinguishable from a
  // genuinely clean loop.
  const { reviewThreads: _drop, ...malformed } = realSnapshot();
  assert.throws(() => fromMcp(malformed), /"reviewThreads" must be an array/);
});

for (const key of ["reviews", "reviewThreads"]) {
  test(`fromMcp refuses ${key} when it is present but not an array`, () => {
    assert.throws(() => fromMcp(realSnapshot({ [key]: "not-an-array" })), new RegExp(`"${key}" must be an array`));
  });
}

test("the snapshot's retired `files` field is ignored in every shape it can arrive in", () => {
  // Absent, empty, and old-shape all pass, and none of them can influence a
  // derived value any more. #28 and #33 both carried `files: []` with
  // `complete.files: true`, which is how a 50 KB patch was reported as an
  // artifact of zero files (#34 gap 2). The field is gone from the contract
  // rather than validated harder.
  const { files: _drop, ...noFiles } = realSnapshot();
  const shapes = [
    noFiles,
    realSnapshot({ files: [] }),
    realSnapshot({ files: [{ filename: "a.ts", additions: 1, deletions: 0 }] }),
  ];
  const derived = shapes.map((snap) => fromMcp(snap));
  for (const d of derived) {
    assert.deepEqual(
      { reviews: d.reviews.length, threads: d.reviewThreads?.length ?? null },
      { reviews: derived[0].reviews.length, threads: derived[0].reviewThreads?.length ?? null },
    );
  }
});

test("fromMcp refuses a thread whose comments field is missing", () => {
  const threadWithNoComments = { id: "PRRT_broken" };
  assert.throws(
    () => fromMcp(realSnapshot({ reviewThreads: [threadWithNoComments] })),
    /reviewThreads\[0\] \(id PRRT_broken\) has no comments array/,
  );
});


test("fromMcp refuses a files entry missing additions/deletions", () => {
  // A files entry with only a filename is a valid array element, so the
  // container-level check alone would pass this through and let
  // artifactSize() silently substitute zero for both dimensions.
  assert.throws(
    () => fromMcp(realSnapshot({ files: [{ filename: "src/x.ts" }] })),
    /files\[0\] must have a string filename and numeric additions\/deletions/,
  );
});


test("fromMcp refuses a pr object missing a title", () => {
  assert.throws(
    () => fromMcp(realSnapshot({ pr: { number: 270, created_at: "2026-07-27T20:07:03Z" } })),
    /"pr" must have a numeric number, a string title, and a parseable created_at/,
  );
});

test("fromMcp refuses a thread comment missing a body, author, or created_at", () => {
  const brokenThread = {
    id: "PRRT_broken2",
    comments: [{ path: "scripts/loop-metrics.mjs", author: "chatgpt-codex-connector" }],
  };
  assert.throws(
    () => fromMcp(realSnapshot({ reviewThreads: [brokenThread] })),
    /reviewThreads\[0\]\.comments\[0\] must have a body, an author or user\.login, and a created_at/,
  );
});


test("fromMcp accepts a comment with a stable thread id even without a discussion_r html_url", () => {
  const threadWithStableId = {
    id: "PRRT_stable_but_no_url",
    comments: [
      {
        body: "A finding identified by thread id alone",
        author: "chatgpt-codex-connector",
        created_at: "2026-07-27T20:15:31Z",
        html_url: "https://github.com/TheAnswerManIsHere/Overhypeme/pull/270",
      },
    ],
  };
  assert.doesNotThrow(() => fromMcp(realSnapshot({ reviewThreads: [threadWithStableId] })));
});

// ---------------------------------------------------------------------------
// CLI argument parsing/validation.
// ---------------------------------------------------------------------------


// ---------------------------------------------------------------------------
// The per-loop metrics store: projection, scaffold, cohort weighting
// ---------------------------------------------------------------------------




// ---------------------------------------------------------------------------
// The connector's review-summary comment (#17)
//
// EVERY FIXTURE BELOW IS A REAL BODY, copied from the live API, not a
// plausible reconstruction. That is the same rule the MCP-shape fixtures
// above were written under and for the same reason: the defect this closes
// was a parser keyed on a convention the source never promised to keep, so a
// fixture I invented would be testing my belief about the format rather than
// the format.
//
// SUMMARY_R1 is PR #15's summary comment as it read after round 1 -- the
// clean automatic pass that emitted no `**Reviewed commit:**` marker at all
// and so was reported by the merge gate as a review that never started.
// SUMMARY_RUNNING is the same comment three minutes later, mid round 2: one
// comment, rewritten in place, which is why it can say what the LATEST round
// did and can never say how many rounds there were.
// ---------------------------------------------------------------------------

const SUMMARY_R1 = `${SUMMARY_COMMENT_MARKER}

## Codex Review Summary

This comment shows the latest Codex review activity on this pull request.

| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | ✅ **Completed** <relative-time datetime="2026-09-05T00:25:53.728619Z">2026-09-05T00:25:53.728619Z</relative-time> | \`7861351\` | PR opened |
`;

const SUMMARY_RUNNING = `${SUMMARY_COMMENT_MARKER}

| Review | Status | Commit | Review trigger |
| --- | --- | --- | --- |
| 📝 **Code Review** | 🔄 **Running** since <relative-time datetime="2026-09-05T00:54:34.668184Z">2026-09-05T00:54:34.668184Z</relative-time> | \`cf1787f\` | Manual request |
`;

// PR #15 round 2's marker comment, verbatim.
const MARKER_R2 = {
  id: 5548241759,
  user: { login: "chatgpt-codex-connector[bot]" },
  created_at: "2026-09-05T00:58:08Z",
  body: "Codex Review: Didn't find any major issues. Breezy!\n\n**Reviewed commit:** `cf1787f7bf`\n",
};

const botComment = (id, body, created_at = "2026-09-05T00:22:57Z") => ({
  id,
  user: { login: "chatgpt-codex-connector[bot]" },
  created_at,
  body,
});

test("summaryRows reads the real completed row, skipping header and separator", () => {
  assert.deepEqual(summaryRows(SUMMARY_R1), [
    {
      review: "code review",
      status: "completed",
      commit: "7861351",
      at: "2026-09-05T00:25:53.728619Z",
      trigger: "pr opened",
    },
  ]);
});

test("summaryRows reads a running row as running, not as a pass", () => {
  assert.equal(summaryRows(SUMMARY_RUNNING)[0].status, "running");
});

test("summaryRows ignores a table that is not in the connector's summary comment", () => {
  // The HTML marker is the identity. A table of the same shape in anyone's
  // comment -- including one of mine quoting the connector -- is not evidence
  // that Codex said anything.
  const impostor = SUMMARY_R1.replace(SUMMARY_COMMENT_MARKER, "## My notes on the review");
  assert.deepEqual(summaryRows(impostor), []);
});

test("summaryCodeReviewPasses accepts only completed CODE reviews from the bot", () => {
  assert.equal(summaryCodeReviewPasses([botComment(1, SUMMARY_R1)]).length, 1);
  assert.equal(summaryCodeReviewPasses([botComment(1, SUMMARY_RUNNING)]).length, 0);

  // Authored by a human: the row is only as good as who wrote it.
  const mine = { id: 1, user: { login: "TheAnswerManIsHere" }, created_at: "x", body: SUMMARY_R1 };
  assert.equal(summaryCodeReviewPasses([mine]).length, 0);

  // A security review completing says nothing about the code review --
  // CLAUDE.md meters the two separately.
  const security = SUMMARY_R1.replace("**Code Review**", "**Security Review**");
  assert.equal(summaryCodeReviewPasses([botComment(1, security)]).length, 0);
});

test("summaryCodeReviewPasses dates the pass from the ROW, never the comment", () => {
  // The comment's created_at is when the PR was opened -- three minutes before
  // the review finished, and on a requested round it would fall BEFORE the
  // request that triggered it. A row with no parseable datetime is therefore
  // not a pass at all rather than one dated from the wrong clock.
  const [pass] = summaryCodeReviewPasses([botComment(1, SUMMARY_R1, "2026-09-05T00:22:57Z")]);
  assert.equal(pass.at, "2026-09-05T00:25:53.728619Z");

  const noStamp = SUMMARY_R1.replace(/ <relative-time[^>]*>[^<]*<\/relative-time>/, "");
  assert.equal(summaryCodeReviewPasses([botComment(1, noStamp)]).length, 0);
});

test("reviewerPasses counts a clean automatic round that left only a summary row", () => {
  // The measured regression: PR #15 round 1 completed, and the round check
  // reported `0 completed reviewer pass(es)` because no marker was emitted.
  const passes = reviewerPasses([], [botComment(1, SUMMARY_R1)]);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].source, "summary");
  assert.equal(passes[0].commit, "7861351");
});

test("reviewerPasses does not double-count a round that also announced", () => {
  // One comment per PR, rewritten each round: once round 2 finished, the
  // summary named cf1787f and so did the marker. Counting both would inflate
  // every marker-bearing round by one.
  const summaryR2 = SUMMARY_R1.replace("`7861351`", "`cf1787f`");
  const passes = reviewerPasses([], [botComment(1, summaryR2), MARKER_R2]);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].source, "comment");
});

test("reviewerPasses counts both when the summary names a commit no marker does", () => {
  // Round 1 clean with no marker, round 2 clean with one, and the summary has
  // since been overwritten to name round 2's commit. The marker carries round
  // 2; round 1 is simply gone from the record, which is the documented
  // residual -- undercounting in the direction that spends budget slower.
  const summaryR1Kept = SUMMARY_R1;
  const passes = reviewerPasses([], [botComment(1, summaryR1Kept), MARKER_R2]);
  assert.equal(passes.length, 2);
  assert.deepEqual(
    passes.map((p) => p.source),
    ["summary", "comment"],
  );
});

test("a review comment belongs to the review it was written FOR, not the previous one", () => {
  // GitHub creates a review's comments moments before the review is
  // submitted. Matching "latest review at or before the comment" therefore
  // attributed every comment to the PREVIOUS round, shifting `rounds.trend`
  // — the field the adjudicator's rubric weighs directly. Timestamps are
  // this repository's own PR #38: the round-4 comments landed at 16:53:30Z,
  // four seconds before the round-4 review at 16:53:34Z, and were counted
  // into round 3. (Codex found the fix; the adjudicator found the defect,
  // from the record's own numbers.)
  const reviews = [
    { id: 1, user: { login: "chatgpt-codex-connector[bot]" }, submitted_at: "2026-09-06T16:10:38Z" },
    { id: 2, user: { login: "chatgpt-codex-connector[bot]" }, submitted_at: "2026-09-06T16:53:34Z" },
  ];
  const threads = [
    {
      id: "PRRT_round4",
      comments: [
        {
          author: "chatgpt-codex-connector",
          created_at: "2026-09-06T16:53:30Z",
          body: "a round-4 finding",
          html_url: "https://github.com/o/r/pull/38#discussion_r99",
        },
      ],
    },
  ];
  const [comment] = flattenMcpThreads(threads, reviews);
  assert.equal(comment.pull_request_review_id, 2, "the comment belongs to the review submitted just after it");

  // A reply posted after the last pass still attaches to that pass.
  const later = flattenMcpThreads(
    [{ id: "PRRT_after", comments: [{ author: "chatgpt-codex-connector", created_at: "2026-09-06T17:30:00Z", body: "later", html_url: "https://github.com/o/r/pull/38#discussion_r100" }] }],
    reviews,
  );
  assert.equal(later[0].pull_request_review_id, 2);
});

// ---------------------------------------------------------------------------
// The two shapes the same snapshot file has to satisfy in two different gates
// ---------------------------------------------------------------------------

test("the head repository is read in either documented shape", () => {
  // Every validator demanded the bare string while its own refusal message
  // told the operator to take the value from `head.repo.full_name` — so a
  // capture copied in the API's own shape was refused by a message reading as
  // though the wrong field had been copied. (Round 7.)
  assert.equal(headRepoOf({ head: { repo: "TheAnswerManIsHere/AI-Handbook" } }), "TheAnswerManIsHere/AI-Handbook");
  assert.equal(
    headRepoOf({ head: { repo: { full_name: "TheAnswerManIsHere/AI-Handbook" } } }),
    "TheAnswerManIsHere/AI-Handbook",
  );
  assert.equal(headRepoOf({ head: {} }), null);
  assert.equal(headRepoOf({}), null);
  assert.equal(headRepoOf(null), null);
});

test("capturedAt is read in either shape, and the whole-snapshot view takes the oldest", () => {
  // `review-budget.mjs check` required a parseable TIMESTAMP here;
  // `review-loop-record.mjs` required an OBJECT keyed by collection. No single
  // file satisfied both, so the documented workflow — capture once, run the
  // budget check, generate the record from that same capture — could not be
  // executed. Found by running it. (Round 7.)
  const scalar = { capturedAt: "2026-09-06T17:00:00Z" };
  assert.equal(capturedAtOf(scalar), "2026-09-06T17:00:00Z");
  assert.equal(capturedAtOf(scalar, "issueComments"), "2026-09-06T17:00:00Z");

  const perCollection = {
    capturedAt: {
      pr: "2026-09-06T17:50:00Z",
      reviews: "2026-09-06T17:20:00Z",
      issueComments: "2026-09-06T17:40:00Z",
      reviewThreads: "2026-09-06T17:45:00Z",
    },
  };
  assert.equal(capturedAtOf(perCollection, "issueComments"), "2026-09-06T17:40:00Z");
  // Freshness is a property of the STALEST evidence in the file.
  assert.equal(capturedAtOf(perCollection), "2026-09-06T17:20:00Z");

  assert.equal(capturedAtOf({}), null);
  assert.equal(capturedAtOf({ capturedAt: {} }), null);
  assert.equal(capturedAtOf({ capturedAt: { reviews: "not a date" } }), null);
  assert.equal(capturedAtOf(perCollection, "files"), null);

  // A PARTIAL capture time covers nothing. Taking the oldest VALID entry and
  // shrugging at the rest let a snapshot with stale, undated `reviews` and a
  // fresh `issueComments` pass the freshness bound and mint a round-check
  // receipt from evidence nothing had dated — undercounting spent rounds in
  // the guard's own favour. (Codex, #38 round 7, on this same round's change.)
  assert.deepEqual(capturedAtDetail({ capturedAt: { issueComments: "2026-09-06T18:00:00Z" } }), {
    at: null,
    missing: ["pr", "reviews", "reviewThreads"],
    future: [],
  });
  const now = Date.parse("2026-09-06T19:00:00Z");
  assert.deepEqual(capturedAtDetail(perCollection, { now }), { at: "2026-09-06T17:20:00Z", missing: [], future: [] });
  assert.deepEqual(capturedAtDetail(scalar, { now }), { at: "2026-09-06T17:00:00Z", missing: [], future: [] });
  assert.deepEqual(capturedAtDetail({}), { at: null, missing: ["capturedAt"], future: [] });
  // Bounded on BOTH sides: a future collection is named, not averaged away by
  // the oldest. (Codex, #38 round 9.)
  assert.deepEqual(
    capturedAtDetail({ capturedAt: { ...perCollection.capturedAt, issueComments: "2026-09-06T20:00:00Z" } }, { now }),
    { at: null, missing: [], future: ["issueComments"] },
  );
  assert.deepEqual(capturedAtDetail({ capturedAt: "2026-09-06T20:00:00Z" }, { now }), { at: null, missing: [], future: ["capturedAt"] });
  // An invalid timestamp is missing, not merely skipped.
  assert.deepEqual(
    capturedAtDetail({ capturedAt: { ...perCollection.capturedAt, reviews: "whenever" } }).missing,
    ["reviews"],
  );
});
