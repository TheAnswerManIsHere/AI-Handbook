#!/usr/bin/env node
// SYNCED FROM AI-Handbook — do not edit in a consumer repo. Local edits are overwritten by the next sync and their reasoning is lost; change the handbook instead.
/**
 * David's reading surface for D0: a message in chat. That is the whole surface.
 *
 * THERE IS NO PAGE, AND REMOVING IT WAS THE POINT (David, 2026-09-16, on #109
 * round 3). This module used to render an HTML page, write it to a gitignored
 * path, and hand back a relative filename -- so the "delivery" was a file
 * nobody could open, and the contract's "page link posted on the PR" described
 * a link that never existed. Three of that round's four findings were the
 * inside of that hole: no receipt producer, no deploy step, no synchronisation.
 * David's ruling, verbatim in substance: he lives in the chat, a page is
 * something he would have to go and copy-paste into a browser, and building a
 * delivery system for what is fundamentally one agent telling him the answer
 * would be undoing the #89 cut by hand. So: `chatReport` and nothing else.
 *
 * WHAT SURVIVES IS THE ONE PROPERTY WORTH MACHINERY. The builder does not
 * write the translation, does not summarise it, and does not decide what the
 * chat message says. `chatReport` composes it from the validated answer's own
 * fields, verbatim, and I paste that. A builder-written summary of an
 * independent account is just the builder's account again, which is the thing
 * D0 exists to stop being the only one. That is why the report is a function
 * rather than an instruction to me to "explain the round".
 *
 * NO STATE SURVIVES A SESSION, AND NOTHING HERE NEEDS IT TO. The receipt store
 * went with the page, and round 4 found it had been silently carrying the
 * round's coordinates: with it gone, a resumed session had no lower bound for
 * the review window and no previous head, and `roundBrief`'s "from the start"
 * arm re-attributed every earlier round to the current one. The answer is not
 * a smaller store. Every coordinate a round needs is DERIVABLE from the pull
 * request itself: the reviewer marks each round it returns -- a formal review
 * submission when it has findings, a `**Reviewed commit:**` issue comment when
 * it has none (measured on #115, 2026-09-16) -- and those markers carry both
 * the timestamp and the reviewed commit. So the translator locates the round's
 * marker and the previous round's, and both the activity window and the
 * commit ranges follow. The caller pins two things only: the HEAD where the
 * evidence stops, and the UNTIL moment the dispatch was made. (Codex, #109
 * round 4; Astra and Fable passes, 2026-09-16.)
 *
 * THREE FACTS, NOT A LEDGER. The verdict line reads exactly three things off
 * the answer: were there disagreements, how many, and was anything left
 * unassessed -- and a fourth that gates the favourable line: did the translator
 * see a builder reply at all. There is no per-finding reconciliation and
 * nothing refuses a translation that skipped a finding -- the reader is a human
 * reading prose, and a paragraph missing a finding is a paragraph missing a
 * finding (David, 2026-09-12).
 *
 * The one rule the verdict obeys: **"agrees" is never printed over an
 * unassessed item, or over a round the builder has not answered.**
 * Could-not-observe is not the favourable answer, and neither is
 * nobody-said-anything-yet. And every place the report asserts a fact about the
 * round -- the verdict line, a section heading, an empty-list label -- reads
 * the SAME fact, because this component has paid four times for two claim
 * sites disagreeing (#81 round 8; #109 rounds 2, 3 and 4).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { modelTier, validate, assertSchemaSupported, repoSlug } from "./machinery.mjs";

export const REVIEWS_DIR = ".agents/reviews";

/** Where the translator writes its answer. Derived, never supplied. */
export const answerPath = (root, pr, round) =>
  path.join(root, REVIEWS_DIR, `pr-${pr}`, `round-${round}.answer.json`);

/**
 * The role's agent type, and the schema its answer must satisfy.
 *
 * RESOLVED FROM THIS MODULE, NOT FROM A CALLER'S ROOT. The answer file lives in
 * the repository being reviewed; the schema is payload and lives beside this
 * script. Those are different roots, and conflating them broke the moment a
 * test passed a temporary directory -- it would have broken identically in a
 * consumer, where this file sits at `scripts/` rather than `core/scripts/`.
 */
export const ROLE = "fable-round-translation";
const SCRIPT_DIR = path.dirname(fileURLToPath(import.meta.url));
export const schemaPath = () =>
  path.resolve(SCRIPT_DIR, "..", ".agents", "fable-roles", "schemas", `${ROLE}.schema.json`);

