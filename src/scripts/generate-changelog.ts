import { parseArgs, styleText } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { createProvider, type ProviderName } from "../utils/providers/index.ts";
import {
  getChangelogSystemPrompt,
  type HypothesisMeta,
} from "../utils/prompts.ts";

// --- CLI parsing ---

const { values } = parseArgs({
  options: {
    job: { type: "string", short: "j" },
    branch: { type: "string", short: "b" },
  },
  strict: true,
});

if (!values.job) {
  console.error(
    styleText("red", "Usage: npm run generate-changelog -- --job <jobId> [--branch <branchName>]")
  );
  process.exit(1);
}

const jobId = values.job;
const projectRoot = resolve(import.meta.dirname, "..", "..");
const jobDir = join(projectRoot, "jobs", jobId);

if (!existsSync(jobDir)) {
  console.error(styleText("red", `Error: Job folder not found at ${jobDir}`));
  process.exit(1);
}

// --- Load JOB.md ---

const jobMdPath = join(jobDir, "JOB.md");
const jobMd = await readFile(jobMdPath, "utf-8");

const pathMatch = jobMd.match(/\*\*Path\*\*:\s*(.+)/);
const branchMatch = jobMd.match(/\*\*Branch\*\*:\s*(.+)/);
const providerMatch = jobMd.match(/\*\*Provider\*\*:\s*(.+)/);
const providerName = (providerMatch?.[1]?.trim().toLowerCase() ?? "claude") as ProviderName;
const provider = createProvider(providerName);
provider.assertInstalled();

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

// --- Git helper ---

function git(...args: string[]): string {
  return execFileSync("git", args, {
    cwd: targetRepoPath,
    encoding: "utf-8",
    maxBuffer: 50 * 1024 * 1024, // 50MB for large diffs
  }).trim();
}

// --- Resolve final branch ---

let finalBranch: string;

if (values.branch) {
  finalBranch = values.branch;
} else {
  const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD");
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    `The target repo is currently on branch ${styleText("cyan", currentBranch)}. Use this as the final branch? (y/n) `
  );

  if (answer.trim().toLowerCase() === "y") {
    finalBranch = currentBranch;
  } else {
    finalBranch = (await rl.question("Enter the final branch name: ")).trim();
  }
  rl.close();
}

console.log(styleText("bold", `\n📋 Generating changelog for job "${jobId}"`));
console.log(`  Base branch:  ${styleText("cyan", baseBranch)}`);
console.log(`  Final branch: ${styleText("cyan", finalBranch)}`);
console.log(`  Target repo:  ${styleText("cyan", targetRepoPath)}`);
console.log("");

// --- Helpers ---

function parseDecision(reportContent: string): "CONTINUE" | "ROLLBACK" | null {
  const match = reportContent.match(/\*\*Decision:\s*(CONTINUE|ROLLBACK)\*\*/);
  return (match?.[1] as "CONTINUE" | "ROLLBACK") ?? null;
}

function parseAccuracy(reportContent: string): string {
  const match = reportContent.match(/\|\s*accuracy\s*\|\s*(.+?)\s*\|/);
  return match?.[1]?.trim() ?? "N/A";
}

function parseBranch(reportContent: string): string {
  const match = reportContent.match(/## Branch\n(.+)/);
  return match?.[1]?.trim() ?? "";
}

// --- Scan and validate hypotheses ---

const hypothesesDir = join(jobDir, "hypotheses");

// Validate baseline exists
const baselineReportPath = join(hypothesesDir, "000-baseline", "REPORT.md");
if (!existsSync(baselineReportPath)) {
  console.error(styleText("red", "Error: Baseline REPORT.md not found. Run the job first."));
  process.exit(1);
}

// Scan hypothesis dirs
const hypDirNames = (await readdir(hypothesesDir, { withFileTypes: true }))
  .filter((d) => d.isDirectory() && /^\d{3}-[a-f0-9]{6}$/.test(d.name))
  .map((d) => d.name)
  .sort();

if (hypDirNames.length === 0) {
  console.error(styleText("red", "Error: No hypothesis folders found. Run the job first."));
  process.exit(1);
}

// Validate all hypotheses are complete
for (const dirName of hypDirNames) {
  const reportPath = join(hypothesesDir, dirName, "REPORT.md");
  if (!existsSync(reportPath)) {
    console.error(
      styleText("red", `Error: Incomplete hypothesis — ${dirName}/REPORT.md is missing.`)
    );
    console.error("The job may still be running. Wait for it to finish before generating the changelog.");
    process.exit(1);
  }
  const content = await readFile(reportPath, "utf-8");
  if (!parseDecision(content)) {
    console.error(
      styleText("red", `Error: Incomplete hypothesis — ${dirName}/REPORT.md has no decision.`)
    );
    console.error("The job may still be running. Wait for it to finish before generating the changelog.");
    process.exit(1);
  }
}

console.log(`  Found ${hypDirNames.length} hypotheses (all complete)`);

// --- Build lightweight hypothesis metadata ---

const hypotheses: HypothesisMeta[] = [];

for (const dirName of hypDirNames) {
  const reportPath = join(hypothesesDir, dirName, "REPORT.md");
  const report = await readFile(reportPath, "utf-8");
  const decision = parseDecision(report)!;
  const accuracy = parseAccuracy(report);
  const branch = parseBranch(report) || `${jobId}-hyp-${dirName}`;

  hypotheses.push({ id: dirName, branch, decision, accuracy });
}

// --- Build prompt and invoke agent ---
// The agent will read the actual files and compute diffs itself

const changelogPath = join(jobDir, "CHANGELOG.md");

const systemPrompt = getChangelogSystemPrompt({
  jobId,
  baseBranch,
  finalBranch,
  targetRepoPath,
  jobMdPath,
  memoryMdPath: join(jobDir, "MEMORY.md"),
  hypothesesDir,
  hypotheses,
  changelogPath,
});

const userPrompt = `Generate the CHANGELOG.md for job "${jobId}". Write it to ${changelogPath}. Be concise — the reader will refer to individual REPORT.md files for details.`;

console.log(`${styleText("bold", `  Generating changelog with ${providerName}...`)}\n`);

const exitCode = await provider.run({
  systemPrompt,
  userPrompt,
  cwd: targetRepoPath,
  addDir: jobDir,
});

await provider.cleanup?.();

if (exitCode !== 0) {
  console.error(styleText("red", `\n${providerName} exited with code ${exitCode}.`));
  process.exit(1);
}

if (!existsSync(changelogPath)) {
  console.error(styleText("red", `\nCHANGELOG.md was not created at ${changelogPath}.`));
  process.exit(1);
}

console.log(`\n${styleText("green", "✓")} Changelog generated at ${styleText("cyan", changelogPath)}`);
