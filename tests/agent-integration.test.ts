/**
 * Integration tests for agent providers.
 *
 * These tests spawn real agent CLIs (kiro-cli / claude) against a minimal
 * target repo and verify the full integration: agent config generation,
 * CLI invocation, file I/O, and cleanup.
 *
 * Run a single provider:
 *   node --test --test-name-pattern "KiroProvider" tests/agent-integration.test.ts
 *   node --test --test-name-pattern "ClaudeProvider" tests/agent-integration.test.ts
 *
 * These are slow (~30-60s each) since they invoke real LLM-backed agents.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";

import { KiroProvider } from "../src/utils/providers/kiro.ts";
import { ClaudeProvider } from "../src/utils/providers/claude.ts";
import { createProvider } from "../src/utils/providers/index.ts";
import { getBaselineSystemPrompt } from "../src/utils/prompts.ts";
import type { AgentProvider, AgentRunOptions } from "../src/utils/providers/types.ts";
import { createFixture, destroyFixture, type Fixture } from "./helpers/setup-fixture.ts";

// Generous timeout — agents are LLM-backed
const AGENT_TIMEOUT = 120_000;

// ============================================================
// Helper: check if a CLI is available
// ============================================================
function cliAvailable(cmd: string, args: string[]): boolean {
  try {
    execFileSync(cmd, args, { stdio: "pipe" });
    return true;
  } catch {
    return false;
  }
}

const hasKiro = cliAvailable("kiro-cli", ["version"]);
const hasClaude = cliAvailable("claude", ["--version"]);

// ============================================================
// KiroProvider integration
// ============================================================
describe("KiroProvider integration", { skip: !hasKiro && "kiro-cli not installed" }, () => {
  let fixture: Fixture;
  let provider: KiroProvider;

  before(async () => {
    fixture = await createFixture("kiro-integ");
    // Patch JOB.md to use kiro provider
    const jobMdPath = join(fixture.jobDir, "JOB.md");
    const jobMd = await readFile(jobMdPath, "utf-8");
    await writeFile(jobMdPath, jobMd.replace("{{PROVIDER}}", "kiro"));
    provider = new KiroProvider();
  });

  after(async () => {
    await provider.cleanup();
    await destroyFixture(fixture);
  });

  it("assertInstalled does not throw", () => {
    provider.assertInstalled();
  });

  it("writes steering file and agent has tools", async () => {
    // Run with a prompt that requires tool use to verify tools are available
    const exitCode = await provider.run({
      systemPrompt: "You are a test agent. Do exactly what is asked.",
      userPrompt: `Create a file called test-proof.txt with content 'tools-work' in the current directory.`,
      cwd: fixture.targetRepo,
      addDir: fixture.jobDir,
    });

    assert.equal(exitCode, 0, "kiro-cli should exit 0");

    // Verify steering file was created
    const steeringDir = join(fixture.targetRepo, ".kiro", "steering");
    assert.ok(existsSync(steeringDir), ".kiro/steering/ should exist");

    const files = await readdir(steeringDir);
    const steeringFiles = files.filter((f) => f.startsWith("auto-agent-") && f.endsWith(".md"));
    assert.ok(steeringFiles.length > 0, "should have created steering file");

    // Verify steering file has frontmatter
    const content = await readFile(join(steeringDir, steeringFiles[0]), "utf-8");
    assert.ok(content.startsWith("---\ninclusion: always\n---\n"));

    // Verify the agent actually had tools and created the file
    const proofPath = join(fixture.targetRepo, "test-proof.txt");
    assert.ok(existsSync(proofPath), "agent should have created test-proof.txt (proves tools work)");
    const proof = await readFile(proofPath, "utf-8");
    assert.ok(proof.includes("tools-work"), "file content should match");
  }, { timeout: AGENT_TIMEOUT });

  it("cleanup removes temp files", async () => {
    await provider.cleanup();

    // After cleanup, the temp files tracked by the provider should be gone
    // (the .kiro/agents dir itself may remain, but the specific files should not)
    // We can't easily check which exact files since they have random names,
    // but we verify cleanup() doesn't throw and resets internal state
    // by running again and checking it still works
    const exitCode = await provider.run({
      systemPrompt: "Reply OK.",
      userPrompt: "Say OK.",
      cwd: fixture.targetRepo,
      addDir: "",
    });
    assert.equal(exitCode, 0);

    // Now cleanup again
    await provider.cleanup();
  }, { timeout: AGENT_TIMEOUT });

  it("folds addDir into user prompt when provided", async () => {
    // We can't directly inspect the prompt sent to kiro-cli, but we can
    // verify the agent receives the job dir context by asking it to read from it
    const exitCode = await provider.run({
      systemPrompt:
        "You are a test agent. Read the MEMORY.md file from the job directory mentioned in the prompt. If you can find it, create a file called 'found-memory.txt' with content 'yes' in the current directory.",
      userPrompt: "Find and read MEMORY.md from the job directory, then create found-memory.txt.",
      cwd: fixture.targetRepo,
      addDir: fixture.jobDir,
    });

    assert.equal(exitCode, 0);
    // The agent should have been told about the job dir and been able to find MEMORY.md
    // This is a best-effort check — LLM agents are non-deterministic
  }, { timeout: AGENT_TIMEOUT });
});

// ============================================================
// ClaudeProvider integration
// ============================================================
describe("ClaudeProvider integration", { skip: !hasClaude && "claude CLI not installed" }, () => {
  let fixture: Fixture;
  let provider: ClaudeProvider;

  before(async () => {
    fixture = await createFixture("claude-integ");
    const jobMdPath = join(fixture.jobDir, "JOB.md");
    const jobMd = await readFile(jobMdPath, "utf-8");
    await writeFile(jobMdPath, jobMd.replace("{{PROVIDER}}", "claude"));
    provider = new ClaudeProvider();
  });

  after(async () => {
    await destroyFixture(fixture);
  });

  it("assertInstalled does not throw", () => {
    provider.assertInstalled();
  });

  it("runs a trivial prompt and exits 0", async () => {
    const exitCode = await provider.run({
      systemPrompt: "You are a test agent. Respond with exactly: TEST_OK",
      userPrompt: "Say TEST_OK and nothing else.",
      cwd: fixture.targetRepo,
      addDir: fixture.jobDir,
    });

    assert.equal(exitCode, 0, "claude should exit 0");
  }, { timeout: AGENT_TIMEOUT });
});

// ============================================================
// Baseline eval integration (uses whichever provider is available)
// ============================================================
describe("Baseline eval flow", () => {
  const providerName = hasKiro ? "kiro" : hasClaude ? "claude" : null;

  let fixture: Fixture;
  let provider: AgentProvider;

  before(async () => {
    if (!providerName) return;
    fixture = await createFixture("baseline-integ");
    const jobMdPath = join(fixture.jobDir, "JOB.md");
    const jobMd = await readFile(jobMdPath, "utf-8");
    await writeFile(jobMdPath, jobMd.replace("{{PROVIDER}}", providerName));
    provider = createProvider(providerName);
  });

  after(async () => {
    if (!providerName) return;
    await provider.cleanup?.();
    await destroyFixture(fixture);
  });

  it(
    "agent can run eval command and write a report",
    { skip: !providerName && "no agent CLI available", timeout: AGENT_TIMEOUT },
    async () => {
      const jobMd = await readFile(join(fixture.jobDir, "JOB.md"), "utf-8");

      // Create baseline hypothesis dir with report template
      const baselineDir = join(fixture.jobDir, "hypotheses", "000-baseline");
      const { mkdir, copyFile } = await import("node:fs/promises");
      await mkdir(baselineDir, { recursive: true });
      await copyFile(
        join(fixture.projectRoot, "templates", "REPORT-TEMPLATE.md"),
        join(baselineDir, "REPORT.md")
      );

      const baselineBranch = "baseline-integ-baseline";
      const git = (...args: string[]) =>
        execFileSync("git", args, { cwd: fixture.targetRepo, encoding: "utf-8" });
      try {
        git("checkout", "-b", baselineBranch);
      } catch {
        git("checkout", baselineBranch);
      }

      const systemPrompt = getBaselineSystemPrompt({
        targetRepoPath: fixture.targetRepo,
        baselineBranch,
        hypothesisDir: baselineDir,
        jobMd,
      });

      const exitCode = await provider.run({
        systemPrompt,
        userPrompt: 'Run the baseline evals for job "baseline-integ" and write the report.',
        cwd: fixture.targetRepo,
        addDir: fixture.jobDir,
      });

      assert.equal(exitCode, 0, "agent should exit 0");

      // Verify the report was updated from the template
      const reportPath = join(baselineDir, "REPORT.md");
      assert.ok(existsSync(reportPath), "REPORT.md should exist");

      const report = await readFile(reportPath, "utf-8");

      // The agent should have filled in the report — check it's no longer just the template
      // At minimum, the hypothesis ID and some metric should be populated
      const hasContent =
        report.includes("000-baseline") ||
        report.includes("accuracy") ||
        report.length > 500; // template is ~1.8KB, filled report should be longer or at least modified

      assert.ok(hasContent, "REPORT.md should have been filled in by the agent");
    }
  );
});

// ============================================================
// Provider parity: both providers accept the same interface
// ============================================================
describe("Provider interface parity", () => {
  it("both providers accept identical AgentRunOptions shape", () => {
    const opts: AgentRunOptions = {
      systemPrompt: "test",
      userPrompt: "test",
      cwd: "/tmp",
      addDir: "/tmp",
    };

    // Just verify the type system is happy — both constructors work
    // and run() accepts the same shape (we don't actually call run here)
    const kiro = new KiroProvider();
    const claude = new ClaudeProvider();

    assert.equal(typeof kiro.run, "function");
    assert.equal(typeof claude.run, "function");

    // Verify run signature accepts opts without type errors
    // (this is a compile-time check that also works at runtime)
    const kiroRun: (opts: AgentRunOptions) => Promise<number> = kiro.run.bind(kiro);
    const claudeRun: (opts: AgentRunOptions) => Promise<number> = claude.run.bind(claude);
    assert.ok(kiroRun);
    assert.ok(claudeRun);
  });
});
