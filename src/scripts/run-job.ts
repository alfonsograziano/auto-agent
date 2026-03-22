import { parseArgs, styleText } from "node:util";
import { readFile, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createHypothesis } from "../utils/create-hypothesis.ts";
import { initLogger, closeLogger, formatDuration, formatTimestamp } from "../utils/logger.ts";
import { getHypothesisSystemPrompt } from "../utils/prompts.ts";
import { assertClaudeInstalled, runClaude } from "../utils/run-claude.ts";
import { runBaselineEvals } from "./run-baseline-evals.ts";

// --- Preflight check ---

assertClaudeInstalled();

// --- CLI parsing ---

const { values } = parseArgs({
  options: {
    id: { type: "string", short: "i" },
    "max-iterations": { type: "string", short: "m" },
  },
  strict: true,
});

if (!values.id) {
  console.error(
    styleText("red", "Usage: npm run run-job -- --id <job-id> [--max-iterations <n>]")
  );
  process.exit(1);
}

const jobId = values.id;
const maxIterations = parseInt(values["max-iterations"] ?? "5", 10);
const projectRoot = resolve(import.meta.dirname, "..", "..");
const jobDir = join(projectRoot, "jobs", jobId);

if (!existsSync(jobDir)) {
  console.error(styleText("red", `Error: Job folder not found at ${jobDir}`));
  console.error(`Run: ${styleText("yellow", `npm run create-job -- --id ${jobId}`)}`);
  process.exit(1);
}

// --- Init logger (tees stdout/stderr to out.log.txt) ---

initLogger(jobDir);

const jobStartTime = Date.now();

console.log(styleText("bold", `\n🔬 Auto-Agent — Job "${jobId}"`));
console.log(styleText("dim", "─".repeat(60)));
console.log(`  Job dir:        ${styleText("cyan", jobDir)}`);
console.log(`  Max iterations: ${styleText("cyan", String(maxIterations))}`);
console.log(`  Started at:     ${styleText("cyan", new Date().toISOString())}`);
console.log(styleText("dim", "─".repeat(60)));
console.log("");

// --- Load JOB.md ---

const jobMdPath = join(jobDir, "JOB.md");
const jobMd = await readFile(jobMdPath, "utf-8");

const pathMatch = jobMd.match(/\*\*Path\*\*:\s*(.+)/);
const branchMatch = jobMd.match(/\*\*Branch\*\*:\s*(.+)/);

if (!pathMatch || !branchMatch) {
  console.error(
    styleText("red", "Error: Could not parse Target Repository path or branch from JOB.md")
  );
  process.exit(1);
}

const targetRepoRelative = pathMatch[1].trim();
const baseBranch = branchMatch[1].trim();
const targetRepoPath = resolve(jobDir, targetRepoRelative);

if (!existsSync(targetRepoPath)) {
  console.error(styleText("red", `Error: Target repo not found at ${targetRepoPath}`));
  process.exit(1);
}

console.log(`  Target repo:    ${styleText("cyan", targetRepoPath)}`);
console.log(`  Base branch:    ${styleText("cyan", baseBranch)}`);
console.log("");

// --- Git helper ---

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: targetRepoPath,
    encoding: "utf-8",
  }).trim();
}

// --- Auto-run baseline if missing ---

const baselineDir = join(jobDir, "hypotheses", "000-baseline");
const baselineBranch = `${jobId}-baseline`;

if (!existsSync(baselineDir)) {
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} ${styleText("bold", "Running baseline evals...")}`);
  const baselineStart = Date.now();
  await runBaselineEvals({
    jobId,
    jobDir,
    jobMd,
    targetRepoPath,
    baseBranch,
    projectRoot,
  });
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} ${styleText("green", "✓")} Baseline evals ${styleText("dim", `(${formatDuration(Date.now() - baselineStart)})`)}`);
  console.log("");
}

// --- Read baseline REPORT.md (read once, constant across iterations) ---

const baselineReportPath = join(baselineDir, "REPORT.md");
if (!existsSync(baselineReportPath)) {
  console.error(
    styleText("red", `Error: Baseline REPORT.md not found at ${baselineReportPath}`)
  );
  process.exit(1);
}
const baselineReport = await readFile(baselineReportPath, "utf-8");

// --- Load prompt engineering skill ---

const promptEngineeringPath = join(projectRoot, ".claude", "skills", "prompt-engineering", "SKILL.md");
const promptEngineeringSkill = await readFile(promptEngineeringPath, "utf-8");

// --- Ensure we're on the baseline branch ---

const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD");
if (currentBranch !== baselineBranch) {
  try {
    git("checkout", baselineBranch);
  } catch {
    git("checkout", baseBranch);
  }
}

// --- Helpers ---

function parseDecision(
  reportContent: string
): "CONTINUE" | "ROLLBACK" | null {
  const match = reportContent.match(/\*\*Decision:\s*(CONTINUE|ROLLBACK)\*\*/);
  return (match?.[1] as "CONTINUE" | "ROLLBACK") ?? null;
}

function parseAccuracy(reportContent: string): string {
  const match = reportContent.match(/\|\s*accuracy\s*\|\s*(.+?)\s*\|/);
  return match?.[1]?.trim() ?? "N/A";
}

