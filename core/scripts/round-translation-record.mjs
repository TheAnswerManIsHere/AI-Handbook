#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * The record D0 reads: one code-review round, whole, labelled by who wrote
 * what.
 *
 * WHY A SECOND RECORD SHAPE AND NOT A FLAG ON THE FIRST
 * ----------------------------------------------------
 * `review-loop-record.mjs`'s `reviewerFindings` reads a thread's ROOT comment
 * and drops every reply, and its own comment says why: "the builder's replies
 * are exactly the channel the adjudicator must not read." D0's job is the
 * opposite -- it explains what the builder did with each finding, so it needs
 * the replies. Those are two different readers, and a shared shape with a
 * `withReplies` flag would put one switch between the judge and the prose it
 * must not see. So the judge's builder keeps dropping replies by construction,
 * and this one keeps them, and neither can become the other by an argument.
 *
 * WHAT THE TRANSLATOR IS PROTECTED FROM, AND WHAT IT IS NOT
 * --------------------------------------------------------
 * Not from the builder's words: it reads them deliberately, because
 * explaining them is the job. **It is told where each piece came from**
 * (David, 2026-09-12: "I'm not worried about the adjudicator seeing
 * information that the builder is providing, so long as it knows where it
 * came from"), which is the whole of the provenance mechanism here. Every
 * comment carries a `role` -- reviewer, builder, other -- and the brief
 * renders that label above each block. No code is written to keep the
 * builder's text away from this reviewer.
 *
 * THE THREE CHECKS, AND WHY EACH ONE EXISTS
 * -----------------------------------------
 * This record is prose evidence for a human, not a ledger, so it refuses
 * exactly three things -- each one a WRONG ACCOUNT David would read as true,
 * which is the only consequence worth a check here (David, 2026-09-12):
 *
 *   1. The round is NAMED, not "the latest pass". Codex's next pass can land
 *      before D0 runs, and then "latest" is a different round than the one
 *      just answered -- so the round just closed would silently vanish.
 *   2. The capture must be NEWER than the builder's last word on the round.
 *      Otherwise a read taken before the replies were posted translates as
 *      "the builder did not respond", about a round that was answered.
 *   3. The diff comes from the SNAPSHOT's head, and the checkout must be
 *      sitting on it. The reviewer holds `Read`, so a checkout on another
 *      branch would have it checking the builder's claims against unrelated
 *      files.
 *
 * Nothing here requires every finding to carry a reply, counts anything, or
 * reconciles the output against the input. A translation that misses a
 * finding produces a paragraph missing a finding, which is visible on the
 * page and costs nothing else.
 *
 * There is no CLI here on purpose: `fable-dispatch.mjs --role round-translation`
 * is the one entry point, and a second argument parser for the same three
 * flags would be a second source of truth for what they mean.
 */
import { execFileSync } from "node:child_process";

import { REPO_ROOT, repoSlug } from "./review-budget.mjs";
import {
  REVIEWER_LOGINS,
  normalizeLogin,
  reviewerPasses,
  assertMcpSnapshotShape,
  assertMcpSnapshotComplete,
  capturedAtOf,
} from "./review-counting.mjs";
import { assertThreadProvenance, assertCapturedProvenance, artifactDiff } from "./review-loop-record.mjs";

export const KIND = "round-translation";

/** Per-comment body cap. Generous: the translator is explaining these. */
export const COMMENT_CAP_CHARS = 20_000;

/**
 * The STRING-returning convention, throwing on failure.
 *
 * Deliberately the same shape `review-loop-record.mjs` uses, because this
 * file hands `runGit` straight to its `artifactDiff`. A spawn-result shape
 * here looked fine and made the diff come back as the "[unavailable]" marker
 * -- an empty account of what the builder pushed, which is the one kind of
 * quiet wrongness this record exists to avoid. Found by running it.
 */
function defaultGit(args, { cwd = REPO_ROOT } = {}) {
  return execFileSync("git", args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 }).trim();
}

/**
 * Who wrote a comment, as a label rather than a filter.
 *
 * `other` is deliberately its own value rather than being folded into
 * `builder`: David's own inline comments on a PR are neither, and a
 * translation that attributed one to me would be wrong about the one thing
 * this record exists to get right.
 */
export function authorRole(login, builderLogin) {
  const who = normalizeLogin(login);
  if (REVIEWER_LOGINS.has(who) || REVIEWER_LOGINS.has(login)) return "reviewer";
  if (builderLogin && who === normalizeLogin(builderLogin)) return "builder";
  return "other";
}