const loadSchema = () => JSON.parse(fs.readFileSync(schemaPath(), "utf8"));

/**
 * Keep the answer directory ignored, because an answer file must never be
 * committed -- it is a session artifact, and the role that writes it reads
 * every comment on the pull request.
 */
export function ensureReviewsIgnored(root) {
  const dir = path.join(root, REVIEWS_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const ignore = path.join(dir, ".gitignore");
  if (!fs.existsSync(ignore)) fs.writeFileSync(ignore, "*\n");
  return ignore;
}

/**
 * Prepare the answer path for ONE attempt, and call it before EVERY dispatch.
 *
 * Three things, each of which was a way for the wrong bytes to be read: the
 * directory exists (the role holds `Write` and nothing that creates a parent),
 * it is ignored (see above), and no earlier attempt's answer is left where
 * `readAnswer` will look. That last one is the finding: `answerPath` is the
 * same for every attempt of a round, and waiting for completion fixes an EARLY
 * read but not a STALE one -- a re-dispatch whose translator wrote nothing
 * would otherwise be reported with its predecessor's answer, an unanswered or
 * partial account presented as the new result. Clearing the one derived file
 * is the whole lifecycle; there is no attempt ledger. (Astra, 2026-09-16.)
 */
export function prepareAnswerPath(root, pr, round) {
  ensureReviewsIgnored(root);
  const file = answerPath(root, pr, round);
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.rmSync(file, { force: true });
  return file;
}

/**
 * The dispatch model, as a full id and as the name the Agent tool takes.
 *
 * BIND IT ONCE PER DISPATCH. `agentModel` is what the Agent call takes and `id`
 * is what `chatReport` compares the translator's reported model against.
 * Naming them from two separate calls is how the skill lost the binding:
 * omit `askedModel` and the fallback notice can never fire; pass the Agent
 * argument (`fable`) and every normal round reports a fallback that did not
 * happen. (Codex, #109 round 4.)
 *
 * `effort` is returned and deliberately NOT applied: the Agent tool takes a
 * model name and no reasoning-effort argument, so the configured value has no
 * route to this dispatch. Returning it lets a caller say so out loud rather
 * than leaving a dial in the config that turns nothing.
 */
export function dispatchModel(io = undefined) {
  const entry = modelTier("strongestClaude", io);
  const id = typeof entry === "string" ? entry : entry?.id;
  const effort = typeof entry === "object" ? (entry?.effort ?? null) : null;
  const m = typeof id === "string" ? /^claude-(fable|opus|sonnet|haiku)\b/.exec(id) : null;
  if (!m) {
    throw new Error(
      `.agents/machinery.json's models.strongestClaude.id is ${JSON.stringify(id)}, which is not a Claude model, ` +
        `so it cannot be dispatched as a subagent. The Agent tool takes one of fable, opus, sonnet, haiku.`,
    );
  }
  return { id, agentModel: m[1], effort, effortApplied: false };
}

/**
 * The round's coordinates. NOT the brief -- the harness supplies that.
 *
 * TWO THINGS ARE PINNED AND EVERYTHING ELSE IS DERIVED. `head` is where the
 * evidence stops -- the branch head at dispatch, which is NOT necessarily the
 * commit the reviewer reviewed: the replies to a round claim fixes pushed
 * after the reviewed commit, and a translator pinned to the reviewed commit
 * could never check them (Astra, 2026-09-16). `until` is the moment of the
 * dispatch, the upper bound on review activity. The reviewed commits, the
 * activity window's lower bound and the previous round's boundary all come
 * from the reviewer's own markers on the pull request, which the role is told
 * how to find -- so a resumed session, or a round after a failed one, has
 * nothing to remember and nothing to guess.
 *
 * `repo` and the answer path are DERIVED rather than accepted: a mistyped
 * owner/name would send the translator to a different pull request, and a
 * mistyped answer path would mean a valid answer written where `readAnswer`
 * never looks -- reported as a failed round, the failure state hiding a
 * success. That is the `derivable` arm of the Worth test, which says remove
 * the input.
 *
 * THE SCHEMA TRAVELS WITH THE BRIEF. Neither the role definition nor these
 * coordinates used to name the nested field names the answer must carry
 * (`why_it_matters`, `does_not_do`, `now_trusting`), and the role holds no
 * tool that can open the schema file. A validator the writer cannot see is a
 * validator that rejects honest answers. (Astra, 2026-09-16.)
 */
export function roundBrief({
  root,
  pr,
  round,
  head,
  until = null,
  finalRound = false,
  priorAccounts = [],
  io = undefined,
}) {
  const repo = repoSlug(io);
  const answerFile = answerPath(root, pr, round);
  const lines = [
    "## This round",
    "",
    `- **Repository:** \`${repo}\``,
    `- **Pull request:** #${pr}`,
    // THE ROUND IS LOCATED, NOT REMEMBERED. The reviewer marks every round it
    // returns, in one of two shapes, and the Nth marker in time order IS round
    // N. That is what makes the window and the commit ranges derivable in a
    // session that has never seen this pull request before. (Codex, #109
    // round 4 -- the receipt store had been carrying this silently.)
    `- **Round:** ${round} — the ${ordinal(round)} review the reviewer has returned on this pull request, counting in time order across BOTH shapes a returned review takes: a formal review submission (a round with findings) and an issue comment carrying the literal line \`**Reviewed commit:**\` (a round with none). Locate this round's marker and, when ${round} > 1, the previous round's. If the ${ordinal(round)} marker cannot be found, or the markers you can see do not number ${round} or more, say so in \`could_not_assess\` and do not guess a window.`,
    // EVIDENCE STOPS AT THE HEAD; THE REVIEWED COMMIT IS IN THE MARKER. Pinning
    // the head to the reviewed commit meant the translator could never verify
    // a reply's "fixed in <later sha>". (Astra, 2026-09-16.)
    `- **Head:** \`${head}\` — where the evidence stops. Every commit on the pull request up to and including this one is in reach; nothing after it is. This is NOT necessarily the commit the reviewer reviewed — that commit is named in the round's own marker.`,
    // TIMESTAMPS BOUND REVIEW ACTIVITY ONLY. The lower bound is the round's
    // own marker, INCLUSIVE, because every finding in a round carries exactly
    // its submission's timestamp -- an exclusive lower bound drops the whole
    // round, and an inclusive upper bound at the next marker absorbs the
    // whole next round (Astra replayed #109: 23 findings for round 1, not 14).
    // `until` is the dispatch moment: this dispatch runs detached and the
    // next round can land while it reads.
    until
      ? `- **Review activity, until:** \`${until}\` — the moment this dispatch was made. IGNORE every comment, review and reply after this timestamp; they belong to a later round, and this dispatch runs detached, so later activity may well have landed while you were reading.`
      : `- **Review activity, until:** none supplied — if you find activity that plainly belongs to a later round, say so in \`could_not_assess\` rather than folding it into this one.`,
    `- **Final round:** ${finalRound ? "YES — also return `known_gaps` and `what_landed`." : "no — omit `known_gaps` and `what_landed`."}`,
    `- **Write your answer to:** \`${answerFile}\``,
  ];
  // QUOTED INLINE, NOT NAMED AS FILES. These used to be passed as local paths
  // to a role holding no `Read` tool -- the final round was told to use files
  // it could not open. A narrow read grant is not available either: a path
  // specifier in an agent's `tools:` list is not honoured. Quoting costs
  // nothing, because this is the role's OWN earlier prose handed back to it,
  // and it is told in the same breath to treat it as navigation.
  //
  // THE ENTRIES ARE `readAnswer` RESULTS, WHOLE. A bare parsed answer carries
  // no round number (the schema forbids extra keys), and passing one rendered
  // "### Round undefined" (Astra, 2026-09-16). And every round 1..N-1 is
  // NAMED, present or not: a resumed session holds no earlier answer files at
  // all, and the role is required to state a missing account as a limitation
  // -- which it can only do if it is told the account is missing (Fable,
  // 2026-09-16). Silence here would read as "there were no earlier rounds".
  if (finalRound) {
    lines.push("", "## Earlier accounts of this pull request, for navigation only", "");
    lines.push(
      "These are your own earlier rounds, quoted, one entry per round. They tell you where to look. Check the current threads and the code before repeating any of it — an earlier account can be wrong, and repeating it would launder the error into the round David reads most carefully. Each entry says whether the builder had replied when it was written (an account of an unanswered round is not settled), what it could not assess (restate that limitation), and where it disagreed with the builder (look there first). A round with no account here is a limitation you state in `could_not_assess`, and its threads are still yours to read for `known_gaps`.",
      "",
    );
    const byRound = new Map();
    for (const a of priorAccounts) if (a && Number.isInteger(a.round)) byRound.set(a.round, a);
    for (let k = 1; k < round; k += 1) {
      const a = byRound.get(k);
      lines.push(`### Round ${k}`, "");
      if (!a) {
        lines.push("No account of this round exists in this session — it was never translated, or the session that translated it is gone. State this as a limitation.", "");
        continue;
      }
      if (a.failed) {
        lines.push(`The translation of this round FAILED — ${a.reason}. There is no account to navigate by; state this as a limitation.`, "");
        continue;
      }
      const ans = a.answer ?? {};
      lines.push(
        `- **Builder had replied when this was written:** ${ans.builder_answered === true ? "yes" : "no — treat its conclusions as provisional"}`,
        `- **Could not assess:** ${typeof ans.could_not_assess === "string" ? ans.could_not_assess : "nothing reported"}`,
      );
      if (Array.isArray(ans.disagreements) && ans.disagreements.length) {
        lines.push(`- **Disagreed with the builder on ${ans.disagreements.length}:**`);
        for (const d of ans.disagreements) lines.push(`  - ${d.what} — ${d.why_it_matters}`);
      } else {
        lines.push("- **Disagreements reported:** none");
      }
      lines.push("", ans.summary_for_david ?? "", "", ans.what_happened ?? "", "");
    }
  }
  lines.push(
    "",
    "## The shape of your answer",
    "",
    "The file must be one JSON object satisfying this schema exactly — these field names, no others, nested as shown. It is quoted here because you hold no tool that can open the schema file.",
    "",
    "```json",
    JSON.stringify(loadSchema(), null, 2),
    "```",
    "",
    "Write the JSON object to that path and nothing else to it.",
    "",
  );
  return lines.join("\n");
}

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};