// --- Main loop ---

let bestBranch = baselineBranch;
const reportTemplatePath = join(projectRoot, "templates", "REPORT-TEMPLATE.md");
const iterationTimings: { id: string; duration: number; decision: string; accuracy: string }[] = [];

console.log(styleText("bold", "Starting optimization loop"));
console.log("");

for (let i = 0; i < maxIterations; i++) {
  const seq = String(i + 1).padStart(3, "0");
  const hexId = randomBytes(3).toString("hex");
  const hypId = `${seq}-${hexId}`;
  const hypBranch = `${jobId}-hyp-${hypId}`;

  console.log(`\n${styleText("cyan", "=".repeat(60))}`);
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} ${styleText("bold", `Iteration ${i + 1}/${maxIterations}`)} — Hypothesis ${styleText("yellow", hypId)}`);
  console.log(`${styleText("cyan", "=".repeat(60))}\n`);

  const iterationStart = Date.now();

  // Create hypothesis folder
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

  console.log(`  Branch: ${styleText("cyan", hypBranch)} (from ${styleText("dim", bestBranch)})`);

  // Re-read MEMORY.md each iteration
  const memoryMd = await readFile(join(jobDir, "MEMORY.md"), "utf-8");

  // Build system prompt
  const systemPrompt = getHypothesisSystemPrompt({
    targetRepoPath,
    hypBranch,
    hypId,
    hypothesisDir: hypothesis.dir,
    memoryMdPath: join(jobDir, "MEMORY.md"),
    promptEngineeringSkill,
    baselineReport,
    memoryMd,
    jobMd,
  });

  const userPrompt = `Run hypothesis ${hypId} (iteration ${i + 1}/${maxIterations}) for job "${jobId}". Analyze the failures, implement an improvement, run evals, and fill in the report.`;

  // Spawn Claude Code
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} ${styleText("bold", "  Agent running...")}`);
  const agentStart = Date.now();
  const exitCode = await runClaude(
    systemPrompt,
    userPrompt,
    targetRepoPath,
    jobDir
  );
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} ${styleText("green", "✓")} Agent ${styleText("dim", `(${formatDuration(Date.now() - agentStart)})`)}`);

  // Parse decision from REPORT.md
  const reportPath = join(hypothesis.dir, "REPORT.md");

  if (exitCode !== 0) {
    console.error(styleText("red", `\nClaude Code exited with code ${exitCode}.`));
    process.exit(1);
  }

  if (!existsSync(reportPath)) {
    console.error(styleText("red", `\nREPORT.md not found at ${reportPath}.`));
    process.exit(1);
  }

  const reportContent = await readFile(reportPath, "utf-8");
  const decision = parseDecision(reportContent);
  const accuracy = parseAccuracy(reportContent);

  if (!decision) {
    console.error(
      styleText("red", `\nNo valid **Decision: CONTINUE** or **Decision: ROLLBACK** found in ${reportPath}.`)
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
  } else {
    git("checkout", bestBranch);
  }

  const iterationDuration = Date.now() - iterationStart;
  iterationTimings.push({ id: hypId, duration: iterationDuration, decision, accuracy });

  // Print iteration summary
  const decisionColor = decision === "CONTINUE" ? "green" : "red";
  console.log(`\n${styleText("dim", "─".repeat(60))}`);
  console.log(
    `  ${styleText("bold", `Result:`)} ${styleText(decisionColor, decision)} | Accuracy: ${styleText("yellow", accuracy)} | Duration: ${styleText("dim", formatDuration(iterationDuration))}`
  );
  console.log(`  Best branch: ${styleText("cyan", bestBranch)}`);
  console.log(`${styleText("dim", "─".repeat(60))}`);
}

// --- Final summary ---

const totalDuration = Date.now() - jobStartTime;

console.log(`\n${styleText("green", "=".repeat(60))}`);
console.log(styleText("bold", "  Job complete"));
console.log(`${styleText("green", "=".repeat(60))}\n`);

console.log(styleText("bold", "  Iteration Summary:"));
console.log(`  ${"#".padEnd(4)} ${"Hypothesis".padEnd(14)} ${"Decision".padEnd(12)} ${"Accuracy".padEnd(12)} Duration`);
console.log(`  ${styleText("dim", "─".repeat(56))}`);
for (let i = 0; i < iterationTimings.length; i++) {
  const t = iterationTimings[i];
  const decColor = t.decision === "CONTINUE" ? "green" : "red";
  console.log(
    `  ${String(i + 1).padEnd(4)} ${t.id.padEnd(14)} ${styleText(decColor, t.decision.padEnd(12))} ${t.accuracy.padEnd(12)} ${formatDuration(t.duration)}`
  );
}
console.log("");
console.log(`  Total time:      ${styleText("bold", formatDuration(totalDuration))}`);
console.log(`  Final branch:    ${styleText("bold", bestBranch)}`);
console.log(`  Job artifacts:   ${styleText("cyan", jobDir)}`);
console.log(`  Full log:        ${styleText("cyan", join(jobDir, "out.log.txt"))}`);
console.log("");

closeLogger();
