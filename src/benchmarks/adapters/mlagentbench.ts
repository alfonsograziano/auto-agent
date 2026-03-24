import { execFileSync } from "node:child_process";
import { readFile, readdir, cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentProvider } from "../../utils/providers/types.ts";
import type { BenchmarkAdapter, BenchmarkTask, TaskResult } from "../types.ts";

/**
 * MLAgentBench adapter.
 *
 * Repo: https://github.com/snap-stanford/MLAgentBench
 * End-to-end ML experimentation tasks. Agent gets a dataset + task description,
 * must autonomously develop/improve an ML model.
 *
 * Already uses the "target directory + eval script" pattern natively:
 *   benchmarks/<name>/env/    — working directory with data and starter code
 *   benchmarks/<name>/scripts/eval.py — evaluation script
 */

const BENCHMARK_DIR_ENV = "MLAGENTBENCH_DIR";
const DEFAULT_BENCHMARK_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "benchmarks",
  "MLAgentBench"
);

interface MLTask {
  id: string;
  name: string;
  description: string;
  envDir: string;
  evalScript: string;
  metric: string;
}

function getBenchmarkDir(): string {
  return process.env[BENCHMARK_DIR_ENV] || DEFAULT_BENCHMARK_DIR;
}

export class MLAgentBenchAdapter implements BenchmarkAdapter {
  readonly name = "mlagentbench";
  readonly description = "End-to-end ML experimentation tasks";
  readonly taskCount = 13;
  readonly category = "ml" as const;

  async assertReady(): Promise<void> {
    const dir = getBenchmarkDir();
    if (!existsSync(dir)) {
      throw new Error(
        `MLAgentBench not found at ${dir}. ` +
          `Clone it: git clone https://github.com/snap-stanford/MLAgentBench ${dir} ` +
          `or set ${BENCHMARK_DIR_ENV} env var.`
      );
    }

    const benchmarksDir = join(dir, "benchmarks");
    if (!existsSync(benchmarksDir)) {
      throw new Error(
        `No benchmarks directory found at ${benchmarksDir}. ` +
          `Ensure the repo is properly cloned.`
      );
    }

    // Check Python is available (needed for eval scripts)
    try {
      execFileSync("python3", ["--version"], { stdio: "pipe" });
    } catch {
      throw new Error("Python 3 is required for MLAgentBench evaluation scripts.");
    }
  }

  async loadTasks(filter?: string[]): Promise<BenchmarkTask[]> {
    const dir = getBenchmarkDir();
    const benchmarksDir = join(dir, "benchmarks");
    const tasks: BenchmarkTask[] = [];

    const entries = await readdir(benchmarksDir, { withFileTypes: true });
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;

      const taskId = entry.name;
      if (filter && !filter.some((f) => taskId.includes(f))) continue;

      const envDir = join(benchmarksDir, taskId, "env");
      const evalScript = join(benchmarksDir, taskId, "scripts", "eval.py");

      if (!existsSync(envDir)) continue;

      // Read task description
      let description = `Complete the ML task: ${taskId}`;
      const readmePath = join(benchmarksDir, taskId, "env", "README.md");
      const descPath = join(benchmarksDir, taskId, "description.txt");

      if (existsSync(readmePath)) {
        description = await readFile(readmePath, "utf-8");
      } else if (existsSync(descPath)) {
        description = await readFile(descPath, "utf-8");
      }

      tasks.push({
        id: taskId,
        prompt: description,
        cwd: envDir,
        meta: {
          envDir,
          evalScript: existsSync(evalScript) ? evalScript : undefined,
          benchmarkRoot: dir,
        },
      });
    }

    return tasks.sort((a, b) => a.id.localeCompare(b.id));
  }

  async runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult> {
    const start = Date.now();
    const envDir = task.meta?.envDir as string;
    const evalScript = task.meta?.evalScript as string | undefined;

    // Work in a temp copy to avoid polluting the original
    const workDir = join(
      getBenchmarkDir(),
      ".workspaces",
      `${task.id}-${randomBytes(3).toString("hex")}`
    );
    await mkdir(workDir, { recursive: true });
    await cp(envDir, workDir, { recursive: true });

    try {
      const systemPrompt =
        `You are an ML researcher working on an experimentation task. ` +
        `You have a dataset and starter code in the current directory. ` +
        `Your goal is to develop or improve an ML model to maximize the evaluation metric. ` +
        `Read the README or task description carefully, understand the data, ` +
        `implement your approach, train the model, and ensure your submission file is generated. ` +
        `Do NOT modify the evaluation script. Focus on model improvements.`;

      const exitCode = await provider.run({
        systemPrompt,
        userPrompt: task.prompt,
        cwd: workDir,
        addDir: workDir,
      });

      // Run evaluation
      let passed = false;
      let score: number | undefined;

      if (evalScript && existsSync(evalScript)) {
        try {
          const evalOutput = execFileSync(
            "python3",
            [evalScript, workDir],
            {
              cwd: workDir,
              stdio: "pipe",
              encoding: "utf-8",
              timeout: 300_000,
            }
          );

          // Parse eval output — MLAgentBench eval scripts typically output JSON
          // with a "score" or "metric" field
          try {
            const evalResult = JSON.parse(evalOutput.trim());
            score = evalResult.score ?? evalResult.metric ?? evalResult.accuracy;
            passed = score !== undefined && score > 0;
          } catch {
            // Try to extract a number from the output
            const numMatch = evalOutput.match(/[\d.]+/);
            if (numMatch) {
              score = parseFloat(numMatch[0]);
              passed = score > 0;
            }
          }
        } catch (err: any) {
          return {
            taskId: task.id,
            passed: false,
            durationMs: Date.now() - start,
            error: `Eval script failed: ${err.stderr || err.message}`,
          };
        }
      } else {
        // No eval script — check if a submission file was created
        const submissionCandidates = ["submission.csv", "submission.json", "predictions.csv"];
        passed = submissionCandidates.some((f) => existsSync(join(workDir, f)));
      }

      return {
        taskId: task.id,
        passed,
        score,
        durationMs: Date.now() - start,
        meta: { exitCode },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
