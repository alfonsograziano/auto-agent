import { execFileSync } from "node:child_process";
import { readFile, writeFile, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentProvider } from "../../utils/providers/types.ts";
import type { BenchmarkAdapter, BenchmarkTask, TaskResult } from "../types.ts";

/**
 * AppWorld benchmark adapter.
 *
 * Repo: https://github.com/StonyBrookNLP/appworld
 * 750 tasks across 9 simulated apps (Amazon, Spotify, Venmo, etc.) with 457 APIs.
 * Tasks require chaining multiple app APIs, complex control flow, and iterative interaction.
 * Eval checks task completion via state-based unit tests + collateral damage detection.
 *
 * Install: pip install appworld && appworld install
 */

const APPWORLD_DIR_ENV = "APPWORLD_DIR";
const DEFAULT_APPWORLD_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "benchmarks",
  "appworld"
);

interface AppWorldTask {
  task_id: string;
  description: string;
  difficulty: string;
  required_apps: string[];
}

function getAppWorldDir(): string {
  return process.env[APPWORLD_DIR_ENV] || DEFAULT_APPWORLD_DIR;
}

export class AppWorldAdapter implements BenchmarkAdapter {
  readonly name = "appworld";
  readonly description = "750 workflow tasks across 9 simulated apps";
  readonly taskCount = 750;
  readonly category = "workflow" as const;

  async assertReady(): Promise<void> {
    // Check appworld CLI
    try {
      execFileSync("appworld", ["--version"], { stdio: "pipe", encoding: "utf-8" });
    } catch {
      // Check if Python module is importable
      try {
        execFileSync("python3", ["-c", "import appworld"], {
          stdio: "pipe",
          encoding: "utf-8",
        });
      } catch {
        throw new Error(
          "AppWorld is not installed. Install via: pip install appworld && appworld install"
        );
      }
    }
  }

  async loadTasks(filter?: string[]): Promise<BenchmarkTask[]> {
    let taskList: AppWorldTask[] = [];

    // Try loading task list via CLI
    try {
      const output = execFileSync(
        "appworld",
        ["tasks", "list", "--json"],
        { stdio: "pipe", encoding: "utf-8" }
      );
      taskList = JSON.parse(output);
    } catch {
      // Fall back to loading from data directory
      taskList = await this.loadTasksFromData();
    }

    const tasks: BenchmarkTask[] = [];
    for (const t of taskList) {
      if (filter && !filter.some((f) => t.task_id.includes(f))) continue;

      tasks.push({
        id: t.task_id,
        prompt: t.description,
        cwd: getAppWorldDir(),
        meta: {
          difficulty: t.difficulty,
          requiredApps: t.required_apps,
        },
      });
    }

    return tasks;
  }

  async runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult> {
    const start = Date.now();

    // AppWorld provides a Python API for task execution. The flow is:
    // 1. Initialize a task environment (resets app state)
    // 2. Agent interacts with APIs to complete the task
    // 3. Evaluate via appworld's built-in test suite

    const systemPrompt =
      `You are completing a task that involves interacting with multiple web applications ` +
      `(like Amazon, Spotify, Venmo, Gmail, etc.) through their APIs. ` +
      `Use the available API tools to complete the task. ` +
      `Be thorough — check your work by verifying the state after making changes. ` +
      `Write your solution as a Python script that uses the appworld API client.`;

    // Create a workspace for this task
    const workDir = join(getAppWorldDir(), ".workspaces", task.id);
    await mkdir(workDir, { recursive: true });

    try {
      // Initialize the task environment
      this.initTaskEnv(task.id);

      // Write task context for the agent
      const contextPath = join(workDir, "task.md");
      await writeFile(
        contextPath,
        `# Task: ${task.id}\n\n${task.prompt}\n\n` +
          `## Available Apps\n${(task.meta?.requiredApps as string[] || []).join(", ")}\n\n` +
          `## Instructions\nWrite and execute a Python script that completes this task ` +
          `using the appworld API client. The script should be saved as solution.py.`,
        "utf-8"
      );

      const exitCode = await provider.run({
        systemPrompt,
        userPrompt: task.prompt,
        cwd: workDir,
        addDir: workDir,
      });

      // Evaluate the task
      const evalResult = this.evaluateTask(task.id);

      return {
        taskId: task.id,
        passed: evalResult.passed,
        score: evalResult.score,
        durationMs: Date.now() - start,
        meta: {
          collateralDamage: evalResult.collateralDamage,
          exitCode,
        },
      };
    } catch (err) {
      return {
        taskId: task.id,
        passed: false,
        durationMs: Date.now() - start,
        error: err instanceof Error ? err.message : String(err),
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private initTaskEnv(taskId: string): void {
    try {
      execFileSync("appworld", ["tasks", "init", taskId], {
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 60_000,
      });
    } catch {
      // Try Python API fallback
      execFileSync(
        "python3",
        ["-c", `from appworld import AppWorld; AppWorld.init_task("${taskId}")`],
        { stdio: "pipe", encoding: "utf-8", timeout: 60_000 }
      );
    }
  }

  private evaluateTask(
    taskId: string
  ): { passed: boolean; score?: number; collateralDamage?: boolean } {
    try {
      const output = execFileSync(
        "appworld",
        ["tasks", "evaluate", taskId, "--json"],
        { stdio: "pipe", encoding: "utf-8", timeout: 120_000 }
      );
      const result = JSON.parse(output);
      return {
        passed: result.passed === true || result.success === true,
        score: result.score,
        collateralDamage: result.collateral_damage === true,
      };
    } catch {
      // Python fallback
      try {
        const output = execFileSync(
          "python3",
          [
            "-c",
            `import json; from appworld import AppWorld; ` +
              `r = AppWorld.evaluate_task("${taskId}"); ` +
              `print(json.dumps({"passed": r.passed, "score": r.score}))`,
          ],
          { stdio: "pipe", encoding: "utf-8", timeout: 120_000 }
        );
        return JSON.parse(output);
      } catch {
        return { passed: false };
      }
    }
  }

  private async loadTasksFromData(): Promise<AppWorldTask[]> {
    const dir = getAppWorldDir();
    const candidates = [
      join(dir, "data", "tasks.jsonl"),
      join(dir, "tasks.jsonl"),
      join(dir, "data", "tasks.json"),
    ];

    for (const path of candidates) {
      if (!existsSync(path)) continue;
      const content = await readFile(path, "utf-8");

      if (path.endsWith(".jsonl")) {
        return content
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      }
      return JSON.parse(content);
    }

    return [];
  }
}