const cap = (body) =>
  typeof body !== "string"
    ? null
    : body.length <= COMMENT_CAP_CHARS
      ? body
      : `${body.slice(0, COMMENT_CAP_CHARS)}\n[TRUNCATED at ${COMMENT_CAP_CHARS} chars of ${body.length}]`;

/**
 * The named pass, or a refusal that says which passes exist.
 *
 * Passes come from `reviewerPasses` -- the same derivation the budget guard
 * and the judge's record use. A round number here means exactly what it means
 * everywhere else in this machinery, because it is the same function.
 */
export function passFor(snapshot, round) {
  const passes = reviewerPasses(snapshot.reviews ?? [], snapshot.issueComments ?? []);
  if (!Number.isInteger(round) || round < 1) {
    throw new Error(`--round must be a positive integer naming a completed reviewer pass (got ${JSON.stringify(round)})`);
  }
  if (round > passes.length) {
    throw new Error(
      `this snapshot holds ${passes.length} completed reviewer pass(es), so there is no round ${round} to ` +
        `translate. Rounds are counted by reviewerPasses, the same way the budget guard counts them.`,
    );
  }
  return { pass: passes[round - 1], passes };
}

/**
 * Every comment on the round's own threads, plus the PR-level comments posted
 * after it -- each labelled, none dropped.
 *
 * A thread belongs to the round when its ROOT comment was authored by the
 * reviewer during that pass. That is `findingsByRound`'s rule, applied to
 * whole threads instead of to a count.
 */
export function roundThreads(snapshot, pass, builderLogin) {
  const out = [];
  let n = 0;
  for (const thread of snapshot.reviewThreads ?? []) {
    const root = thread.comments?.[0];
    if (!root) continue;
    if (authorRole(root.author ?? root.user?.login, builderLogin) !== "reviewer") continue;
    if (!pass.reviewIds.includes(root.pull_request_review_id) && !withinPass(root, pass)) continue;
    n += 1;
    out.push({
      n,
      path: thread.path ?? root.path ?? null,
      line: thread.line ?? root.line ?? null,
      resolved: typeof thread.isResolved === "boolean" ? thread.isResolved : null,
      comments: (thread.comments ?? []).map((c) => ({
        author: c.author ?? c.user?.login ?? null,
        role: authorRole(c.author ?? c.user?.login, builderLogin),
        at: c.created_at ?? null,
        body: cap(c.body),
      })),
    });
  }
  return out;
}

/**
 * The fallback when a captured thread carries no `pull_request_review_id`.
 *
 * The MCP threads payload does not always carry it, and without a fallback a
 * whole round's findings would silently render as zero -- a clean-looking
 * round that was not clean, which is the class of wrong account this file
 * refuses everywhere else. Time is what remains: a root comment authored at
 * the pass's own submission time belongs to it. The window matches
 * `review-counting.mjs`'s own authoring window.
 */
const AUTHORING_WINDOW_MS = 6 * 60 * 60 * 1000;
function withinPass(root, pass) {
  if (root.pull_request_review_id != null) return false;
  const at = Date.parse(root.created_at ?? "");
  const passAt = Date.parse(pass.at ?? "");
  if (!Number.isFinite(at) || !Number.isFinite(passAt)) return false;
  return Math.abs(at - passAt) <= AUTHORING_WINDOW_MS;
}

/** PR-level comments the builder posted after the pass — context, declines, the trigger. */
export function commentsSincePass(snapshot, pass, builderLogin) {
  const passAt = Date.parse(pass.at ?? "");
  return (snapshot.issueComments ?? [])
    .filter((c) => Number.isFinite(Date.parse(c.created_at ?? "")) && Date.parse(c.created_at) >= passAt)
    .map((c) => ({
      author: c.user?.login ?? c.author ?? null,
      role: authorRole(c.user?.login ?? c.author, builderLogin),
      at: c.created_at,
      body: cap(c.body),
    }));
}

/**
 * CHECK 2: the capture must be newer than the builder's last word on the round.
 *
 * Returns the newest non-reviewer comment across the round's threads and the
 * PR comments since the pass, so the refusal can name it. A round nobody has
 * replied to yet has no boundary to beat, and translating it is legitimate --
 * it simply reads as a round awaiting a response, which is true.
 */
