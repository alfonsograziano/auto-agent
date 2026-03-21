import { parseArgs } from "node:util";
import { readFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { spawn, execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createHypothesis } from "../utils/create-hypothesis.ts";

// --- CLI parsing (Task 1) ---

const { values } = parseArgs({
  options: {
    id: { type: "string", short: "i" },
    "max-iterations": { type: "string", short: "m" },
  },
  strict: true,
});

if (!values.id) {
  console.error(
    "Usage: npm run run-job -- --id <job-id> [--max-iterations <n>]"
  );
  process.exit(1);
}

const jobId = values.id;
const maxIterations = parseInt(values["max-iterations"] ?? "5", 10);
const projectRoot = resolve(import.meta.dirname, "..");
const jobDir = join(projectRoot, "jobs", jobId);

if (!existsSync(jobDir)) {
  console.error(`Error: Job folder not found at ${jobDir}`);
  console.error(`Run: npm run create-job -- --id ${jobId}`);
  process.exit(1);
}

// --- Load JOB.md ---

const jobMdPath = join(jobDir, "JOB.md");
const jobMd = await readFile(jobMdPath, "utf-8");

const pathMatch = jobMd.match(/\*\*Path\*\*:\s*(.+)/);
const branchMatch = jobMd.match(/\*\*Branch\*\*:\s*(.+)/);

if (!pathMatch || !branchMatch) {
  console.error(
    "Error: Could not parse Target Repository path or branch from JOB.md"
  );
  process.exit(1);
}

const targetRepoRelative = pathMatch[1].trim();
const baseBranch = branchMatch[1].trim();
const targetRepoPath = resolve(jobDir, targetRepoRelative);

if (!existsSync(targetRepoPath)) {
  console.error(`Error: Target repo not found at ${targetRepoPath}`);
  process.exit(1);
}

// --- Git helper ---

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: targetRepoPath,
    encoding: "utf-8",
  }).trim();
}

// --- Auto-run baseline if missing (Task 3) ---

const baselineDir = join(jobDir, "hypotheses", "000-baseline");
const baselineBranch = `${jobId}-baseline`;

if (!existsSync(baselineDir)) {
  console.log("Baseline not found. Running baseline evals...");
  execFileSync(
    "node",
    [join(projectRoot, "scripts", "run-baseline-evals.ts"), "--id", jobId],
    { cwd: projectRoot, stdio: "inherit" }
  );
  console.log("Baseline complete.\n");
}

// --- Read baseline REPORT.md (read once, constant across iterations) (Task 4) ---

const baselineReportPath = join(baselineDir, "REPORT.md");
if (!existsSync(baselineReportPath)) {
  console.error(
    `Error: Baseline REPORT.md not found at ${baselineReportPath}`
  );
  process.exit(1);
}
const baselineReport = await readFile(baselineReportPath, "utf-8");

// --- Ensure we're on the baseline branch ---

const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD");
if (currentBranch !== baselineBranch) {
  try {
    git("checkout", baselineBranch);
  } catch {
    git("checkout", baseBranch);
  }
}

// --- Claude Code spawn helper wrapped in Promise (Task 7) ---

function runClaude(
  systemPrompt: string,
  userPrompt: string,
  cwd: string,
  addDir: string
): Promise<number> {
  return new Promise((resolve) => {
    const claude = spawn(
      "claude",
      [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--system-prompt",
        systemPrompt,
        "--add-dir",
        addDir,
        "-p",
        userPrompt,
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "inherit"],
      }
    );

    claude.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                process.stdout.write(block.text);
              } else if (block.type === "tool_use") {
                console.log(
                  `\n[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`
                );
              }
            }
          } else if (event.type === "result") {
            console.log("\n[done]", event.subtype ?? "");
          }
        } catch {
          // not valid JSON, skip
        }
      }
    });

    claude.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}

// --- Decision parser (Task 8) ---

function parseDecision(
  reportContent: string
): "CONTINUE" | "ROLLBACK" | null {
  const match = reportContent.match(/\*\*Decision:\s*(CONTINUE|ROLLBACK)\*\*/);
  return (match?.[1] as "CONTINUE" | "ROLLBACK") ?? null;
}

// --- Accuracy parser for summary ---

function parseAccuracy(reportContent: string): string {
  const match = reportContent.match(
    /\|\s*accuracy\s*\|\s*(.+?)\s*\|/
  );
  return match?.[1]?.trim() ?? "N/A";
}

// --- Main loop ---

let bestBranch = baselineBranch;
const reportTemplatePath = join(projectRoot, "templates", "REPORT-TEMPLATE.md");

console.log(`Starting optimization loop for job "${jobId}"`);
console.log(`Max iterations: ${maxIterations}`);
console.log(`Target repo: ${targetRepoPath}`);
console.log(`Best branch: ${bestBranch}`);
console.log();

