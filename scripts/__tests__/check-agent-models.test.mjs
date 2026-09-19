/**
 * Does the model-pin check actually refuse the thing it was written for?
 *
 * THE DEFECT IT GUARDS (#126): two roles named for the model they run as
 * declared no model at all, so a forgotten per-invocation argument made them
 * run as whatever session dispatched them -- an Opus "Fable assessor" holding
 * the tie-break in the shared judgement, reported as Fable. The check has to
 * refuse an ABSENT declaration exactly as loudly as a wrong one, because
 * absent is the shape that inherits silently.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { findings, fix, main, splitFrontmatter, agentDefinitions, SEED_FILE, REPO_ROOT } from "../check-agent-models.mjs";

const PIN = { strongestClaude: { id: "claude-fable-5-1", effort: "xhigh" }, strongestCodex: { id: "gpt-6-astra", effort: "xhigh" } };

let roots = 0;
const io = (root, models = PIN) => ({ root: `${root}#${(roots += 1)}`, read: () => JSON.stringify({ repo: "Owner/Name", models }) });

const SEED = {
  _README: "Seeded once by the AI-Handbook sync, then owned by this repository.",
  repo: "OWNER/REPO",
  models: { strongestClaude: { id: "claude-fable-5-1", effort: "xhigh" }, strongestCodex: { id: "gpt-6-astra", effort: "xhigh" } },
  _models: "Explanatory prose that must survive a rewrite.",
};

const fixtureRoot = (files, seed = SEED) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-models-"));
  const dir = path.join(root, "core", ".claude", "agents");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  if (seed !== null) {
    fs.mkdirSync(path.join(root, "core", ".agents"), { recursive: true });
    fs.writeFileSync(path.join(root, SEED_FILE), `${JSON.stringify(seed, null, 2)}\n`);
  }
  return root;
};

const seedOf = (root) => JSON.parse(fs.readFileSync(path.join(root, SEED_FILE), "utf8"));

const def = (name, extra = "", body = "\n<!-- a comment -->\n\n# Heading\n\nProse.\n") =>
  ["---", `name: ${name}`, 'description: "A role."', "tools: Read", ...(extra ? [extra] : []), "---", body].join("\n");

test("an absent model declaration is a finding, and it says what the absence costs", () => {
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "effort: xhigh") });
  const out = findings(root, io(root));
  assert.equal(out.length, 1);
  assert.match(out[0], /frontmatter `model:` is absent/);
  assert.match(out[0], /claude-fable-5-1/);
  // The consequence, not just the mismatch: a reader who does not already know
  // why this matters is the reader this check exists for.
  assert.match(out[0], /runs as whatever the dispatching\s+session is/);
});

test("an absent effort declaration names ITS consequence, which is not the model's", () => {
  // They are genuinely different: a missing model is overridden by the
  // dispatch argument and bites only when that is forgotten, while a missing
  // effort bites every time -- the Agent tool has no effort argument at all,
  // so frontmatter is the only route there is.
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1") });
  const out = findings(root, io(root));
  assert.equal(out.length, 1);
  assert.match(out[0], /ONLY route for effort/);
  assert.doesNotMatch(out[0], /per-invocation argument is omitted/);
});

test("a declaration that disagrees with the pin is a finding", () => {
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-opus-5\neffort: low") });
  const out = findings(root, io(root));
  assert.equal(out.length, 2);
  assert.match(out.join("\n"), /is "claude-opus-5", but .agents\/machinery.json pins/);
  assert.match(out.join("\n"), /is "low", but/);
});

test("a role that is not named for a model is left alone", () => {
  // adversarial-modeler and semgrep-scanner are workers, not judgements: they
  // are deliberately unpinned, and a check that demanded a tier from them
  // would be refusing correct files.
  const root = fixtureRoot({ "semgrep-scanner.md": def("semgrep-scanner"), "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") });
  assert.deepEqual(findings(root, io(root)), []);
});

test("a definition whose frontmatter cannot be read is refused, never passed", () => {
  // The worst available failure is a control reporting success having
  // evaluated nothing (#11, #16, #59). A file this cannot parse is a file
  // whose model it cannot check, so it says so instead of returning clean.
  for (const bad of ["no frontmatter at all\n", "---\nname: fable-x\nnever closed\n"]) {
    const root = fixtureRoot({ "fable-x.md": bad });
    assert.match(findings(root, io(root)).join("\n"), /no readable frontmatter block/);
  }
});

test("--fix rewrites the declarations from the pin and changes nothing else", () => {
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-opus-5") });
  const before = fs.readFileSync(path.join(root, "core", ".claude", "agents", "fable-x.md"), "utf8");
  const changed = fix(root, io(root));

  assert.deepEqual(changed, ["core/.claude/agents/fable-x.md"]);
  assert.deepEqual(findings(root, io(root)), []);

  const after = fs.readFileSync(path.join(root, "core", ".claude", "agents", "fable-x.md"), "utf8");
  const parts = splitFrontmatter(after);
  assert.equal(parts.body.join("\n"), splitFrontmatter(before).body.join("\n"), "the body was touched");
  // An existing key is replaced where it sits; a missing one is appended. The
  // file keeps its own key order either way.
  assert.deepEqual(parts.head, ["name: fable-x", 'description: "A role."', "tools: Read", "model: claude-fable-5-1", "effort: xhigh"]);
});

test("--fix is a no-op on a tree that already agrees", () => {
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") });
  const file = path.join(root, "core", ".claude", "agents", "fable-x.md");
  const before = fs.readFileSync(file, "utf8");
  assert.deepEqual(fix(root, io(root)), []);
  assert.equal(fs.readFileSync(file, "utf8"), before);
});

test("main exits 1 on drift, 0 once fixed, and 2 on a pin it cannot resolve", () => {
  const root = fixtureRoot({ "fable-x.md": def("fable-x") });
  let logged = "";
  const log = (m) => (logged += `${m}\n`);

  assert.equal(main([], { root, io: io(root), log }), 1);
  // "declarations", not "role declarations": the seed is checked too and is not a role.
  assert.match(logged, /2 declarations disagree with the pin/);
  assert.match(logged, /--fix/, "the message did not name the way out");

  assert.equal(main(["--fix"], { root, io: io(root), log }), 0);
  assert.equal(main([], { root, io: io(root), log }), 0);

  // A pin that cannot be resolved is exit 2 -- a broken configuration, not a
  // drifted declaration, and collapsing the two would report a missing models
  // block as a role's fault.
  assert.equal(main([], { root, io: io(root, { strongestCodex: PIN.strongestCodex }), log: () => {} }), 2);
  assert.equal(main(["--nope"], { root, io: io(root), log: () => {} }), 2);
});

test("this repository's own role definitions agree with its pin", () => {
  // The same assertion CI makes by running the script. It is here too because
  // the drift it catches is a one-line edit in a file nobody re-reads, and the
  // unit suite is what runs on every change to either side of the pair.
  assert.deepEqual(findings(REPO_ROOT), []);
  assert.ok(
    agentDefinitions(REPO_ROOT).some((d) => d.name === "fable-review-assessor"),
    "the assessor definition is not where this check looks",
  );
});

// ---------------------------------------------------------------------------
// The other derived copy: the seed a fresh consumer is created from (#131 r1)
// ---------------------------------------------------------------------------

test("a seed that disagrees with the pin is a finding, naming what it costs a fresh consumer", () => {
  // The defect the mismatch warning cannot catch: a repository enrolled after
  // a bump gets the old value in its own pin, its dispatch argument outranks
  // the freshly synced frontmatter, and the header and the role's own line
  // then AGREE -- on the wrong model. Nothing fires.
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") }, {
    ...SEED,
    models: { strongestClaude: { id: "claude-fable-5-0", effort: "high" }, strongestCodex: SEED.models.strongestCodex },
  });
  const out = findings(root, io(root));
  assert.equal(out.length, 2, out.join("\n"));
  assert.match(out.join("\n"), /machinery\.template\.json: models\.strongestClaude\.id is "claude-fable-5-0"/);
  assert.match(out.join("\n"), /models\.strongestClaude\.effort is "high"/);
  assert.match(out.join("\n"), /seeds a fresh consumer's own pin/);
});

test("both tiers are held, not just the Claude one", () => {
  // The definitions only carry strongestClaude, so the definition loop checks
  // only that. The seed carries both and the drift mechanism is identical, so
  // checking one would leave half the seed silently stale.
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") }, {
    ...SEED,
    models: { strongestClaude: SEED.models.strongestClaude, strongestCodex: { id: "gpt-5.5", effort: "xhigh" } },
  });
  assert.match(findings(root, io(root)).join("\n"), /models\.strongestCodex\.id is "gpt-5\.5"/);
});

test("--fix rewrites the seed's pinned values and leaves every other key untouched", () => {
  const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") }, {
    ...SEED,
    models: { strongestClaude: { id: "claude-fable-5-0", effort: "high" }, strongestCodex: SEED.models.strongestCodex },
  });
  const changed = fix(root, io(root));

  assert.ok(changed.includes(SEED_FILE.split(path.sep).join("/")), `seed not rewritten: ${changed.join(", ")}`);
  assert.deepEqual(findings(root, io(root)), []);

  const after = seedOf(root);
  assert.deepEqual(after.models.strongestClaude, { id: "claude-fable-5-1", effort: "xhigh" });
  // The placeholder that is refused by name if left, and the prose a consumer
  // reads, both survive. A rewrite that ate either would be worse than the
  // drift it fixed.
  assert.equal(after.repo, "OWNER/REPO");
  assert.equal(after._README, SEED._README);
  assert.equal(after._models, SEED._models);
  assert.deepEqual(Object.keys(after), Object.keys(SEED), "key order or membership changed");
});

test("a seed that cannot be read is a finding, never a silent pass", () => {
  const missing = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") }, null);
  assert.match(findings(missing, io(missing)).join("\n"), /missing, so a fresh consumer has nothing to be seeded from/);

  const broken = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") });
  fs.writeFileSync(path.join(broken, SEED_FILE), "{ not json");
  assert.match(findings(broken, io(broken)).join("\n"), /could not be read as JSON/);

  const noModels = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") }, { repo: "OWNER/REPO" });
  assert.match(findings(noModels, io(noModels)).join("\n"), /declares no "models" block/);
});

test("--fix rebuilds missing structure, because it is advertised as the way out of everything the check reports", () => {
  // The check went red, named the missing field, told the operator to run
  // --fix, and --fix changed nothing. A repair that cannot repair a shape its
  // own detector reports promises a recovery it does not have.
  for (const seed of [
    { ...SEED, models: { strongestClaude: SEED.models.strongestClaude } }, // a tier deleted
    { ...SEED, models: {} }, // both tiers deleted
    { _README: SEED._README, repo: "OWNER/REPO", _models: SEED._models }, // the block deleted
  ]) {
    const root = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") }, seed);
    assert.notDeepEqual(findings(root, io(root)), [], "the check did not detect the missing structure");

    fix(root, io(root));
    assert.deepEqual(findings(root, io(root)), [], `--fix left ${JSON.stringify(seed.models)} unrepaired`);

    const after = seedOf(root);
    assert.deepEqual(after.models.strongestClaude, { id: "claude-fable-5-1", effort: "xhigh" });
    assert.deepEqual(after.models.strongestCodex, { id: "gpt-6-astra", effort: "xhigh" });
    // Everything the repair does not own survives it, including the
    // placeholder that is refused by name if left in place.
    assert.equal(after.repo, "OWNER/REPO");
    assert.equal(after._README, SEED._README);
    assert.equal(after._models, SEED._models);

    // And a second repair is a no-op: a fix that keeps rewriting is a fix that
    // never converged.
    assert.deepEqual(fix(root, io(root)), []);
  }
});

test("a seed file that is absent or unparseable is still not invented", () => {
  // The one shape --fix genuinely cannot repair, kept as a stated limit rather
  // than guessed at: there is no parse to rewrite through and no prose to
  // preserve, so reconstructing one would invent a file nobody wrote.
  const missing = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") }, null);
  assert.deepEqual(fix(missing, io(missing)), []);
  assert.match(findings(missing, io(missing)).join("\n"), /missing, so a fresh consumer has nothing/);

  const broken = fixtureRoot({ "fable-x.md": def("fable-x", "model: claude-fable-5-1\neffort: xhigh") });
  fs.writeFileSync(path.join(broken, SEED_FILE), "{ not json");
  assert.deepEqual(fix(broken, io(broken)), []);
  assert.equal(fs.readFileSync(path.join(broken, SEED_FILE), "utf8"), "{ not json");
});

test("a CRLF definition reads identically to an LF one, so a pinned role is never silently skipped", () => {
  // The assertion the delimiter-only fix fails, which is why the whole
  // correction is one `split(/\r?\n/)`. With the close found by trimming but
  // the fields still carrying \r, `name` reads null — and findings() selects
  // roles by name.startsWith(PINNED_PREFIX), so the role would be SKIPPED and
  // the check would pass having checked nothing.
  const lf = def("fable-x", "model: claude-opus-5\neffort: low");
  const crlf = fixtureRoot({ "fable-x.md": lf.replace(/\n/g, "\r\n") });
  const plain = fixtureRoot({ "fable-x.md": lf });

  const strip = (out) => out.map((line) => line.replace(/^core\/[^:]+:/, ""));
  assert.deepEqual(strip(findings(crlf, io(crlf))), strip(findings(plain, io(plain))));
  assert.notDeepEqual(findings(crlf, io(crlf)), [], "a CRLF role was skipped instead of checked");
  assert.match(findings(crlf, io(crlf)).join("\n"), /is "claude-opus-5"/);

  // And it repairs, rather than being reported as unreadable forever.
  fix(crlf, io(crlf));
  assert.deepEqual(findings(crlf, io(crlf)), []);
});
