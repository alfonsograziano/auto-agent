import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { createHypothesis } from "../utils/create-hypothesis.ts";
import { runClaude } from "../utils/run-claude.ts";

interface RunBaselineOptions {
  jobId: string;
  jobDir: string;
  jobMd: string;
  targetRepoPath: string;
  baseBranch: string;
  projectRoot: string;
}

export async function runBaselineEvals(options: RunBaselineOptions) {
  const { jobId, jobDir, jobMd, targetRepoPath, baseBranch, projectRoot } =
    options;

  const baselineBranch = `${jobId}-baseline`;

  function git(...args: string[]): string {
    return execFileSync("git", args, {
      cwd: targetRepoPath,
      encoding: "utf-8",
    }).trim();
  }

  console.log(`Checking out base branch "${baseBranch}" in target repo...`);
  const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (currentBranch !== baseBranch) {
    git("checkout", baseBranch);
  }
  console.log(`On branch: ${git("rev-parse", "--abbrev-ref", "HEAD")}`);

  console.log(`Switching to branch "${baselineBranch}"...`);
  try {
    git("checkout", "-b", baselineBranch);
  } catch {
    git("checkout", baselineBranch);
  }
  console.log(`On branch: ${git("rev-parse", "--abbrev-ref", "HEAD")}`);

  const hypothesis = await createHypothesis({
    jobDir,
    id: "000-baseline",
    statement:
      "Baseline evaluation — run evals on the current state of the target agent without any changes.",
    branchName: baselineBranch,
  });

  const reportTemplatePath = join(projectRoot, "templates", "REPORT-TEMPLATE.md");
  await copyFile(reportTemplatePath, join(hypothesis.dir, "REPORT.md"));

  console.log(`Created baseline hypothesis: ${hypothesis.dir}`);
  console.log(`Spawning Claude Code to run baseline evals...`);
  console.log();

  const systemPrompt = `You are an evaluation runner. You run evals on a target repository and update a structured report.

## Context
- Target repository: ${targetRepoPath} (branch: "${baselineBranch}")
- Report file: ${hypothesis.dir}/REPORT.md (already exists from template — update it in place)

## Workflow
Read the job configuration below, run any install/build prerequisites, execute the eval command, then update the report file.

## Rules
1. The system shall not modify any files in the target repository (source code, eval files, golden dataset). This is a read-only baseline run.
2. When a command fails, the system shall capture the error output and include it in the report instead of retrying or attempting fixes.
3. When documenting failing cases, the system shall include the case id, input, expected output, and actual output for every failure.
4. The system shall update the existing REPORT.md file at ${hypothesis.dir}/REPORT.md. The file already contains the template structure — fill in every section, replacing placeholder values with actual data.

## Report Instructions
The report at ${hypothesis.dir}/REPORT.md already has the correct structure. Fill in each section:
- **Hypothesis ID**: Use "000-baseline"
- **Branch**: Use "${baselineBranch}"
- **Hypothesis Statement**: "Baseline evaluation — run evals on the current state of the target agent without any changes."
- **Changes Made**: No changes (this is a baseline run). Write "No changes — baseline evaluation."
- **Metrics**: Fill in all metric values from the eval output. Use "N/A" if a metric is unavailable.
- **Failing Cases**: One subsection per failing case with id, input, expected output, and actual output. If none, write "No failing cases."
- **Summary**: What works, what fails, patterns in failures.
- **Recommendation**: For baseline, always write "Baseline run — no recommendation applicable." and set **Decision: CONTINUE**

VERIFY before finishing:
1. No files in the target repo were created, modified, or deleted.
2. Every failing case is listed with id, input, expected output, and actual output.
3. All metric fields are filled (use "N/A" if a metric is unavailable).
4. The REPORT.md file at the exact path above has been updated with all sections filled in.

## Job Configuration
${jobMd}`;

  const userPrompt = `Run the baseline evals for job "${jobId}" and write the report.`;

  const exitCode = await runClaude(
    systemPrompt,
    userPrompt,
    targetRepoPath,
    jobDir
  );

  if (exitCode !== 0) {
    console.error(`Claude Code exited with code ${exitCode}`);
    process.exit(exitCode);
  }

  console.log();
  console.log("Baseline evals completed.");
  console.log(`Report: ${hypothesis.dir}/REPORT.md`);
}