for (let i = 0; i < maxIterations; i++) {
  const seq = String(i + 1).padStart(3, "0");
  const hexId = randomBytes(3).toString("hex");
  const hypId = `${seq}-${hexId}`;
  const hypBranch = `${jobId}-hyp-${hypId}`;

  console.log(`\n${"=".repeat(60)}`);
  console.log(`[iteration ${i + 1}/${maxIterations}] Starting hypothesis ${hypId}`);
  console.log(`${"=".repeat(60)}\n`);

  // Create hypothesis folder + SQLite row
  const hypothesis = await createHypothesis({
    jobDir,
    id: hypId,
    statement: "pending",
    branchName: hypBranch,
  });

  // Copy REPORT template
  await copyFile(reportTemplatePath, join(hypothesis.dir, "REPORT.md"));

  // Create git branch from current best
  git("checkout", bestBranch);
  try {
    git("checkout", "-b", hypBranch);
  } catch {
    git("checkout", hypBranch);
  }

  // Re-read MEMORY.md each iteration (Task 4)
  const memoryMd = await readFile(join(jobDir, "MEMORY.md"), "utf-8");

  // Build system prompt (Task 6) — EARS syntax + VERIFY checklist
  const systemPrompt = `You are an autonomous agent improver. You study a target agent's codebase, understand how it works, identify why evals fail, and implement fixes.

## How to work
1. **Study the codebase first.** Read the agent's source code, understand its architecture, how it processes inputs, what tools it has, how the system prompt is structured, and how to modify it. Check the job configuration below for codebase overview and constraints.
2. **Analyze failures.** Read the baseline report and job memory. Group failing eval cases by root cause — look for classes of errors (e.g., "all arithmetic fails because there's no calculator tool" rather than treating each case individually).
3. **Formulate a hypothesis.** Target one class of failures (or a few related ones). Your hypothesis should be specific and testable: "Adding X will fix cases Y, Z because they all fail for reason W."
4. **Implement the fix.** Make changes in the target repo. You can add tools, modify the system prompt, refactor logic, add dependencies, create helper functions — whatever the job configuration allows.
5. **Debug and test.** Run the agent manually on a failing case if needed. Check that the project builds. Iterate on your fix until it works.
6. **Run the full eval suite** using the eval command from the job configuration. Compare results to the baseline.
7. **Avoid regressions.** If your change fixes some cases but breaks others that previously passed, investigate and fix the regression before finalizing. A net improvement with no regressions is the goal.
8. **Fill in REPORT.md and update MEMORY.md.**

## Context
- Target repository: ${targetRepoPath} (branch: "${hypBranch}")
- Hypothesis ID: ${hypId}
- REPORT.md: ${hypothesis.dir}/REPORT.md (exists from template — update in place)
- MEMORY.md: ${join(jobDir, "MEMORY.md")}

## Rules
1. The system shall not modify any files matching the forbidden paths listed in the job configuration.
2. When implementation is complete, the system shall verify the project builds and the eval command exits successfully before writing the report.
3. The system shall fill in every section of REPORT.md, replacing all placeholders, and end the Recommendation section with exactly **Decision: CONTINUE** or **Decision: ROLLBACK** on its own line.
4. The system shall update MEMORY.md before finishing — recording the hypothesis, outcome, metrics changes, and patterns observed.
5. If the system identifies an improvement it cannot execute, it shall note it in the REPORT.md Summary section instead of attempting it.

VERIFY before finishing:
1. No forbidden files were modified.
2. The project builds and evals ran successfully.
3. Every section of REPORT.md is filled in and the Recommendation ends with **Decision: CONTINUE** or **Decision: ROLLBACK**.
4. MEMORY.md has been updated with learnings from this hypothesis.
5. The hypothesis statement in REPORT.md is specific and testable — not vague.
6. No previously passing eval cases now fail (no regressions).

## Baseline Report
${baselineReport}

## Job Memory
${memoryMd}

## Job Configuration
${jobMd}`;

  const userPrompt = `Run hypothesis ${hypId} (iteration ${i + 1}/${maxIterations}) for job "${jobId}". Analyze the failures, implement an improvement, run evals, and fill in the report.`;

  // Spawn Claude Code (Task 7)
  const exitCode = await runClaude(
    systemPrompt,
    userPrompt,
    targetRepoPath,
    jobDir
  );

  // Parse decision from REPORT.md
  const reportPath = join(hypothesis.dir, "REPORT.md");

  if (exitCode !== 0) {
    console.error(`\nClaude Code exited with code ${exitCode}.`);
    process.exit(1);
  }

  if (!existsSync(reportPath)) {
    console.error(`\nREPORT.md not found at ${reportPath}.`);
    process.exit(1);
  }

  const reportContent = await readFile(reportPath, "utf-8");
  const decision = parseDecision(reportContent);
  const accuracy = parseAccuracy(reportContent);

  if (!decision) {
    console.error(
      `\nNo valid **Decision: CONTINUE** or **Decision: ROLLBACK** found in ${reportPath}.`
    );
    process.exit(1);
  }

  // Commit all changes on the hypothesis branch (regardless of decision)
  try {
    git("add", "-A");
    git("commit", "-m", `feat(experiment): hypothesis ${hypId} - ${decision}`);
  } catch {
    // Nothing to commit (no changes made) — that's fine
  }

  // Handle decision
  if (decision === "CONTINUE") {
    bestBranch = hypBranch;
    // Next iteration will branch from this accepted branch
  } else {
    // Backtrack: return to the branch this hypothesis was created from
    git("checkout", bestBranch);
  }

  // Print summary (Task 11)
  console.log(`\n${"—".repeat(60)}`);
  console.log(
    `[iteration ${i + 1}/${maxIterations}] Hypothesis ${hypId}: ${decision} | Accuracy: ${accuracy}`
  );
  console.log(`Best branch: ${bestBranch}`);
  console.log(`${"—".repeat(60)}\n`);
}

console.log("\nOptimization loop complete.");
console.log(`Final best branch: ${bestBranch}`);
console.log(`Job artifacts: ${jobDir}`);
