import { execFileSync, spawn } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentProvider } from "../../utils/providers/types.ts";
import type { BenchmarkAdapter, BenchmarkTask, TaskResult } from "../types.ts";

/**
 * Terminal-Bench 2.0 adapter.
 *
 * Repo: https://github.com/laude-institute/terminal-bench
 * 89 hard, realistic terminal/sysadmin tasks. Each task has a containerized
 * environment, automated tests, and a reference solution.
 *
 * The benchmark natively supports running agents via `tb run`.
 * This adapter wraps `tb` for provider-agnostic execution.
 */

const BENCHMARK_DIR_ENV = "TERMINAL_BENCH_DIR";
const DEFAULT_BENCHMARK_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "benchmarks",
  "terminal-bench"
);

interface TerminalBenchTask {
  id: string;
  name: string;
  description: string;
  category: string;
  difficulty: string;
}

function getBenchmarkDir(): string {
  return process.env[BENCHMARK_DIR_ENV] || DEFAULT_BENCHMARK_DIR;
}

export class TerminalBenchAdapter implements BenchmarkAdapter {
  readonly name = "terminal-bench";
  readonly description = "89 realistic CLI/sysadmin tasks in containers";
  readonly taskCount = 89;
  readonly category = "cli" as const;

  async assertReady(): Promise<void> {
    // Check for tb CLI
    try {
      execFileSync("tb", ["--version"], { stdio: "pipe", encoding: "utf-8" });
    } catch {
      // Fall back to checking for the repo
      const dir = getBenchmarkDir();
      if (!existsSync(dir)) {
        throw new Error(
          `Terminal-Bench not found. Install via: pip install terminal-bench ` +
            `or clone https://github.com/laude-institute/terminal-bench to ${dir}. ` +
            `Set ${BENCHMARK_DIR_ENV} to override the path.`
        );
      }
    }

    // Check Docker is available (tasks run in containers)
    try {
      execFileSync("docker", ["info"], { stdio: "pipe", encoding: "utf-8" });
    } catch {
      throw new Error(
        "Docker is required for Terminal-Bench but was not found or is not running."
      );
    }
  }

  async loadTasks(filter?: string[]): Promise<BenchmarkTask[]> {
    const tasks: BenchmarkTask[] = [];

    // Try loading from tb CLI first
    let taskList: TerminalBenchTask[] = [];
    try {
      const output = execFileSync("tb", ["list", "--json"], {
        stdio: "pipe",
        encoding: "utf-8",
      });
      taskList = JSON.parse(output);
    } catch {
      // Fall back to reading task definitions from repo
      taskList = await this.loadTasksFromRepo();
    }

    for (const t of taskList) {
      if (filter && !filter.some((f) => t.id.includes(f))) continue;

      tasks.push({
        id: t.id,
        prompt: t.description,
        cwd: getBenchmarkDir(),
        meta: {
          category: t.category,
          difficulty: t.difficulty,
          taskName: t.name,
        },
      });
    }

    return tasks;
  }

  async runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult> {
    const start = Date.now();

    // Terminal-Bench tasks run inside Docker containers.
    // We use `tb run` which:
    //   1. Starts the container for this task
    //   2. Provides the agent with shell access
    //   3. Runs validation tests after the agent is done
    //
    // For provider integration, we use `tb run --agent-cmd` to specify
    // how to invoke the agent.

    const systemPrompt =
      `You are a skilled systems administrator and DevOps engineer. ` +
      `You have shell access to a Linux container. Complete the given task ` +
      `by running commands in the terminal. Be precise and efficient.`;

    try {
      // Strategy: start the task container, run the agent inside it, then validate
      const containerId = this.startTaskContainer(task.id);

      try {
        // Run agent with the container as the working environment
        const exitCode = await provider.run({
          systemPrompt,
          userPrompt:
            `Complete this terminal task:\n\n${task.prompt}\n\n` +
            `You are working inside a Docker container (${containerId}). ` +
            `Use bash commands to complete the task.`,
          cwd: task.cwd,
          addDir: task.cwd,
        });

        // Validate the result
        const passed = this.validateTask(task.id, containerId);

        return {
          taskId: task.id,
          passed,
          durationMs: Date.now() - start,
          meta: { exitCode },
        };
      } finally {
        // Clean up container
        this.stopContainer(containerId);
      }
    } catch (err) {
      // Fall back to using `tb run` directly if available
      try {
        const result = this.runViaTbCli(task.id, provider.name);
        return {
          taskId: task.id,
          passed: result,
          durationMs: Date.now() - start,
        };
      } catch {
        return {
          taskId: task.id,
          passed: false,
          durationMs: Date.now() - start,
          error: err instanceof Error ? err.message : String(err),
        };
      }
    }
  }

  private startTaskContainer(taskId: string): string {
    const output = execFileSync(
      "tb",
      ["start", taskId, "--json"],
      { stdio: "pipe", encoding: "utf-8", timeout: 120_000 }
    );
    const parsed = JSON.parse(output);
    return parsed.container_id || parsed.containerId || "unknown";
  }

  private validateTask(taskId: string, containerId: string): boolean {
    try {
      const output = execFileSync(
        "tb",
        ["validate", taskId, "--container", containerId, "--json"],
        { stdio: "pipe", encoding: "utf-8", timeout: 60_000 }
      );
      const parsed = JSON.parse(output);
      return parsed.passed === true || parsed.status === "passed";
    } catch {
      return false;
    }
  }

  private stopContainer(containerId: string): void {
    try {
      execFileSync("docker", ["rm", "-f", containerId], {
        stdio: "pipe",
        timeout: 30_000,
      });
    } catch {
      // Best effort
    }
  }

  private runViaTbCli(taskId: string, providerName: string): boolean {
    const output = execFileSync(
      "tb",
      ["run", taskId, "--agent", providerName, "--json"],
      { stdio: "pipe", encoding: "utf-8", timeout: 300_000 }
    );
    const parsed = JSON.parse(output);
    return parsed.passed === true || parsed.status === "passed";
  }

  private async loadTasksFromRepo(): Promise<TerminalBenchTask[]> {
    const dir = getBenchmarkDir();
    const tasksDir = join(dir, "tasks");
    if (!existsSync(tasksDir)) return [];

    const tasks: TerminalBenchTask[] = [];
    const entries = await readdir(tasksDir, { withFileTypes: true });

    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const configPath = join(tasksDir, entry.name, "task.json");
      if (!existsSync(configPath)) continue;

      const config = JSON.parse(await readFile(configPath, "utf-8"));
      tasks.push({
        id: config.id || entry.name,
        name: config.name || entry.name,
        description: config.description || "",
        category: config.category || "general",
        difficulty: config.difficulty || "medium",
      });
    }

    return tasks;
  }
}
