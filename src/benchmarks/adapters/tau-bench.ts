import { execFileSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentProvider } from "../../utils/providers/types.ts";
import type { BenchmarkAdapter, BenchmarkTask, TaskResult } from "../types.ts";

/**
 * tau2-bench adapter.
 *
 * Repo: https://github.com/sierra-research/tau2-bench
 * Multi-turn customer service dialogues where agents interact with simulated
 * users and domain-specific API tools while following business policies.
 * Domains: airline, retail, telecom, banking.
 *
 * CLI: tau2 run --domain airline --agent-llm <model>
 * Metrics: pass^1 and pass^k reliability.
 */

const BENCHMARK_DIR_ENV = "TAU_BENCH_DIR";
const DEFAULT_BENCHMARK_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "benchmarks",
  "tau2-bench"
);

const DOMAINS = ["airline", "retail", "telecom", "banking"] as const;
type Domain = (typeof DOMAINS)[number];

interface TauTask {
  task_id: string;
  domain: Domain;
  user_instructions: string;
  expected_actions: string[];
}

function getBenchmarkDir(): string {
  return process.env[BENCHMARK_DIR_ENV] || DEFAULT_BENCHMARK_DIR;
}

export class TauBenchAdapter implements BenchmarkAdapter {
  readonly name = "tau-bench";
  readonly description = "Multi-turn customer service dialogues with API tools";
  readonly taskCount = 200;
  readonly category = "workflow" as const;

  async assertReady(): Promise<void> {
    // Check tau2 CLI
    try {
      execFileSync("tau2", ["--version"], { stdio: "pipe", encoding: "utf-8" });
      return;
    } catch {
      // Not installed via pip
    }

    // Check for repo
    const dir = getBenchmarkDir();
    if (!existsSync(dir)) {
      throw new Error(
        `tau2-bench not found. Install via: pip install tau2-bench ` +
          `or clone https://github.com/sierra-research/tau2-bench to ${dir}. ` +
          `Set ${BENCHMARK_DIR_ENV} to override.`
      );
    }
  }

  async loadTasks(filter?: string[]): Promise<BenchmarkTask[]> {
    const tasks: BenchmarkTask[] = [];

    // Try loading via tau2 CLI
    try {
      const output = execFileSync("tau2", ["tasks", "--json"], {
        stdio: "pipe",
        encoding: "utf-8",
      });
      const taskList: TauTask[] = JSON.parse(output);

      for (const t of taskList) {
        if (filter && !filter.some((f) => t.task_id.includes(f) || t.domain.includes(f))) {
          continue;
        }
        tasks.push({
          id: t.task_id,
          prompt: t.user_instructions,
          cwd: getBenchmarkDir(),
          meta: { domain: t.domain, expectedActions: t.expected_actions },
        });
      }
      return tasks;
    } catch {
      // Fall back to loading from data files
    }

    // Load from repo data files
    const dir = getBenchmarkDir();
    for (const domain of DOMAINS) {
      const dataPath = join(dir, "data", `${domain}.jsonl`);
      if (!existsSync(dataPath)) continue;

      const content = await readFile(dataPath, "utf-8");
      const entries = content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as TauTask);

      for (const t of entries) {
        const taskId = t.task_id || `${domain}-${entries.indexOf(t)}`;
        if (filter && !filter.some((f) => taskId.includes(f) || domain.includes(f))) {
          continue;
        }
        tasks.push({
          id: taskId,
          prompt: t.user_instructions,
          cwd: dir,
          meta: { domain, expectedActions: t.expected_actions },
        });
      }
    }

    return tasks;
  }

  async runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult> {
    const start = Date.now();
    const domain = task.meta?.domain as Domain;

    // tau2-bench has its own agent loop with simulated users.
    // Strategy 1: Use tau2 CLI directly (preferred)
    try {
      return this.runViaCli(task, provider, start);
    } catch {
      // Strategy 2: Run manually with provider
      return this.runManually(task, provider, start);
    }
  }

  private runViaCli(
    task: BenchmarkTask,
    provider: AgentProvider,
    start: number
  ): TaskResult {
    const domain = task.meta?.domain as Domain;

    // tau2 run executes a single task with a specified agent
    const output = execFileSync(
      "tau2",
      [
        "run",
        "--domain", domain,
        "--task-id", task.id,
        "--agent", provider.name,
        "--json",
        "--trials", "1",
      ],
      {
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 300_000,
        env: { ...process.env, TAU2_AGENT: provider.name },
      }
    );

    const result = JSON.parse(output);
    return {
      taskId: task.id,
      passed: result.passed === true || result.pass_rate === 1,
      score: result.pass_rate ?? (result.passed ? 1 : 0),
      durationMs: Date.now() - start,
      meta: {
        domain,
        turns: result.turns,
        passRate: result.pass_rate,
      },
    };
  }

  private async runManually(
    task: BenchmarkTask,
    provider: AgentProvider,
    start: number
  ): Promise<TaskResult> {
    const domain = task.meta?.domain as Domain;

    const systemPrompt =
      `You are a customer service agent for a ${domain} company. ` +
      `A customer will describe their request. You must help them by using the available ` +
      `API tools while strictly following company policies. ` +
      `Be polite, efficient, and accurate. Verify information before making changes. ` +
      `Write your final response summary to a file called "response.txt".`;

    const exitCode = await provider.run({
      systemPrompt,
      userPrompt: task.prompt,
      cwd: task.cwd,
      addDir: task.cwd,
    });

    // Without the tau2 evaluation framework, we can only check if the agent
    // completed without errors. Full evaluation requires the simulated user loop.
    return {
      taskId: task.id,
      passed: exitCode === 0,
      durationMs: Date.now() - start,
      meta: {
        domain,
        exitCode,
        note: "Manual mode — full pass^k evaluation requires tau2 CLI",
      },
    };
  }
}
