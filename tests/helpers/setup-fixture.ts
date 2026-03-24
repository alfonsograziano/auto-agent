/**
 * Creates a minimal throwaway git repo + job folder for integration tests.
 * The "target agent" is a trivial script that echoes JSON eval results.
 */
import { mkdir, writeFile, cp, rm } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";

export interface Fixture {
  /** Root temp dir (delete this to clean up everything) */
  root: string;
  /** Path to the fake target repo */
  targetRepo: string;
  /** Path to the job folder inside the auto-agent project */
  jobDir: string;
  /** The job ID */
  jobId: string;
  /** Path to the auto-agent project root */
  projectRoot: string;
}

export async function createFixture(jobId: string): Promise<Fixture> {
  const root = mkdtempSync(join(tmpdir(), `auto-agent-integ-${jobId}-`));
  const targetRepo = join(root, "target-repo");
  const projectRoot = join(root, "auto-agent");
  const jobDir = join(projectRoot, "jobs", jobId);

  // --- Scaffold auto-agent project structure ---
  const realProjectRoot = join(import.meta.dirname, "..", "..");
  // Copy templates and skill files the scripts expect
  await mkdir(join(projectRoot, "templates"), { recursive: true });
  await cp(join(realProjectRoot, "templates"), join(projectRoot, "templates"), { recursive: true });
  await mkdir(join(projectRoot, ".claude", "skills", "prompt-engineering"), { recursive: true });
  await cp(
    join(realProjectRoot, ".claude", "skills", "prompt-engineering"),
    join(projectRoot, ".claude", "skills", "prompt-engineering"),
    { recursive: true }
  );

  // --- Create a minimal target repo with a trivial eval script ---
  await mkdir(join(targetRepo, "evals"), { recursive: true });

  // A tiny "agent" — just a file the agent could modify
  await writeFile(join(targetRepo, "agent.txt"), "I am a stub agent.\n");

  // Eval script: outputs fixed JSON results
  await writeFile(
    join(targetRepo, "eval.mjs"),
    `const results = {
  summary: { accuracy: 0.5, latency_avg_ms: 100, cost_usd: 0.01 },
  cases: [
    { id: "case-1", input: "2+2", expected: "4", actual: "4", passed: true },
    { id: "case-2", input: "sqrt(9)", expected: "3", actual: "unknown", passed: false },
  ],
};
console.log(JSON.stringify(results));
`
  );

  // package.json so npm commands work
  await writeFile(
    join(targetRepo, "package.json"),
    JSON.stringify({
      name: "test-target-agent",
      version: "1.0.0",
      scripts: {
        eval: "node eval.mjs",
        build: "echo build-ok",
        test: "echo test-ok",
      },
    })
  );

  // Init git repo
  const git = (...args: string[]) =>
    execFileSync("git", args, { cwd: targetRepo, encoding: "utf-8" });
  git("init", "-b", "main");
  git("add", "-A");
  git("commit", "-m", "initial commit");

  // --- Create job folder ---
  await mkdir(join(jobDir, "hypotheses"), { recursive: true });

  // MEMORY.md from template
  await cp(join(projectRoot, "templates", "MEMORY-TEMPLATE.md"), join(jobDir, "MEMORY.md"));

  // JOB.md pointing at the target repo
  await writeFile(
    join(jobDir, "JOB.md"),
    `## Objective
Improve accuracy on the math eval from 50% to 100%.

## Target Repository
- **Path**: ${targetRepo}
- **Branch**: main

## Provider
- **Provider**: {{PROVIDER}}

## Metrics
- **Primary metric**: accuracy (maximize)
- **Secondary constraints**:
  - latency_avg_ms: max 20% regression
  - cost_usd: max 50% regression

## Scripts
| Script | Command | When it runs |
|--------|---------|--------------|
| Build | \`npm run build\` | After each hypothesis |
| Run evals | \`node eval.mjs\` | After each build |

## Forbidden Files
- \`evals/\`
- \`eval.mjs\`

## Constraints
None.

## Codebase Overview
Trivial test repo with agent.txt and eval.mjs.

## What the Agent Can Do
Modify agent.txt.

## Starting State
Stub agent with 50% accuracy.

## Golden Dataset Info
2 cases: one arithmetic, one sqrt.

## Environment & Prerequisites
Node.js available.

## Priority Hints
None.
`
  );

  return { root, targetRepo, jobDir, jobId, projectRoot };
}

export async function destroyFixture(fixture: Fixture): Promise<void> {
  await rm(fixture.root, { recursive: true, force: true });
}