/**
 * Validate an answer against the shipped schema.
 *
 * CONTEXTUAL IN BOTH DIRECTIONS: the final round must carry `known_gaps` and
 * `what_landed`, and an ordinary round must not. An optional field nothing
 * enforces is the defect this machinery keeps paying for.
 *
 * A BLANK `could_not_assess` IS REFUSED, NOT READ AS "NOTHING TO REPORT". The
 * schema's `minLength` refuses "" but admits "   ", and `facts` used to trim
 * that into the fully-assessed state -- two checks disagreeing about what
 * empty means, with the favourable state as the result, one character away
 * from the case round 2 fixed. Only `null` means fully assessed. (Astra,
 * 2026-09-16.)
 *
 * Returns the problems rather than throwing. D0 is off the critical path and a
 * broken translation must never be able to stop a review loop.
 */
export function validateAnswer(answer, { finalRound = false } = {}) {
  const schema = loadSchema();
  assertSchemaSupported(schema, ROLE);
  const problems = validate(answer, schema, ROLE);
  const has = (k) => answer && typeof answer === "object" && Object.prototype.hasOwnProperty.call(answer, k);
  if (has("could_not_assess") && typeof answer.could_not_assess === "string" && answer.could_not_assess.trim() === "") {
    problems.push(`${ROLE}: "could_not_assess" is blank -- null means fully assessed and a sentence means not; whitespace is neither`);
  }
  for (const k of ["known_gaps", "what_landed"]) {
    if (finalRound && !has(k)) problems.push(`${ROLE}: the final round must return "${k}"`);
    if (!finalRound && has(k)) problems.push(`${ROLE}: "${k}" belongs to the final round only`);
  }
  return problems;
}

