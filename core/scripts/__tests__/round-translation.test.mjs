import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import {
  buildTranslationRecord,
  translationBrief,
  skipReason,
  passFor,
  authorRole,
  assertCaptureAfterResponse,
  assertEndpointsResolve,
  assertCapturedAfterPass,
  rootPassIds,
  assertSnapshotIsForPr,
  roundThreads,
  commentsSincePass,
  COMMENT_CAP_CHARS,
} from "../round-translation-record.mjs";
import { facts, chatLine, renderPage, receiptsFor, writePage, publishPage, pagePath, unavailable } from "../round-translation-page.mjs";
import { reviewerFindings } from "../review-loop-record.mjs";
import { parseArgs, receiptPathFor, canDispatch, dispatchableRoles, roleContract, deliverTranslation, blankDeclaredStrings, main } from "../fable-dispatch.mjs";

const SLUG = "TestOwner/TestRepo";
const PR = 81;
const HEAD = "f00dcafef00dcafef00dcafef00dcafef00dcafe";
const REVIEWED = "beefbeefbeefbeefbeefbeefbeefbeefbeefbeef";
const BOT = "chatgpt-codex-connector[bot]";
const BUILDER = "TheAnswerManIsHere";

const url = (frag) => `https://github.com/${SLUG}/pull/${PR}#${frag}`;
const T = (iso) => new Date(iso).toISOString();

/**
 * One round: a reviewer pass with two findings, the builder's replies, a
 * context comment, and a capture taken after all of it.
 */
function snapshot(over = {}) {
  const base = {
    repo: SLUG,
    pr: {
      number: PR,
      title: "Add the thing",
      created_at: T("2026-09-12T09:00:00Z"),
      closed_at: null,
      html_url: `https://github.com/${SLUG}/pull/${PR}`,
      user: { login: BUILDER },
      head: { sha: HEAD, repo: SLUG },
      base: { sha: "0".repeat(40) },
    },
    reviews: [
      {
        id: 900001,
        user: { login: BOT },
        submitted_at: T("2026-09-12T10:00:00Z"),
        commit_id: REVIEWED,
        body: "**Reviewed commit:** " + REVIEWED,
        html_url: url("pullrequestreview-900001"),
      },
    ],
    issueComments: [
      {
        id: 800001,
        user: { login: BUILDER },
        body: "Round 1 context: two findings, one fixed and one declined.",
        created_at: T("2026-09-12T10:30:00Z"),
        html_url: url("issuecomment-800001"),
      },
    ],
    reviewThreads: [
      {
        id: "PRRT_kwDOAAAA1",
        isResolved: true,
        path: "core/scripts/a.mjs",
        line: 12,
        comments: [
          {
            id: 111,
            author: BOT,
            user: { login: BOT },
            pull_request_review_id: 900001,
            body: "P1: this writes the file before checking the caller may.",
            created_at: T("2026-09-12T10:00:05Z"),
            html_url: url("discussion_r111"),
          },
          {
            id: 112,
            author: BUILDER,
            user: { login: BUILDER },
            body: "Class: in-scope. Worth: real. Fixed in abc1234 — the check now precedes the write.",
            created_at: T("2026-09-12T10:20:00Z"),
            html_url: url("discussion_r112"),
          },
        ],
      },
      {
        id: "PRRT_kwDOAAAA2",
        isResolved: false,
        path: "core/scripts/b.mjs",
        line: 40,
        comments: [
          {
            id: 121,
            author: BOT,
            user: { login: BOT },
            pull_request_review_id: 900001,
            body: "P2: a hostile value of --role would escape the allowlist.",
            created_at: T("2026-09-12T10:00:06Z"),
            html_url: url("discussion_r121"),
          },
          {
            id: 122,
            author: BUILDER,
            user: { login: BUILDER },
            body: "Class: out-of-threat-model. Declined — --role is a choice the operator types.",
            created_at: T("2026-09-12T10:25:00Z"),
            html_url: url("discussion_r122"),
          },
        ],
      },
    ],
    complete: { reviews: true, issueComments: true, reviewThreads: true },
    capturedAt: T("2026-09-12T11:00:00Z"),
  };
  return { ...base, ...over };
}

/**
 * git stub, on the STRING-returning convention `review-loop-record.mjs` uses
 * -- the one `artifactDiff` is written against. A spawn-result stub passes
 * `rev-parse` and silently turns the diff into "[unavailable]".
 */
const gitAt = (head = HEAD, patch = "diff --git a/core/scripts/a.mjs b/core/scripts/a.mjs\n+ the fix\n") => {
  return (args) => {
    if (args[0] === "rev-parse") return `${head}\n`;
    if (args[0] === "diff" && args.includes("--name-only")) return "";
    if (args[0] === "diff") return patch;
    return "";
  };
};

const build = (snap = snapshot(), round = 1, git = gitAt()) => buildTranslationRecord(snap, round, { runGit: git, now: () => T("2026-09-12T11:05:00Z") });

// ---------------------------------------------------------------------------
// The property the whole increment rests on: this record keeps the replies
// the adjudicator's record drops, and neither can become the other.
// ---------------------------------------------------------------------------

test("the D0 record carries every reply; the judge's findings from the same snapshot carry none", () => {
  const snap = snapshot();
  const record = build(snap);

  const replies = record.findings.flatMap((f) => f.comments.filter((c) => c.role === "builder"));
  assert.equal(replies.length, 2, "both builder replies survive into the D0 record");
  assert.match(replies[0].body, /Fixed in abc1234/);
  assert.match(replies[1].body, /Declined/);

  // The judge's builder, over the same snapshot, keeps root comments only.
  const judge = reviewerFindings(snap.reviewThreads);
  assert.equal(judge.length, 2);
  for (const f of judge) {
    assert.doesNotMatch(f.body ?? "", /Fixed in abc1234|Declined/, "no builder prose reaches the adjudicator's shape");
  }
});

