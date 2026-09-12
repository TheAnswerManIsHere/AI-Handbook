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
 * WHAT IT REFUSES, AND WHY EACH ONE EARNS ITS LINES
 * -------------------------------------------------
 * This record is prose evidence for a human, not a ledger, so it refuses only
 * things that would put a WRONG ACCOUNT in front of David -- one he would read
 * as true and have no way to doubt (David, 2026-09-12):
 *
 *   1. The round is NAMED, not "the latest pass". Codex's next pass can land
 *      before D0 runs, and then "latest" is a different round than the one
 *      just answered -- so the round just closed would silently vanish. Its
 *      findings are attributed by `flattenMcpThreads`, one pass per finding.
 *   2. The capture must postdate the ROUND ITSELF and the builder's last word
 *      on it. Read too early and the findings are absent (a round that reads
 *      as clean) or the replies are (a round that reads as unanswered).
 *   3. Both diff endpoints come from the snapshot and must resolve here, so
 *      "what the builder pushed" is a real patch rather than an empty marker.
 *   4. The snapshot must be this repository's, and carry the PR's author --
 *      without whom every block in the brief is labelled `other` and the
 *      provenance the translator weighs is gone.
 *
 * Nothing here requires every finding to carry a reply, counts anything, or
 * reconciles the output against the input. A translation that misses a
 * finding produces a paragraph missing a finding, which is visible on the
 * page and costs nothing else.
 *
 * THE ROLE HOLDS NO TOOLS, and that is a deliberate retreat. It briefly held
 * `Read`, justified by a one-time check that the checkout sat at the
 * snapshot's head -- which cannot hold, because the tree is live and the next
 * round proceeds while this dispatch runs. The brief carries the round and
 * the diff; a translator that would have needed a file says so instead.
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
  flattenMcpThreads,
  collectionsReadBefore,
  sameCommit,
  assertMcpSnapshotShape,
  assertMcpSnapshotComplete,
  capturedAtOf,
} from "./review-counting.mjs";
import { assertThreadProvenance, assertCapturedProvenance, cappedDiff } from "./review-loop-record.mjs";

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
 * Which reviewer pass each thread's ROOT comment belongs to.
 *
 * DELEGATED TO `flattenMcpThreads`, NOT DERIVED HERE, and that is the whole
 * fix for this function's first version. A captured thread carries no
 * `pull_request_review_id` -- `snapshot-from-captures.mjs`'s `normaliseThread`
 * does not emit one -- so keying on it fell through to a plus-or-minus-six-hour
 * time window, and two ordinary rounds an hour apart each collected BOTH
 * rounds' findings. Measured on a real-shaped snapshot: round 1 reported two
 * findings and so did round 2, with the same two. A clean round would have
 * been translated as finding-bearing and every account would describe the
 * wrong round. (Codex, #81 round 1.)
 *
 * `flattenMcpThreads` already solves this directionally and is hardened: each
 * comment is bound to at most ONE review -- the author's own pass within the
 * authoring window, else their latest pass at or before it. Reusing it means
 * a finding belongs to the same round here as it does in every count this
 * machinery makes.
 */
export function rootPassIds(snapshot) {
  const byRoot = new Map();
  for (const c of flattenMcpThreads(snapshot.reviewThreads ?? [], snapshot.reviews ?? [])) {
    if (c.in_reply_to_id === undefined) byRoot.set(c.id, c.pull_request_review_id ?? null);
  }
  return byRoot;
}

/** The id `flattenMcpThreads` gives a thread's root comment. Same derivation, so the map keys match. */
const rootIdOf = (thread) => {
  const m = /discussion_r(\d+)/.exec(thread.comments?.[0]?.html_url ?? "");
  return m ? Number(m[1]) : `${thread.id}#0`;
};

/**
 * Every comment on the round's own threads, plus the PR-level comments posted
 * after it -- each labelled, none dropped.
 *
 * A thread belongs to the round when its ROOT comment was authored by the
 * reviewer and bound to one of that pass's reviews.
 */
export function roundThreads(snapshot, pass, builderLogin) {
  const out = [];
  const attribution = rootPassIds(snapshot);
  let n = 0;
  for (const thread of snapshot.reviewThreads ?? []) {
    const root = thread.comments?.[0];
    if (!root) continue;
    if (authorRole(root.author ?? root.user?.login, builderLogin) !== "reviewer") continue;
    if (!pass.reviewIds.includes(attribution.get(rootIdOf(thread)))) continue;
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
 * CHECK 3: both diff endpoints resolve here, so the patch is real.
 *
 * THIS REPLACED A CHECK THAT COULD NOT HOLD. The first version compared the
 * checkout's `HEAD` to the snapshot's head, to justify the role holding
 * `Read` over the working tree. It could not: `dispatch()` permits a dirty
 * tree, the dispatch is detached, and the documented workflow lets the next
 * round proceed while it runs -- so a check at spawn says nothing about the
 * files the reviewer opens minutes later, while the brief told it those files
 * were the snapshot's head. Pinning the view properly would need an isolated
 * worktree; **the role gave up `Read` instead** (Codex, #81 round 1). The
 * brief already carries the threads and the diff, and a translator that needs
 * a file it does not have says so in `could_not_assess`.
 *
 * What is left is the check that always mattered: the two commits the diff is
 * cut between must exist in this clone, or the patch comes back as an
 * "[unavailable]" marker and the account of what the builder pushed is empty.
 */
export function assertEndpointsResolve(reviewed, head, { runGit = defaultGit } = {}) {
  for (const [what, sha] of [["the round's reviewed commit", reviewed], ["the pull request head", head]]) {
    if (!sha) continue;
    try {
      runGit(["rev-parse", "--verify", `${sha}^{commit}`]);
    } catch {
      throw new Error(
        `${what} (${String(sha).slice(0, 7)}) is not in this clone, so the diff between them cannot be produced ` +
          `and the account of what the builder pushed would be empty. Fetch the branch and run it again.`,
      );
    }
  }
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

  // A record with no author cannot label anything `builder`, and a brief whose
  // labels all read `other` has lost the one property the translator weighs
  // the builder's claims with. Refusing beats producing it silently.
  const builderLogin = pr?.user?.login ?? (typeof pr?.user === "string" ? pr.user : null);
  if (!builderLogin) {
    throw new Error(
      "the snapshot carries no pull request author (`pr.user.login`), so the builder's own replies cannot be " +
        "told apart from anyone else's. Every block in the brief would be labelled `other`, which is the " +
        "provenance the translator reads. Re-assemble the snapshot.",
    );
  }

  // The capture must postdate the pass being translated, not merely the
  // builder's reply to it. A threads collection read BEFORE the pass holds
  // none of its findings, and a round with no findings and no reply returns
  // early from the response check below -- so it would be translated, or
  // skipped, as clean. `assertCapturedAfterLatestPass` documents this exact
  // mixed-snapshot state for the judge's record; this is the same check bound
  // to the named round. (Codex, #81 round 1.)
  assertCapturedAfterPass(snapshot, pass, round);

  const threads = roundThreads(snapshot, pass, builderLogin);
  const since = commentsSincePass(snapshot, pass, builderLogin);
  const respondedAt = assertCaptureAfterResponse(snapshot, threads, since);

  const head = pr?.head?.sha ?? null;
  if (typeof head !== "string" || !head) throw new Error("the snapshot carries no pull request head sha, so the diff has no endpoint");
  assertEndpointsResolve(pass.commit, head, { runGit });

  let truncated = null;
  // THREE STATES, because two would lie. A pass whose commit is unknown is not
  // a pass that pushed nothing -- and the skip below reads this, so collapsing
  // "could not tell" into "nothing was pushed" would tell David a round was
  // empty when nothing established that. Same rule as every receipt field in
  // this machinery: observed true, observed false, or could not observe.
  //
  // `sameCommit`, NOT `!==`: a pass announced through the connector's summary
  // comment carries the 7-to-40-character sha from its marker while
  // `pr.head.sha` is the full 40, so a strict comparison called a clean pass
  // on the current head "pushed" and bought a dispatch for a round that should
  // have skipped. The same prefix-tolerant comparison `reviewerPasses` uses
  // internally. (Codex, #81 round 1.)
  const pushed = !pass.commit ? null : !sameCommit(pass.commit, head);
  // TWO DOTS, not three. `artifactDiff` expands to `a...b`, which git measures
  // from the two commits' MERGE BASE -- correct for a PR against its base, and
  // wrong here after a permitted `--force-with-lease` rewrite leaves the
  // reviewed commit off the head's ancestry: the patch would then show the
  // whole PR while omitting what disappeared from the reviewed tree. This
  // record wants the reviewed tree against the current one, which is `a..b`.
  // (Codex, #81 round 1.)
  const patch = pushed ? cappedDiff(runGit, `${pass.commit}..${head}`, { onTruncate: (cut) => (truncated = cut) }) : null;

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
 * Refuse a snapshot that is not this repository's pull request.
 *
 * BOTH HALVES, because either alone is satisfiable by the wrong conversation.
 * `assertCapturedProvenance` proves the captured URLs agree with the
 * snapshot's OWN `repo` -- which a foreign snapshot does perfectly well -- and
 * the number alone matches any repository's PR #81. So the repository is
 * compared to the configured identity too, as the budget and adjudication
 * validators already do. (Codex, #81 round 1.)
 */
export function assertSnapshotIsForPr(pr, snapshot, { slug = repoSlug() } = {}) {
  if (snapshot?.pr?.number !== pr) {
    throw new Error(`this snapshot is for pull request #${snapshot?.pr?.number}, not #${pr}`);
  }
  const named = [snapshot?.repo, snapshot?.pr?.head?.repo?.full_name ?? snapshot?.pr?.head?.repo].filter(
    (r) => typeof r === "string" && r,
  );
  for (const repo of named) {
    if (repo.toLowerCase() !== String(slug).toLowerCase()) {
      throw new Error(
        `this snapshot was captured from ${repo}, but this checkout is ${slug}. A translation would stamp this ` +
          `repository's name on another repository's conversation.`,
      );
    }
  }
  if (!named.length) {
    throw new Error("the snapshot names no repository, so nothing ties this conversation to this checkout");
  }
}

/**
 * The capture-order check, bound to the round being translated.
 *
 * `assertCapturedAfterLatestPass` asks this of the LATEST pass, which is the
 * right question for a record about the head. Here the question is about one
 * named round, and a threads collection read before it holds none of its
 * findings.
 */
export function assertCapturedAfterPass(snapshot, pass, round) {
  const at = Date.parse(pass?.at ?? "");
  if (!Number.isFinite(at)) {
    throw new Error(
      `round ${round}'s reviewer pass carries an unparseable timestamp (${JSON.stringify(pass?.at ?? null)}), so ` +
        `nothing establishes that this snapshot was read after it. Re-capture.`,
    );
  }
  const stale = collectionsReadBefore(snapshot.capturedAt, at, ["reviewThreads", "issueComments"]);
  if (stale.length) {
    throw new Error(
      `${stale.join(" and ")} ${stale.length > 1 ? "were" : "was"} captured before round ${round}'s pass at ` +
        `${new Date(at).toISOString()}, so that round's findings are absent from this snapshot and it would be ` +
        `translated -- or skipped -- as clean. Re-read the collections.`,
    );
  }
}