export function assertCaptureAfterResponse(snapshot, threads, sinceComments) {
  const candidates = [
    ...threads.flatMap((t) => t.comments.filter((c) => c.role !== "reviewer")),
    ...sinceComments.filter((c) => c.role !== "reviewer"),
  ]
    .map((c) => ({ at: Date.parse(c.at ?? ""), author: c.author }))
    .filter((c) => Number.isFinite(c.at))
    .sort((a, b) => b.at - a.at);
  if (!candidates.length) return null;
  const newest = candidates[0];
  const capturedAt = Date.parse(capturedAtOf(snapshot) ?? "");
  if (!Number.isFinite(capturedAt)) {
    throw new Error("the snapshot carries no usable capturedAt, so nothing establishes that it was read after the round was answered");
  }
  if (capturedAt < newest.at) {
    throw new Error(
      `this snapshot was captured at ${new Date(capturedAt).toISOString()}, before ${newest.author ?? "the builder"} ` +
        `commented at ${new Date(newest.at).toISOString()}. Translating it would tell David the round went ` +
        `unanswered when it was answered. Read the collections again -- recovering the earlier read cannot fix it.`,
    );
  }
  return new Date(newest.at).toISOString();
}

/**
 * CHECK 3: the diff's endpoints are the snapshot's, and the checkout is there.
 *
 * `review-loop-record.mjs` already binds its patch to the snapshot's head for
 * this reason; the added half is the working tree, because this reviewer can
 * read it.
 */
export function assertCheckoutAtHead(headSha, { runGit = defaultGit } = {}) {
  let at;
  try {
    at = String(runGit(["rev-parse", "HEAD"])).trim();
  } catch (e) {
    throw new Error(`could not read HEAD (${e.message}), so nothing establishes which commit the reviewer would be reading`);
  }
  if (!at) throw new Error("could not read HEAD, so nothing establishes which commit the reviewer would be reading");
  if (at !== headSha) {
    throw new Error(
      `the checkout is at ${at.slice(0, 7)} but this snapshot's pull request head is ${String(headSha).slice(0, 7)}. ` +
        `The translator reads files from this working tree, so it would be checking the builder's claims against ` +
        `another branch. Check out the pull request head and run it again.`,
    );
  }
  return at;
}

/** The record. Everything above, assembled and refused where it cannot be honest. */
export function buildTranslationRecord(snapshot, round, { runGit = defaultGit, now = () => new Date().toISOString() } = {}) {
  assertMcpSnapshotShape(snapshot);
  // Completeness is not optional here for the same reason it is not optional
  // for the judge's record: a threads payload truncated at its first page
  // drops findings, and a round missing findings reads as a round that raised
  // fewer -- a wrong account David would have no way to doubt.
  assertMcpSnapshotComplete(snapshot);
  assertThreadProvenance(snapshot.reviewThreads);
  assertCapturedProvenance(snapshot);

  const pr = snapshot.pr;
  const { pass, passes } = passFor(snapshot, round);
  const builderLogin = pr?.user?.login ?? pr?.user ?? null;
  const threads = roundThreads(snapshot, pass, builderLogin);
  const since = commentsSincePass(snapshot, pass, builderLogin);
  const respondedAt = assertCaptureAfterResponse(snapshot, threads, since);

  const head = pr?.head?.sha ?? null;
  if (typeof head !== "string" || !head) throw new Error("the snapshot carries no pull request head sha, so the diff has no endpoint");
  assertCheckoutAtHead(head, { runGit });

  let truncated = null;
  // THREE STATES, because two would lie. A pass whose commit is unknown is not
  // a pass that pushed nothing -- and the skip below reads this, so collapsing
  // "could not tell" into "nothing was pushed" would tell David a round was
  // empty when nothing established that. Same rule as every receipt field in
  // this machinery: observed true, observed false, or could not observe.
  const pushed = !pass.commit ? null : pass.commit !== head;
  const patch = pushed ? artifactDiff(pass.commit, head, { runGit, onTruncate: (cut) => (truncated = cut) }) : null;

  return {
    kind: KIND,
    generatedAt: now(),
    repo: repoSlug(),
    pr: { number: pr.number, title: pr.title, url: pr.html_url ?? null, headSha: head },
    round: {
      number: round,
      of: passes.length,
      submittedAt: pass.at ?? null,
      reviewedCommit: pass.commit ?? null,
      respondedAt,
    },
    findings: threads,
    commentsSincePass: since,
    diff: {
      pushed,
      range: pushed ? `${pass.commit}..${head}` : null,
      // A plain string, NOT `asReadableLines`: that helper exists to keep a
      // JSON record readable, and this patch is rendered into a fenced block
      // in the brief. An array of lines joined into markdown produces
      // comma-separated soup.
      patch: typeof patch === "string" ? patch : null,
      truncated,
      note:
        pushed === false
          ? "Nothing was pushed since the commit this round reviewed -- the builder's response was replies, not code."
          : pushed === null
            ? "This round's reviewed commit was not recorded, so what was pushed since it could not be established. Weigh the absence as uncertainty rather than as nothing."
            : null,
    },
    capturedAt: capturedAtOf(snapshot) ?? null,
  };
}

