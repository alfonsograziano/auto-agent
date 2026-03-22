import { copyFile } from "node:fs/promises";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { styleText } from "node:util";
import { createHypothesis } from "../utils/create-hypothesis.ts";
import { getBaselineSystemPrompt } from "../utils/prompts.ts";
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

  console.log(`Checking out base branch ${styleText("cyan", `"${baseBranch}"`)} in target repo...`);
  const currentBranch = git("rev-parse", "--abbrev-ref", "HEAD");
  if (currentBranch !== baseBranch) {
    git("checkout", baseBranch);
  }
  console.log(`On branch: ${styleText("cyan", git("rev-parse", "--abbrev-ref", "HEAD"))}`);

  console.log(`Switching to branch ${styleText("cyan", `"${baselineBranch}"`)}...`);
  try {
    git("checkout", "-b", baselineBranch);
  } catch {
    git("checkout", baselineBranch);
  }
  console.log(`On branch: ${styleText("cyan", git("rev-parse", "--abbrev-ref", "HEAD"))}`);

  const hypothesis = await createHypothesis({
    jobDir,
    id: "000-baseline",
    statement:
      "Baseline evaluation — run evals on the current state of the target agent without any changes.",
    branchName: baselineBranch,
  });

  const reportTemplatePath = join(projectRoot, "templates", "REPORT-TEMPLATE.md");
  await copyFile(reportTemplatePath, join(hypothesis.dir, "REPORT.md"));

  console.log(`Created baseline hypothesis: ${styleText("cyan", hypothesis.dir)}`);
  console.log(styleText("bold", "Spawning Claude Code to run baseline evals..."));
  console.log();

  const systemPrompt = getBaselineSystemPrompt({
    targetRepoPath,
    baselineBranch,
    hypothesisDir: hypothesis.dir,
    jobMd,
  });

  const userPrompt = `Run the baseline evals for job "${jobId}" and write the report.`;

  const exitCode = await runClaude(
    systemPrompt,
    userPrompt,
    targetRepoPath,
    jobDir
  );

  if (exitCode !== 0) {
    console.error(styleText("red", `Claude Code exited with code ${exitCode}`));
    process.exit(exitCode);
  }

  console.log();
  console.log(styleText("green", "Baseline evals completed."));
  console.log(`Report: ${styleText("cyan", `${hypothesis.dir}/REPORT.md`)}`);
}