/**
 * Read what the translator wrote, in the shape `chatReport` consumes.
 *
 * THIS RETURNS THE ROUND, NOT A STATUS. It used to return `{ ok, answer }` or
 * `{ ok, why }` while `chatReport` read `{ round, answer }` or
 * `{ round, failed, reason }`, and nothing adapted one to the other -- so the
 * documented flow printed "round undefined" on every report and rendered a
 * FAILED read as "no builder account yet", a failure wearing a benign state's
 * clothes. Now step 3's output IS step 4's input, and the same object is what
 * a final round's `priorAccounts` takes. (Codex, #109 round 4, P1.)
 *
 * Three failures, one shape: no file, unparseable file, schema-invalid answer.
 * Each is a FAILED round -- visibly a failure, never the favourable "nothing to
 * report" case. One schema failure is named specially: an answer whose only
 * problems are the final-round sections was written for the other kind of
 * round, which means the `finalRound` flag differed between the dispatch and
 * this read. That is a caller's slip rendering a VALID answer as a failed
 * round, so the reason says exactly that rather than "did not match the
 * expected shape". (Fable, 2026-09-16.)
 */
export function readAnswer(root, pr, round, { finalRound = false } = {}) {
  const file = answerPath(root, pr, round);
  const failed = (reason) => ({ pr, round, failed: true, reason });
  let raw;
  try {
    raw = fs.readFileSync(file, "utf8");
  } catch (err) {
    return failed(`the translator wrote no answer file (${err.code === "ENOENT" ? "not found" : err.code})`);
  }
  let answer;
  try {
    answer = JSON.parse(raw);
  } catch (err) {
    return failed(`the answer file is not valid JSON: ${err.message}`);
  }
  const problems = validateAnswer(answer, { finalRound });
  if (problems.length) {
    const onlyFinalRoundSections = problems.every((p) => /the final round must return|belongs to the final round only/.test(p));
    if (onlyFinalRoundSections) {
      return failed(
        `the answer was written for ${finalRound ? "an ordinary" : "the final"} round but read as ${finalRound ? "the final" : "an ordinary"} one -- ` +
          `the finalRound flag differs between the dispatch and this read, and the answer itself is otherwise valid: ${problems.join("; ")}`,
      );
    }
    return failed(`the answer did not match the expected shape: ${problems.join("; ")}`);
  }
  return { pr, round, answer };
}

