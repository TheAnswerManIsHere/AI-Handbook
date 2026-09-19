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

import { findings, fix, main, splitFrontmatter, agentDefinitions, REPO_ROOT } from "../check-agent-models.mjs";

const PIN = { strongestClaude: { id: "claude-fable-5-1", effort: "xhigh" }, strongestCodex: { id: "gpt-6-astra", effort: "xhigh" } };

let roots = 0;
const io = (root, models = PIN) => ({ root: `${root}#${(roots += 1)}`, read: () => JSON.stringify({ repo: "Owner/Name", models }) });

const fixtureRoot = (files) => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "agent-models-"));
  const dir = path.join(root, "core", ".claude", "agents");
  fs.mkdirSync(dir, { recursive: true });
  for (const [name, text] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), text);
  return root;
};

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
  assert.match(logged, /2 role declarations disagree with the pin/);
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