/**
 * Is there anything to translate?
 *
 * A round that found nothing and prompted no push has no account to give: the
 * finding count is mechanical and the diff is empty, so a dispatch would pay
 * for a paragraph saying "nothing happened". An ALL-DECLINED round is not
 * this -- it has findings, and it is the round where the builder's account
 * matters most.
 */
export const skipReason = (record) =>
  record.findings.length === 0 && record.diff.pushed === false
    ? "no findings and nothing pushed since the reviewed commit"
    : null;

// ---------------------------------------------------------------------------
// The brief
// ---------------------------------------------------------------------------

const block = (label, body) => [`**${label}:**`, "", body ?? "_(no text)_", ""].join("\n");

const WHO = {
  reviewer: "Codex, the code reviewer, wrote",
  builder: "The builder (Claude) replied",
  other: "Someone else on the pull request wrote",
};

/**
 * The record as labelled prose.
 *
 * Markdown rather than JSON because the reader is asked to write prose about
 * it, and because the label above each block is the provenance mechanism --
 * it has to be impossible to miss, which a `"role"` key in a large JSON
 * document is not.
 */
export function translationBrief(record) {
  const out = [
    `# Round ${record.round.number} of ${record.round.of} on pull request #${record.pr.number}`,
    "",
    `**${record.pr.title}**`,
    "",
    `The reviewer returned this round at ${record.round.submittedAt ?? "an unrecorded time"}, against commit ` +
      `${(record.round.reviewedCommit ?? "unknown").slice(0, 7)}. The pull request's head is now ` +
      `${record.pr.headSha.slice(0, 7)}.`,
    "",
    record.findings.length
      ? `It raised ${record.findings.length} finding(s), below, each with everything said on its thread afterwards.`
      : "It raised no findings.",
    "",
  ];

  for (const f of record.findings) {
    out.push(
      `## Finding ${f.n}${f.path ? ` — \`${f.path}\`${f.line ? `:${f.line}` : ""}` : ""}`,
      "",
      f.resolved === true ? "_The builder marked this thread resolved._" : f.resolved === false ? "_This thread is still open._" : "",
      "",
    );
    for (const c of f.comments) {
      out.push(block(`${WHO[c.role]} (${c.author ?? "unknown"}, ${c.at ?? "undated"})`, c.body));
    }
  }

  if (record.commentsSincePass.length) {
    out.push("## Said on the pull request itself since this round returned", "");
    for (const c of record.commentsSincePass) {
      out.push(block(`${WHO[c.role]} (${c.author ?? "unknown"}, ${c.at ?? "undated"})`, c.body));
    }
  }

  out.push("## The code pushed since the commit this round reviewed", "");
  if (record.diff.patch) {
    out.push(
      `Range \`${record.diff.range}\`. This is the evidence for what the builder actually did — check the claims ` +
        `in the replies above against it.`,
      "",
      "```diff",
      record.diff.patch,
      "```",
      "",
    );
    if (record.diff.truncated) {
      out.push(
        `_This diff was cut at ${record.diff.truncated.keptChars} of ${record.diff.truncated.fullChars} characters. ` +
          `Say so if that leaves something you cannot assess._`,
        "",
      );
    }
  } else {
    out.push(record.diff.note ?? "No diff is available for this round.", "");
  }
  return out.join("\n");
}

/**
 * Refuse a snapshot that is not this pull request's.
 *
 * `assertCapturedProvenance` already checks every captured URL against the
 * snapshot's own repo and number; this checks the snapshot against what the
 * caller asked for, which is the other half.
 */
export function assertSnapshotIsForPr(pr, snapshot) {
  if (snapshot?.pr?.number !== pr) {
    throw new Error(`this snapshot is for pull request #${snapshot?.pr?.number}, not #${pr}`);
  }
}