/**
 * The facts, off one round.
 *
 * A failed round is checked FIRST and is its own state. A round whose answer
 * never arrived or did not parse is not a quiet round: reporting it as one
 * would turn a failure into a clean bill of health, which is the exact thing
 * the "agrees" rule exists to prevent.
 */
export function facts(round) {
  if (round.failed) {
    return { failed: true, skipped: false, reason: round.reason ?? "the translation could not be produced" };
  }
  if (round.skipped) return { skipped: true, failed: false, reason: round.reason ?? "not dispatched" };
  const out = round.answer ?? {};
  return {
    skipped: false,
    failed: false,
    disagreements: Array.isArray(out.disagreements) ? out.disagreements.length : 0,
    // ANY STRING IS UNASSESSED. `validateAnswer` refuses a blank one, and this
    // side does not trim, so the two checks cannot disagree about what a
    // string means: only `null` is fully assessed.
    unassessed: typeof out.could_not_assess === "string",
    // WHETHER THERE IS A BUILDER ACCOUNT AT ALL, read from the translator's own
    // observation. It permits a round nobody has replied to -- translating one
    // is legitimate and reads as a round awaiting a response. What is not
    // legitimate is printing "agrees with the builder's account" over it, which
    // is what the fall-through did: a clean translation of an unanswered round
    // has no disagreements and nothing unassessed, so it landed on the
    // favourable line while there was no account to agree with. Round 5 of
    // AI-Handbook #81 was exactly that round.
    //
    // `=== true`, so an absent or malformed value reads as UNANSWERED. Of the
    // two possible wrong accounts, the false favourable is the one that must
    // never print.
    answered: out.builder_answered === true,
  };
}

const plural = (n, noun) => `${n} ${noun}${n === 1 ? "" : "s"}`;

/**
 * The verdict, in one line. The headline of the chat report.
 *
 * UNANSWERED IS TESTED BEFORE THE DISAGREEMENT COUNT. The role may raise a
 * concern of its own -- "a risk nobody named" -- on a round the builder has
 * not replied to, and the old order printed "differs on 1 point" over
 * `builder_answered: false`: a disagreement attributed to someone who had not
 * spoken. The concern is still counted; it is called what it is. (Codex,
 * #109 round 4.)
 */
export function chatLine(round) {
  const f = facts(round);
  const r = `round ${round.round}`;
  if (f.failed) return `${r}: translation failed — ${f.reason}`;
  if (f.skipped) return `${r}: skipped — ${f.reason}`;
  if (!f.answered) {
    if (f.disagreements > 0) {
      return `${r}: no builder account yet — the translator raises ${plural(f.disagreements, "concern")} of its own${f.unassessed ? ", and something could not be assessed" : ""}`;
    }
    if (f.unassessed) return `${r}: no builder account yet — partial, something could not be assessed`;
    return `${r}: no builder account yet — the round was unanswered when this was read`;
  }
  if (f.disagreements > 0) return `${r}: differs on ${plural(f.disagreements, "point")}`;
  if (f.unassessed) return `${r}: partial — something could not be assessed`;
  // LAST, AND ONLY HERE, because "agrees" is the only shape that asserts a
  // builder account exists and that everything reachable was assessed.
  return `${r}: agrees with the builder's account`;
}