test("every block is labelled by who wrote it, and the brief renders the label", () => {
  const record = build();
  assert.deepEqual(
    record.findings[0].comments.map((c) => c.role),
    ["reviewer", "builder"],
  );
  const brief = translationBrief(record);
  assert.match(brief, /Codex, the code reviewer, wrote/);
  assert.match(brief, /The builder \(Claude\) replied/);
  assert.match(brief, /```diff/, "the diff is in the brief as the evidence for the replies' claims");
});

test("a comment from someone who is neither reviewer nor builder is labelled `other`", () => {
  // David's own inline comment is not the builder's, and attributing one to
  // me would be wrong about the one thing this record exists to get right.
  assert.equal(authorRole(BOT, BUILDER), "reviewer");
  assert.equal(authorRole(BUILDER, BUILDER), "builder");
  assert.equal(authorRole("someone-else", BUILDER), "other");
  assert.equal(authorRole("chatgpt-codex-connector", BUILDER), "reviewer", "the bot suffix is optional");
});

// ---------------------------------------------------------------------------
// Check 1 — the round is named, not "the latest pass"
// ---------------------------------------------------------------------------

test("a later pass landing before D0 runs does not change which round is translated", () => {
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });
  const record = build(snap, 1);
  assert.equal(record.round.number, 1);
  assert.equal(record.round.of, 2, "the later pass is visible but not selected");
  assert.equal(record.round.reviewedCommit, REVIEWED);
  assert.equal(record.findings.length, 2, "round 1's findings, not round 2's zero");
});

test("--round naming a pass that does not exist is refused", () => {
  assert.throws(() => build(snapshot(), 3), /holds 1 completed reviewer pass\(es\).*no round 3/s);
  assert.throws(() => build(snapshot(), 0), /positive integer/);
});

test("passFor counts rounds with reviewerPasses, not with its own rule", () => {
  const { passes } = passFor(snapshot(), 1);
  assert.equal(passes.length, 1);
  assert.equal(passes[0].commit, REVIEWED);
});

// ---------------------------------------------------------------------------
// Check 2 — the capture must postdate the builder's last word on the round
// ---------------------------------------------------------------------------

test("a capture taken before the builder replied is refused, not translated as silence", () => {
  const snap = snapshot({ capturedAt: T("2026-09-12T10:10:00Z") });
  assert.throws(
    () => build(snap),
    /captured at .* not clearly after .* comment at .*Read the collections again/s,
  );
});

test("a capture after the last reply is accepted, and the boundary is recorded", () => {
  const record = build();
  assert.equal(record.round.respondedAt, T("2026-09-12T10:30:00Z"), "the newest non-reviewer comment");
});

test("a round nobody has replied to yet translates as awaiting a response", () => {
  // There is no boundary to beat, and "the builder has not answered" is TRUE
  // here -- refusing would withhold an accurate account.
  const snap = snapshot();
  snap.issueComments = [];
  for (const t of snap.reviewThreads) t.comments = [t.comments[0]];
  const record = build(snap);
  assert.equal(record.round.respondedAt, null);
  assert.equal(record.findings.length, 2);
});

test("a snapshot with no usable capturedAt is refused", () => {
  assert.throws(() => build(snapshot({ capturedAt: "not a date" })), /no usable capturedAt/);
});

test("the reviewer's own later comment does not count as the builder answering", () => {
  const snap = snapshot({ capturedAt: T("2026-09-12T10:40:00Z") });
  snap.reviewThreads[0].comments.push({
    id: 113,
    author: BOT,
    user: { login: BOT },
    body: "Acknowledged.",
    created_at: T("2026-09-12T23:00:00Z"),
    html_url: url("discussion_r113"),
  });
  const record = build(snap);
  assert.equal(record.round.respondedAt, T("2026-09-12T10:30:00Z"));
});

// ---------------------------------------------------------------------------
// Check 3 — the diff's endpoints, and the checkout
// ---------------------------------------------------------------------------

test("an endpoint that is not in this clone refuses, so the patch is never an empty marker", () => {
  // This replaced a HEAD-equality check that could not hold: the tree is live,
  // the dispatch is detached, and the next round proceeds while it runs. The
  // role gave up `Read` instead; what is checked is that the diff is real.
  const missing = (args) => {
    if (args[0] === "rev-parse" && args.includes("--verify")) throw new Error("unknown revision");
    return "";
  };
  assert.throws(() => assertEndpointsResolve(REVIEWED, HEAD, { runGit: missing }), /is not in this clone/);
  assert.doesNotThrow(() => assertEndpointsResolve(REVIEWED, HEAD, { runGit: () => REVIEWED }));
});

test("the diff runs from the round's reviewed commit to the snapshot's head", () => {
  const record = build();
  assert.equal(record.diff.range, `${REVIEWED}..${HEAD}`);
  assert.match(record.diff.patch, /the fix/);
});

test("a round with no push reports no diff, and says only what the diff shows", () => {
  const snap = snapshot();
  snap.reviews[0].commit_id = HEAD;
  const record = build(snap);
  assert.equal(record.diff.range, null);
  assert.match(record.diff.note, /Nothing was pushed since the commit this round reviewed/);
  // It must NOT claim the builder replied: the diff cannot see a reply, and on
  // an unanswered round that claim told the translator the round was answered.
  assert.ok(!/replied|replies/.test(record.diff.note.replace(/Whether the builder replied is in the threads above, not here\./, "")));
  assert.match(record.diff.note, /in the threads above, not here/);
});



// ---------------------------------------------------------------------------
// The skip, and what is NOT skipped
// ---------------------------------------------------------------------------

test("a clean round with nothing pushed is skipped; an all-declined round is not", () => {
  const clean = snapshot();
  clean.reviewThreads = [];
  clean.reviews[0].commit_id = HEAD;
  clean.issueComments = [];
  assert.equal(skipReason(build(clean)), "no findings and nothing pushed since the reviewed commit");

  // All-declined: findings exist, nothing was pushed. This is the round where
  // the builder's account matters most, so it is dispatched.
  const declined = snapshot();
  declined.reviews[0].commit_id = HEAD;
  assert.equal(skipReason(build(declined)), null);
});

test("a round with no findings but a push is dispatched", () => {
  const snap = snapshot();
  snap.reviewThreads = [];
  assert.equal(skipReason(build(snap)), null, "there is a change to account for");
});

test("a round whose reviewed commit is unknown is never skipped as empty", () => {
  // "Could not tell what was pushed" is not "nothing was pushed". Collapsing
  // the two would report a round as empty on the strength of a missing field
  // -- observed-false standing in for could-not-observe, which is the one
  // substitution this machinery refuses everywhere.
  const snap = snapshot();
  snap.reviewThreads = [];
  delete snap.reviews[0].commit_id;
  const record = build(snap);
  assert.equal(record.diff.pushed, null);
  assert.equal(skipReason(record), null, "it is dispatched rather than declared empty");
  assert.match(record.diff.note, /Weigh the absence as uncertainty/);
});

// ---------------------------------------------------------------------------
// Provenance and identity refusals inherited from the judge's record
// ---------------------------------------------------------------------------

test("a snapshot for another pull request is refused", () => {
  assert.throws(() => assertSnapshotIsForPr(99, snapshot()), /is for pull request #81, not #99/);
});

test("a reconstructed thread is refused", () => {
  const snap = snapshot();
  snap.reviewThreads[0].id = "thread-1";
  assert.throws(() => build(snap), /not a GitHub review-thread node id/);
});

test("a threads payload that does not attest completeness is refused", () => {
  // A truncated first page drops findings, and a round missing findings reads
  // as a round that raised fewer -- a wrong account with nothing to doubt it.
  const snap = snapshot();
  snap.complete = { reviews: true, issueComments: true };
  assert.throws(() => build(snap), /complete\.reviewThreads must be explicitly true/);
});

test("a very long comment is capped, and says so in place", () => {
  const snap = snapshot();
  snap.reviewThreads[0].comments[0].body = "x".repeat(COMMENT_CAP_CHARS + 500);
  const record = build(snap);
  assert.match(record.findings[0].comments[0].body, /\[TRUNCATED at 20000 chars of 20500\]$/);
});

test("a thread whose root carries no review id is still attributed by time", () => {
  // The MCP threads payload does not always carry pull_request_review_id, and
  // without a fallback a whole round's findings render as zero -- a clean
  // round that was not clean.
  const snap = snapshot();
  for (const t of snap.reviewThreads) delete t.comments[0].pull_request_review_id;
  const { pass } = passFor(snap, 1);
  assert.equal(roundThreads(snap, pass, BUILDER).length, 2);
});

// ---------------------------------------------------------------------------
// The three derived facts, the chat line, and the page
// ---------------------------------------------------------------------------

const receipt = (round, output, over = {}) => ({ role: "round-translation", pr: PR, round, output, finishedAt: T("2026-09-12T11:10:00Z"), ...over });
const answer = (over = {}) => ({
  summary_for_david: "The reviewer raised two points on this round.\nOne was fixed, one declined.\nNothing here should worry you.",
  what_happened: "The first point was a real ordering mistake and the builder fixed it. The second was about a value you type yourself, and the builder declined it.",
  disagreements: [],
  could_not_assess: null,
  recommendation: "Nothing to do.",
  ...over,
});

test("agrees is printed only when nothing was left unassessed", () => {
  assert.equal(chatLine(receipt(1, answer())), "round 1: agrees with the builder's account");
  assert.equal(
    chatLine(receipt(1, answer({ could_not_assess: "The diff was cut before the second file." }))),
    "round 1: partial — something could not be assessed",
    "could-not-observe is never turned into the favourable answer",
  );
});

test("any disagreement wins over both, and is counted", () => {
  const one = receipt(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }] }));
  assert.equal(chatLine(one), "round 2: differs on 1 point");
  const two = receipt(2, answer({ disagreements: [{ what: "a", why_it_matters: "b" }, { what: "c", why_it_matters: "d" }], could_not_assess: "also this" }));
  assert.equal(chatLine(two), "round 2: differs on 2 points");
});

test("a skipped round is distinguishable from all three", () => {
  const r = { role: "round-translation", pr: PR, round: 3, skipped: true, reason: "no findings and nothing pushed since the reviewed commit" };
  assert.equal(chatLine(r), "round 3: skipped — no findings and nothing pushed since the reviewed commit");
  assert.equal(facts(r).skipped, true);
});

test("an empty disagreement list is a real answer, not a missing one", () => {
  const f = facts(receipt(1, answer()));
  assert.equal(f.disagreements, 0);
  assert.equal(f.unassessed, false);
});

test("the failure notices are fixed text, not the builder's wording", () => {
  assert.equal(unavailable(4, "the snapshot was captured too early"), "round 4: translation unavailable — the snapshot was captured too early");
});

test("the page renders newest round first and shows only what the receipts hold", () => {
  const html = renderPage(
    [
      receipt(1, answer()),
      receipt(2, answer({ disagreements: [{ what: "The builder called this fixed; the diff changes a different function.", why_it_matters: "The reported problem may still be there." }] })),
    ],
    { pr: PR },
  );
  assert.ok(html.indexOf("Round 2") < html.indexOf("Round 1"), "newest first");
  assert.match(html, /The builder called this fixed/);
  assert.match(html, /verdict differs/);
  assert.match(html, /<title>Review rounds on PR #81<\/title>/);
  assert.doesNotMatch(html, /Class:|Worth:/, "the builder's thread shorthand never reaches the page");
});

test("the page marks a truncated diff independently of what the translator said", () => {
  const r = receipt(1, answer(), { record: { diff: { truncated: { keptChars: 1000, fullChars: 9000 } } } });
  assert.match(renderPage([r], { pr: PR }), /cut at 1000 of 9000 characters/);
});

test("the page escapes text rather than rendering it as markup", () => {
  const html = renderPage([receipt(1, answer({ recommendation: "<script>alert(1)</script>" }))], { pr: PR });
  assert.match(html, /&lt;script&gt;/);
  assert.doesNotMatch(html, /<script>alert/);
});

test("a skipped round renders as skipped, with its reason", () => {
  const html = renderPage([{ role: "round-translation", pr: PR, round: 1, skipped: true, reason: "no findings and nothing pushed since the reviewed commit" }], { pr: PR });
  assert.match(html, /Not translated/);
  assert.match(html, /verdict">skipped/);
});

test("the page names both themes' colours at the root, so neither renders on the other's ground", () => {
  const html = renderPage([receipt(1, answer())], { pr: PR });
  const root = html.slice(html.indexOf(":root {"), html.indexOf("@media"));
  for (const token of ["--bg:", "--ink:", "--card:", "--rule:", "--accent:", "--flag:"]) {
    assert.ok(root.includes(token), `${token} is defined on bare :root`);
  }
  assert.match(html, /prefers-color-scheme: dark/);
  assert.match(html, /\[data-theme="dark"\]/);
});

// ---------------------------------------------------------------------------
// The page and receipts on disk
// ---------------------------------------------------------------------------

function tmpRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "d0-page-"));
  fs.mkdirSync(path.join(root, ".agents/receipts"), { recursive: true });
  return root;
}

test("the page is written into a directory git ignores, and refuses if it is not", () => {
  const root = tmpRepo();
  const rel = writePage(root, PR, "<p>x</p>", { runGit: () => ({ status: 0 }) });
  assert.equal(rel, path.join(".agents/reviews", `pr-${PR}`, "translation.html"));
  assert.equal(fs.readFileSync(path.join(root, ".agents/reviews/.gitignore"), "utf8"), "*\n");
  assert.throws(() => writePage(root, PR, "<p>x</p>", { runGit: () => ({ status: 1 }) }), /is not ignored by git/);
});

test("receiptsFor reads this PR's rounds in order and ignores everything else", () => {
  const root = tmpRepo();
  const w = (name, body) => fs.writeFileSync(path.join(root, ".agents/receipts", name), JSON.stringify(body));
  w("fable-round-translation-81-2.json", receipt(2, answer()));
  w("fable-round-translation-81-1.json", receipt(1, answer()));
  w("fable-round-translation-99-1.json", { ...receipt(1, answer()), pr: 99 });
  w("fable-probe-abc1234.json", { role: "probe" });
  const got = receiptsFor(root, PR);
  assert.deepEqual(got.map((r) => r.round), [1, 2]);
});

test("the page path is derived from the PR, never supplied", () => {
  assert.equal(pagePath("/r", 81), path.join("/r", ".agents/reviews", "pr-81", "translation.html"));
});

// ---------------------------------------------------------------------------
// Dispatch wiring
// ---------------------------------------------------------------------------

test("round-translation dispatches because this script generates its brief", () => {
  assert.equal(canDispatch("round-translation"), true);
  assert.deepEqual(dispatchableRoles().sort(), ["probe", "round-translation"]);
  assert.equal(canDispatch("plan-opinion"), false, "an unbuilt role is still refused");
});

test("each role takes only its own flags, and all of them are data", () => {
  assert.throws(() => parseArgs(["--role", "probe", "--pr", "81"]), /role "probe" does not take --pr/);
  assert.throws(() => parseArgs(["--role", "round-translation", "--pr", "81", "--round", "3"]), /requires --mcp-snapshot/);
  assert.throws(() => parseArgs(["--role", "round-translation", "--pr", "x", "--round", "3", "--mcp-snapshot", "s"]), /--pr must be a whole number/);
  const ok = parseArgs(["--role", "round-translation", "--pr", "81", "--round", "3", "--mcp-snapshot", "s.json"]);
  assert.deepEqual({ pr: ok.pr, round: ok.round, snapshot: ok.snapshot }, { pr: 81, round: 3, snapshot: "s.json" });
});

test("there is still no --brief flag, and free text is still refused", () => {
  assert.throws(() => parseArgs(["--role", "round-translation", "--brief", "f"]), /unknown flag --brief/);
  assert.throws(() => parseArgs(["--role", "round-translation", "translate this nicely"]), /This command takes flags only/);
});

test("the receipt is keyed by round, so two rounds on one head do not collide", () => {
  const a = receiptPathFor("/r", { role: "round-translation", pr: 81, round: 2 });
  const b = receiptPathFor("/r", { role: "round-translation", pr: 81, round: 3 });
  assert.notEqual(a, b);
  assert.equal(path.basename(a), "fable-round-translation-81-2.json");
  // The probe is untouched: still keyed by head.
  assert.equal(path.basename(receiptPathFor("/r", { role: "probe", headAtSpawn: "abcdef1234567" })), "fable-probe-abcdef1.json");
});

test("the shipped role definition and schema satisfy the launch contract", () => {
  const dir = fs.existsSync("core/.agents/fable-roles") ? "core/.agents/fable-roles" : ".agents/fable-roles";
  const definitionPath = path.join(dir, "fable-round-translation.md");
  const text = fs.readFileSync(definitionPath, "utf8");
  const contract = roleContract(text, { role: "round-translation", definitionPath, definitionCommit: "HEAD" });
  assert.deepEqual(contract.tools, [], "`tools: none` is an explicit empty allowlist, not an omission");
  assert.equal(contract.modelTier, "strongestClaude", "a tier, never a version");
  assert.ok(contract.budgetUsd > 0);
  const schema = JSON.parse(fs.readFileSync(path.join(dir, contract.schemaPath), "utf8"));
  assert.deepEqual(schema.required.sort(), ["could_not_assess", "disagreements", "recommendation", "summary_for_david", "what_happened"]);
  assert.equal(schema.additionalProperties, false);
  assert.match(contract.systemPrompt, /cannot read code/, "the role's own text names its reader");
  assert.match(contract.systemPrompt, /hold no tools/, "and says it has no file to open");
});

// ---------------------------------------------------------------------------
// Round 1 of PR #81 — one regression test per finding, each failing before
// its fix. The first is the one my own fixture hid: it carried a field the
// real assembler never emits.
// ---------------------------------------------------------------------------

/** A snapshot shaped the way `snapshot-from-captures.mjs` actually emits one. */
function assembled(over = {}) {
  const snap = snapshot(over);
  // normaliseThread emits no `pull_request_review_id` on thread comments.
  for (const t of snap.reviewThreads) for (const c of t.comments) delete c.pull_request_review_id;
  return snap;
}

test("R1: each finding belongs to exactly one round, on a snapshot shaped like the real one", () => {
  // Before the fix: the primary key was absent from every captured thread, so
  // attribution fell through to a ±6h window and two rounds an hour apart each
  // collected BOTH rounds' findings. Measured: round 1 reported 2, round 2
  // reported the same 2.
  const snap = assembled();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T11:00:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });
  snap.reviewThreads.push({
    id: "PRRT_kwDOAAAA3",
    isResolved: false,
    path: "core/scripts/c.mjs",
    line: 7,
    comments: [
      { id: 131, author: BOT, user: { login: BOT }, body: "round 2's only finding", created_at: T("2026-09-12T11:00:05Z"), html_url: url("discussion_r131") },
    ],
  });
  snap.capturedAt = T("2026-09-12T12:00:00Z");

  const r1 = build(snap, 1);
  const r2 = build(snap, 2);
  assert.equal(r1.findings.length, 2, "round 1 keeps its own two");
  assert.equal(r2.findings.length, 1, "round 2 gets only its own");
  assert.doesNotMatch(JSON.stringify(r1.findings), /round 2's only finding/);
  assert.doesNotMatch(JSON.stringify(r2.findings), /writes the file before/);
});

test("R1: attribution comes from flattenMcpThreads, so a finding's round matches every other count", () => {
  const byRoot = rootPassIds(assembled());
  assert.deepEqual([...byRoot.values()], [900001, 900001], "both roots bound to the one pass that exists");
});

test("R2: a snapshot with no pull request author is refused, not silently labelled `other`", () => {
  // The assembler dropped `pr.user`, so every builder reply read as `other`
  // and the provenance the translator weighs quietly stopped meaning anything.
  const snap = snapshot();
  delete snap.pr.user;
  assert.throws(() => build(snap), /no pull request author.*labelled `other`/s);
});

test("R3: the diff is a two-dot range, so a rewritten history cannot hide what changed", () => {
  // `a...b` measures from the merge base, which after a permitted
  // --force-with-lease rewrite is not the reviewed commit.
  let seen = null;
  const spy = (args) => {
    if (args[0] === "rev-parse") return `${HEAD}\n`;
    if (args[0] === "diff" && args.includes("--name-only")) return "";
    if (args[0] === "diff") {
      seen = args.find((a) => a.includes(".."));
      return "patch";
    }
    return "";
  };
  build(snapshot(), 1, spy);
  assert.equal(seen, `${REVIEWED}..${HEAD}`);
  assert.ok(!seen.includes("..."), "three dots would measure from the merge base");
});

test("R4: threads captured before the round's own pass are refused", () => {
  // A mixed snapshot -- reviews fresh, threads stale -- holds none of the
  // round's findings, so it would translate or skip as clean.
  const snap = snapshot({
    capturedAt: {
      pr: T("2026-09-12T11:00:00Z"),
      reviews: T("2026-09-12T11:00:00Z"),
      issueComments: T("2026-09-12T11:00:00Z"),
      reviewThreads: T("2026-09-12T09:30:00Z"),
    },
  });
  assert.throws(() => build(snap), /reviewThreads was captured before round 1's pass.*translated -- or skipped -- as clean/s);
});

test("R4: assertCapturedAfterPass refuses a pass with no readable time", () => {
  assert.throws(() => assertCapturedAfterPass(snapshot(), { at: "nonsense" }, 2), /round 2's reviewer pass carries an unparseable timestamp/);
});

test("R5: an abbreviated pass commit on the current head counts as no push", () => {
  // A summary-comment pass carries the 7-40 char sha from its marker while
  // pr.head.sha is the full 40, so `!==` called a clean pass "pushed".
  const snap = snapshot();
  snap.reviews[0].commit_id = HEAD.slice(0, 10);
  snap.reviewThreads = [];
  const record = build(snap);
  assert.equal(record.diff.pushed, false, "prefix-tolerant, like reviewerPasses");
  assert.equal(skipReason(record), "no findings and nothing pushed since the reviewed commit");
});

test("R7: a snapshot from another repository is refused even when the PR number matches", () => {
  const foreign = snapshot({ repo: "SomeoneElse/OtherRepo" });
  foreign.pr.head.repo = "SomeoneElse/OtherRepo";
  assert.throws(() => assertSnapshotIsForPr(PR, foreign, { slug: SLUG }), /captured from SomeoneElse\/OtherRepo, but this checkout is TestOwner\/TestRepo/);
  assert.throws(() => assertSnapshotIsForPr(PR, { pr: { number: PR } }, { slug: SLUG }), /names no repository/);
  assert.doesNotThrow(() => assertSnapshotIsForPr(PR, snapshot(), { slug: SLUG }));
});

test("R10: a multiline refusal becomes one line for chat, with the full text on stderr", () => {
  // SIGN_IN_HINT is a numbered list; pasting it turns a fixed status line into
  // a wall of operator instructions.
  const multi = "the provider is unavailable\n  1. npm install @openai/codex\n  2. log in";
  const line = unavailable(3, multi.split("\n")[0]);
  assert.equal(line, "round 3: translation unavailable — the provider is unavailable");
  assert.ok(!line.includes("\n"));
});

test("R8: a delivery failure still prints one fixed line, and exits non-zero", () => {
  // The reviewer had already run. Before the fix a receipt-write, page-render
  // or check-ignore failure threw loose and the loop had NO verbatim status to
  // paste -- worst on the last round before a merge ask, the one the contract
  // says must carry it.
  const root = tmpRepo();
  fs.rmSync(path.join(root, ".agents"), { recursive: true, force: true });
  fs.writeFileSync(path.join(root, ".agents"), "a file where the directory should be");
  const out = [];
  const write = process.stdout.write;
  process.stdout.write = (s) => (out.push(s), true);
  let code;
  try {
    code = deliverTranslation(root, { role: "round-translation", pr: PR, round: 4, output: answer() });
  } finally {
    process.stdout.write = write;
  }
  assert.equal(code, 1, "non-zero, so a caller cannot read it as delivered");
  assert.equal(out.length, 1, "exactly one line");
  assert.match(out[0], /^round 4: translation unpublished — /);
  assert.equal(out[0].trimEnd().includes("\n"), false);
});

// ---------------------------------------------------------------------------
// Round 3's four findings, closed on David's instruction after the loop had
// stopped. One test each, every one of them failing before its fix.
// ---------------------------------------------------------------------------

test("R11: a later pass's PR-level comments stay out of the earlier round's brief", () => {
  // The race this record explicitly supports: round 2 lands before round 1 is
  // translated -- a re-run, a catch-up, or a dispatch still in flight. With a
  // lower bound only, round 2's context comment and every reply after it were
  // collected into round 1's brief, so David's round-1 account was partly
  // about round 2. (Codex, #81 round 3.)
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });
  // The trigger precedes round 2's pass and belongs to round 1; the context
  // comment follows it and belongs to round 2.
  snap.issueComments.push(
    { id: 800002, user: { login: BUILDER }, body: "atC0dex r3view", created_at: T("2026-09-12T10:40:00Z"), html_url: url("issuecomment-800002") },
    { id: 800003, user: { login: BUILDER }, body: "Round 2 context: one finding.", created_at: T("2026-09-12T10:50:00Z"), html_url: url("issuecomment-800003") },
  );

  const bodies = (r) => r.commentsSincePass.map((c) => c.body);

  const round1 = build(snap, 1);
  assert.deepEqual(
    bodies(round1),
    ["Round 1 context: two findings, one fixed and one declined.", "atC0dex r3view"],
    "round 1 keeps its own context and the trigger it posted, and stops at round 2's pass",
  );
  assert.ok(!bodies(round1).some((b) => b.includes("Round 2 context")), "round 2's context is round 2's");

  const round2 = build(snap, 2);
  assert.deepEqual(bodies(round2), ["Round 2 context: one finding."], "the latest round's window is still open-ended");
});

test("R11: commentsSincePass with no next pass is unbounded, as every caller had it", () => {
  const snap = snapshot();
  const pass = passFor(snap, 1).pass;
  assert.equal(commentsSincePass(snap, pass, BUILDER).length, 1);
  assert.equal(commentsSincePass(snap, pass, BUILDER, null).length, 1);
});

test("R12: a document with blank declared-non-empty strings is not accepted", () => {
  // Schema-valid and says nothing: chatLine() would print "agrees with the
  // builder's account" over a page with no account on it -- the favourable
  // reading of a field nothing looked at. (Codex, #81 round 3.)
  const schema = JSON.parse(
    fs.readFileSync(new URL("../../.agents/fable-roles/schemas/fable-round-translation.schema.json", import.meta.url), "utf8"),
  );
  const empty = { summary_for_david: "", what_happened: "   ", disagreements: [], could_not_assess: null, recommendation: "" };

  // The receipt-side check, which is what actually runs: the schema is handed
  // to the harness and what it enforces beyond shape is not this script's.
  assert.deepEqual(
    blankDeclaredStrings(schema, empty).sort(),
    ["recommendation", "summary_for_david", "what_happened"],
    "every blank field is named, so the re-ask says what was wrong",
  );
  // And the thing the blank document would otherwise have produced.
  assert.equal(chatLine({ round: 3, answer: empty }), "round 3: agrees with the builder's account");

  // Strings inside a disagreement item are declared too, and reported by path.
  const hollow = { ...answer(), disagreements: [{ what: "a real point", why_it_matters: "" }] };
  assert.deepEqual(blankDeclaredStrings(schema, hollow), ["disagreements[0].why_it_matters"]);

  // A complete document is clean, and an absent minLength is still no check.
  assert.deepEqual(blankDeclaredStrings(schema, answer()), []);
  assert.deepEqual(blankDeclaredStrings({ properties: { x: { type: "string" } } }, { x: "" }), []);
});

test("R13: a round-translation argument failure prints the fixed line, not a raw diagnostic", () => {
  // parseArgs throws before runTranslation can emit anything, so the log's
  // last line -- which the skill says to paste verbatim -- was a technical
  // error David has no reason to recognise. (Codex, #81 round 3.)
  const out = [];
  const err = [];
  const so = process.stdout.write;
  const se = process.stderr.write;
  process.stdout.write = (s) => (out.push(s), true);
  process.stderr.write = (s) => (err.push(s), true);
  let code;
  try {
    code = main(["--role", "round-translation", "--pr", String(PR), "--round", "3"]);
  } finally {
    process.stdout.write = so;
    process.stderr.write = se;
  }
  assert.equal(code, 1, "still non-zero, so the exit file records a failure");
  assert.equal(out.length, 1, "exactly one line for chat");
  assert.equal(out[0], "round 3: translation unavailable — role \"round-translation\" requires --mcp-snapshot\n");
  assert.match(err.join(""), /requires --mcp-snapshot/, "the diagnostic still goes to stderr");
});

test("R13: an unparseable round says so rather than inventing one, and other roles are untouched", () => {
  const run = (argv) => {
    const out = [];
    const so = process.stdout.write;
    const se = process.stderr.write;
    process.stdout.write = (s) => (out.push(s), true);
    process.stderr.write = () => true;
    try {
      return { code: main(argv), out };
    } finally {
      process.stdout.write = so;
      process.stderr.write = se;
    }
  };

  const bad = run(["--role", "round-translation", "--pr", String(PR), "--round", "not-a-number"]);
  assert.equal(bad.out.length, 1);
  assert.match(bad.out[0], /^round \?: translation unavailable — /, "`?` rather than a round the operator did not name");

  // A bare role name is not `--role`, so argv[roleAt + 1] must not be read off
  // a missing flag: the probe and every other role keep a silent stdout.
  const probe = run(["--role", "probe", "--pr"]);
  assert.equal(probe.out.length, 0, "only round-translation owes a chat line");
  const positional = run(["round-translation"]);
  assert.equal(positional.out.length, 0, "no --role flag, so no round-translation invocation to report");
});

test("R12: the emptiness check is WIRED into the dispatch, not merely exported", () => {
  // Measured, not assumed: with the call removed from the `problems` chain the
  // test above still passes, because it exercises the function directly. That
  // is the hollow-test class D0 caught on R10 in round 2, and a static check is
  // the idiom this repo already uses for the `pathToFileURL` form. Source-level
  // because the real path runs a reviewer: it cannot be driven from a unit test.
  const src = fs.readFileSync(new URL("../fable-dispatch.mjs", import.meta.url), "utf8");
  const call = /const blank = blankDeclaredStrings\(schemaParsed, result\.structured_output\);/;
  assert.match(src, call, "the accepted document is checked before it becomes a receipt");

  // And it must feed `problems` -- which earns P4's one re-ask and then its
  // refusal -- rather than throwing past it or being logged and ignored.
  const between = src.slice(src.search(call), src.indexOf("if (problems.length) {", src.search(call)));
  assert.match(between, /problems\.push\(/, "a blank document joins `problems`, so it gets the same one re-ask");

  // The schema it validates against is the role's own, read at the spawn
  // commit -- so a role that declares no minLength still gets no check.
  assert.match(src, /schemaParsed = JSON\.parse\(schemaJson\)/, "the parsed schema is kept, not discarded");
});

test("R11: the brief labels which comment window it is showing", () => {
  // The heading is the reviewer's provenance label. On a round that is not the
  // latest the window is a bounded slice, and calling it "since this round
  // returned" would present a partial view as a complete one.
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: HEAD,
    body: "**Reviewed commit:** " + HEAD,
    html_url: url("pullrequestreview-900002"),
  });

  const bounded = translationBrief(build(snap, 1));
  assert.match(bounded, /## Said on the pull request itself between this round and the next one \(2026-09-12T10:00:00\.000Z to 2026-09-12T10:45:00\.000Z\)/);
  assert.ok(!bounded.includes("since this round returned"), "not described as everything that followed");

  const open = translationBrief(build(snapshot(), 1));
  assert.match(open, /## Said on the pull request itself since this round returned \(nothing has followed it\)/);
});

test("R14: a capture inside the reply's own second is refused, not read as later", () => {
  // GitHub dates comments to the second, so a reply written at 10:30:00.600
  // arrives as 10:30:00.000. A capture at 10:30:00.100 is genuinely EARLIER
  // than the reply and would miss it, while comparing as later. The repository
  // already spells this rule `<= acceptedAt + 999` in collectionsReadBefore.
  const inSameSecond = snapshot({ capturedAt: "2026-09-12T10:30:00.100Z" });
  assert.throws(() => build(inSameSecond), /not clearly after .* GitHub dates\s+comments to the second/s);

  // The exact instant is refused too: nothing shows the capture came after.
  assert.throws(() => build(snapshot({ capturedAt: "2026-09-12T10:30:00.000Z" })), /not clearly after/);

  // Clearing the whole second is enough, and is what a real capture does.
  assert.doesNotThrow(() => build(snapshot({ capturedAt: "2026-09-12T10:30:01.000Z" })));
});

test("R15: an overlapping thread page counts one finding, not two", () => {
  // Two concatenated captured pages that overlap are a supported input shape --
  // reviewerPasses deduplicates reviews by id for exactly this reason. A
  // repeated thread numbered twice tells David a finding was raised twice and
  // disagrees with every mechanical count of the same round.
  const snap = snapshot();
  const clean = build(snap);
  assert.equal(clean.findings.length, 2, "two distinct findings to begin with");

  const overlapped = snapshot();
  overlapped.reviewThreads = [...overlapped.reviewThreads, overlapped.reviewThreads[0]];
  const record = build(overlapped);
  assert.equal(record.findings.length, 2, "the repeated thread is one finding");
  assert.deepEqual(
    record.findings.map((f) => f.n),
    [1, 2],
    "and the numbering has no gap or repeat",
  );
});

test("R16: a concurrent delivery's round cannot be overwritten out of the page", () => {
  // Every round is dispatched detached, so two deliveries overlap: A
  // enumerates its own receipt only, B writes its receipt and publishes the
  // complete page, then A's write lands from its stale list and B's round is
  // gone. Waiting on every exit file does not catch it -- both rounds ran.
  const root = tmpRepo();
  const receipts = path.join(root, ".agents", "receipts");
  fs.mkdirSync(receipts, { recursive: true });
  const put = (round) =>
    fs.writeFileSync(
      path.join(receipts, `fable-round-translation-${PR}-${round}.json`),
      JSON.stringify({ role: "round-translation", pr: PR, round, output: answer() }),
    );

  put(1);
  // A is inside publishPage having seen only round 1; B lands round 2 between
  // A's enumeration and A's re-read. `publishPage` re-reads after writing, so A
  // repairs the page it just made stale.
  const realRead = fs.readdirSync;
  let calls = 0;
  fs.readdirSync = (...args) => {
    calls += 1;
    if (calls === 2) put(2); // B's receipt appears after A's first enumeration
    return realRead(...args);
  };
  let rel;
  try {
    rel = publishPage(root, PR, { runGit: () => ({ status: 0 }) });
  } finally {
    fs.readdirSync = realRead;
  }

  const html = fs.readFileSync(path.join(root, rel), "utf8");
  assert.match(html, /Round 1/, "round 1 is on the page");
  assert.match(html, /Round 2/, "and so is the round that landed mid-publish");
});

test("R16: the page is written atomically, so no reader sees it half-built", () => {
  const src = fs.readFileSync(new URL("../round-translation-page.mjs", import.meta.url), "utf8");
  assert.match(src, /fs\.renameSync\(tmp, file\)/, "rename, not a truncating write into the live path");
  assert.ok(!/fs\.writeFileSync\(file, /.test(src), "nothing writes the live page path directly");
});

// ---------------------------------------------------------------------------
// Round 5's fixes, and the re-run rule David settled on 2026-09-13:
// a re-run fills a hole, it never replaces an account.
// ---------------------------------------------------------------------------

test("R17: an old round's diff stops at the next pass's commit, not the live head", () => {
  // The catch-up case `runTranslation` supports: round 1 was never translated,
  // rounds 2+ have landed, close-out wants it. Against the live head the brief
  // carries round 2's code under round 1's heading. The comment window was
  // bounded in c11dae0 and the diff window was not -- half a fix.
  const NEXT = "1111111111111111111111111111111111111111";
  const snap = snapshot();
  snap.reviews.push({
    id: 900002,
    user: { login: BOT },
    submitted_at: T("2026-09-12T10:45:00Z"),
    commit_id: NEXT,
    body: "**Reviewed commit:** " + NEXT,
    html_url: url("pullrequestreview-900002"),
  });

  const ranges = [];
  const spy = (args) => {
    if (args[0] === "rev-parse") return `${HEAD}\n`;
    if (args[0] === "diff" && args.includes("--name-only")) return "";
    if (args[0] === "diff") {
      ranges.push(args.find((a) => a.includes("..")));
      return "diff --git a/x b/x\n+ y\n";
    }
    return "";
  };

  const old = buildTranslationRecord(snap, 1, { runGit: spy, now: () => T("2026-09-12T11:05:00Z") });
  assert.equal(old.diff.range, `${REVIEWED}..${NEXT}`, "far end is the next pass's commit");
  assert.ok(ranges.every((r) => r.endsWith(NEXT)), "git was asked for that range, not the head");
  assert.equal(old.pr.headSha, HEAD, "the PR's own head is still reported as the PR's head");

  // The latest round still runs to the live head -- there is no next pass.
  ranges.length = 0;
  const latest = buildTranslationRecord(snap, 2, { runGit: spy, now: () => T("2026-09-12T11:05:00Z") });
  assert.equal(latest.diff.range, `${NEXT}..${HEAD}`);
});

test("R18: the brief does not name who resolved a thread", () => {
  // The snapshot carries isResolved and no resolver identity; David or any
  // maintainer can resolve one. Naming the builder invented provenance inside
  // the role whose boundary is that every block says where it came from.
  const brief = translationBrief(build());
  assert.match(brief, /_This thread is marked resolved\._/);
  assert.ok(!/builder marked/i.test(brief), "no actor is attributed to the resolution");
  assert.match(brief, /_This thread is still open\._/, "the open case is unchanged");
});

test("R19: a re-run fills a hole and refuses to replace an account", () => {
  const root = tmpRepo();
  const receipts = path.join(root, ".agents", "receipts");
  fs.mkdirSync(receipts, { recursive: true });
  const snapPath = path.join(root, "snap.json");
  fs.writeFileSync(snapPath, JSON.stringify(snapshot()));

  const run = () => {
    const out = [];
    const so = process.stdout.write;
    const se = process.stderr.write;
    process.stdout.write = (s) => (out.push(s), true);
    process.stderr.write = () => true;
    const cwd = process.cwd();
    try {
      process.chdir(root);
      return { code: main(["--role", "round-translation", "--pr", String(PR), "--round", "1", "--mcp-snapshot", snapPath]), out };
    } finally {
      process.chdir(cwd);
      process.stdout.write = so;
      process.stderr.write = se;
    }
  };

  // With a receipt already present the run is refused BEFORE the dispatch, so
  // a re-run never bills a reviewer for an account it would not be allowed to
  // write. The notice is the fixed one, on one line, as every other failure.
  fs.writeFileSync(
    path.join(receipts, `fable-round-translation-${PR}-1.json`),
    JSON.stringify({ role: "round-translation", pr: PR, round: 1, output: answer() }),
  );
  const blocked = run();
  assert.equal(blocked.code, 1);
  assert.equal(blocked.out.length, 1, "one fixed line");
  assert.match(blocked.out[0], /^round 1: translation unavailable — already translated; delete /);
  // The REMEDY survives the 160-character chat-line bound -- an
  // explanation-first message loses it to the ellipsis, which was measured.
  assert.match(blocked.out[0], /delete \.agents\/receipts\/fable-round-translation-81-1\.json to replace it/);
  assert.ok(!blocked.out[0].includes("…"), "nothing actionable was truncated away");
  assert.equal(blocked.out[0].trimEnd().includes("\n"), false);

  // Removing it turns the re-run back into hole-filling, which is allowed --
  // the legitimate cases (provider down, refusal on a stale capture, a round
  // never translated) all leave no receipt behind.
  fs.rmSync(path.join(receipts, `fable-round-translation-${PR}-1.json`));
  const allowed = run();
  assert.ok(!/already has a translation/.test(allowed.out.join("")), "no longer refused on that ground");
});

test("R19: publishPage's size comparison is sound only because replacement is refused", () => {
  // Stated as a dependency rather than assumed: with replacement refused the
  // receipt set can only grow, so a changed count is the only change available
  // and comparing sizes is comparing contents. If the refusal is ever relaxed,
  // this comparison silently stops holding -- which is what D0 found.
  const dispatch = fs.readFileSync(new URL("../fable-dispatch.mjs", import.meta.url), "utf8");
  assert.match(dispatch, /already has a translation/, "the refusal exists");
  assert.match(dispatch, /fs\.existsSync\(existing\)/, "and it is what gates the dispatch");

  const page = fs.readFileSync(new URL("../round-translation-page.mjs", import.meta.url), "utf8");
  assert.match(page, /COMPARING THE SET'S SIZE IS COMPARING ITS CONTENTS/, "the dependency is written down where it is relied on");
  assert.match(page, /runTranslation. refuses to overwrite/, "and it names what it depends on");
});
