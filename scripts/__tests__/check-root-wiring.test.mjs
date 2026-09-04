import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync, cpSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

import { run } from "../check-root-wiring.mjs";

const IGNORE = "# a comment, ignored by the comparison\npr-*.json\nloop-round-check-*.json\n";

/**
 * A minimal repo shaped like the handbook: payload under core/, root wiring
 * beside it. Every test starts from a WIRED tree and breaks one thing, so a
 * passing assertion means the check found that specific break rather than
 * tripping on fixture noise.
 */
function fixture() {
  const root = mkdtempSync(join(tmpdir(), "root-wiring-"));
  mkdirSync(join(root, "core/.claude/skills/alpha"), { recursive: true });
  mkdirSync(join(root, "core/.claude/skills/beta"), { recursive: true });
  mkdirSync(join(root, "core/.claude/agents"), { recursive: true });
  mkdirSync(join(root, "core/.agents/receipts"), { recursive: true });
  mkdirSync(join(root, ".claude/skills"), { recursive: true });
  mkdirSync(join(root, ".claude/agents"), { recursive: true });
  mkdirSync(join(root, ".agents/receipts"), { recursive: true });

  writeFileSync(join(root, "core/.claude/skills/alpha/SKILL.md"), "alpha");
  writeFileSync(join(root, "core/.claude/skills/beta/SKILL.md"), "beta");
  writeFileSync(join(root, "core/.claude/agents/one.md"), "one");
  writeFileSync(join(root, "core/.agents/receipts/.gitignore"), IGNORE);
  writeFileSync(join(root, ".agents/receipts/.gitignore"), IGNORE);

  symlinkSync("../../core/.claude/skills/alpha", join(root, ".claude/skills/alpha"));
  symlinkSync("../../core/.claude/skills/beta", join(root, ".claude/skills/beta"));
  symlinkSync("../../core/.claude/agents/one.md", join(root, ".claude/agents/one.md"));
  return root;
}

const cleanup = (root) => rmSync(root, { recursive: true, force: true });

test("a fully wired tree reports nothing", () => {
  const root = fixture();
  try {
    assert.deepEqual(run(root), []);
  } finally {
    cleanup(root);
  }
});

test("a payload skill with no root link is reported, with the command that fixes it", () => {
  const root = fixture();
  try {
    rmSync(join(root, ".claude/skills/beta"));
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /core\/\.claude\/skills\/beta is payload/);
    assert.match(problems[0], /ln -s \.\.\/\.\.\/core\/\.claude\/skills\/beta \.claude\/skills\/beta/);
  } finally {
    cleanup(root);
  }
});

test("a payload AGENT with no root link is reported too, not just skills", () => {
  const root = fixture();
  try {
    rmSync(join(root, ".claude/agents/one.md"));
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /core\/\.claude\/agents\/one\.md is payload/);
  } finally {
    cleanup(root);
  }
});

test("a real copy at the root is refused -- that is the second source of truth", () => {
  const root = fixture();
  try {
    rmSync(join(root, ".claude/skills/alpha"));
    cpSync(join(root, "core/.claude/skills/alpha"), join(root, ".claude/skills/alpha"), {
      recursive: true,
    });
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /not a link into the payload/);
  } finally {
    cleanup(root);
  }
});

test("a dangling link is reported -- a stale link reads as wired, which is worse than a missing one", () => {
  const root = fixture();
  try {
    symlinkSync("../../core/.claude/skills/gone", join(root, ".claude/skills/gone"));
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /DANGLING/);
  } finally {
    cleanup(root);
  }
});

test("a root link pointing outside the payload is reported", () => {
  const root = fixture();
  try {
    mkdirSync(join(root, "elsewhere/rogue"), { recursive: true });
    symlinkSync("../../elsewhere/rogue", join(root, ".claude/skills/rogue"));
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /which is not an entry in core\/\.claude\/skills/);
  } finally {
    cleanup(root);
  }
});

test("a link whose target is the WRONG payload entry is reported", () => {
  const root = fixture();
  try {
    rmSync(join(root, ".claude/skills/alpha"));
    symlinkSync("../../core/.claude/skills/beta", join(root, ".claude/skills/alpha"));
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /points at core\/\.claude\/skills\/beta, not core\/\.claude\/skills\/alpha/);
  } finally {
    cleanup(root);
  }
});

test("gitignore drift is reported, and comments are NOT what it compares", () => {
  const root = fixture();
  try {
    // Same patterns, different commentary -- must stay silent, or every edit to
    // the explanatory header would read as drift.
    writeFileSync(
      join(root, ".agents/receipts/.gitignore"),
      "# entirely different prose\n#\n# over several lines\npr-*.json\nloop-round-check-*.json\n",
    );
    assert.deepEqual(run(root), []);

    writeFileSync(join(root, ".agents/receipts/.gitignore"), "pr-*.json\n");
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /has drifted from/);
  } finally {
    cleanup(root);
  }
});

test("a SYMLINKED root gitignore is refused -- git does not follow one", () => {
  const root = fixture();
  try {
    rmSync(join(root, ".agents/receipts/.gitignore"));
    symlinkSync("../../core/.agents/receipts/.gitignore", join(root, ".agents/receipts/.gitignore"));
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /Git does not follow a symlinked \.gitignore/);
  } finally {
    cleanup(root);
  }
});

test("a missing root directory is reported once, not once per payload entry", () => {
  const root = fixture();
  try {
    rmSync(join(root, ".claude/skills"), { recursive: true });
    const problems = run(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /loads none of its own skills/);
  } finally {
    cleanup(root);
  }
});