/**
 * The heading and the empty-case label for the disagreements section, off the
 * same facts the verdict line read -- so the two cannot name different facts.
 *
 * AN EMPTY LIST IS A REAL ANSWER AND IS RENDERED. The schema says so of both
 * `disagreements` and `known_gaps`, and a length check rendered nothing for
 * either, so David could not tell "nothing was found" from "this was never
 * addressed" -- and with builder prose forbidden around the report, no side
 * channel exists to say it informally. The labels are deterministic and
 * evaluate nothing ("No disagreements reported", not "all good"): they state
 * the field's value, which is the one kind of non-translator text the report
 * may carry. They are QUALIFIED when the assessment was partial or the round
 * unanswered, because "none reported" over an unassessed round would be the
 * "agrees" defect in a smaller font. (Codex, #109 round 4; Astra, 2026-09-16.)
 */
function disagreementsWording(f) {
  if (!f.answered) {
    return {
      heading: `**Concerns the translator raises on its own — the builder has not replied** (${f.disagreements})`,
      empty: `*No concerns of its own reported; there is no builder account yet to disagree with${f.unassessed ? ", and something could not be assessed" : ""}.*`,
    };
  }
  return {
    heading: `**Where it disagrees with the builder** (${f.disagreements})`,
    empty: f.unassessed
      ? "*No disagreements reported on what could be assessed.*"
      : "*No disagreements reported with the builder's account.*",
  };
}

/**
 * THE DELIVERABLE. What I paste into chat, and the only thing I say about the
 * round.
 *
 * Composed from the answer's own fields, in the answer's own words. I do not
 * summarise it, reorder its argument, or drop a section I disagree with --
 * which is the whole reason this is a function and not a note telling me to
 * explain the round. The only text here that is not the translator's is the
 * labels.
 *
 * `model` prints only when it is worth a reader's attention: a mismatch
 * against the model asked for, or an answer that could not name its own model.
 * A line on every round saying the model was the right one trains a reader to
 * skip the place the real notice would appear.
 */
export function chatReport(round, { askedModel = null } = {}) {
  const f = facts(round);
  const out = [`**D0 — ${chatLine(round)}**`, ""];

  if (f.failed || f.skipped) {
    out.push(
      f.failed
        ? `No independent account of this round exists. The translator was dispatched and produced nothing usable — ${f.reason}. This is a failure of the translation, not a report that the round was quiet: there may well have been findings, and nobody has explained them here.`
        : `No independent account of this round exists. The translator was not dispatched for this round — ${f.reason}. Nobody has explained the round here.`,
    );
    return out.join("\n");
  }

  const a = round.answer ?? {};
  out.push(a.summary_for_david ?? "", "", "**What happened**", "", a.what_happened ?? "");

  if (Array.isArray(a.disagreements)) {
    const w = disagreementsWording(f);
    if (a.disagreements.length) {
      out.push("", w.heading, "");
      for (const d of a.disagreements) out.push(`- **${d.what}** — ${d.why_it_matters}`);
    } else {
      out.push("", w.empty);
    }
  }

  if (Array.isArray(a.known_gaps)) {
    out.push("", "**Shipping unfixed**", "");
    if (a.known_gaps.length) {
      for (const g of a.known_gaps) {
        out.push(`- ${g.reasonable ? "Reasonable" : "**Not reasonable**"}: ${g.what} — ${g.why}`);
      }
    } else {
      out.push(f.unassessed ? "*No known gaps reported on what could be assessed.*" : "*No known gaps reported.*");
    }
  }

  if (a.what_landed) {
    out.push(
      "",
      "**What actually landed**",
      "",
      a.what_landed.landed,
      "",
      `*Does not do:* ${a.what_landed.does_not_do}`,
      "",
      `*You are now trusting:* ${a.what_landed.now_trusting}`,
    );
  }

  if (a.took_on_trust) out.push("", `*Taken on trust, not checked:* ${a.took_on_trust}`);
  if (f.unassessed) out.push("", `*Could not assess:* ${a.could_not_assess}`);

  const got = a.model ?? null;
  if (!got) out.push("", `*This round did not report which model wrote it${askedModel ? `; ${askedModel} was asked for` : ""}.*`);
  else if (askedModel && got.trim() !== askedModel.trim()) {
    out.push("", `*Written by ${got}, not the ${askedModel} that was asked for — the dispatch cannot enforce the model, only report what answered.*`);
  }

  out.push("", `**${a.recommendation}**`);
  return out.join("\n");
}
