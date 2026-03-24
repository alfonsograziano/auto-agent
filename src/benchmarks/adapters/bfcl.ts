import { execFileSync } from "node:child_process";
import { readFile, readdir, mkdir, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentProvider } from "../../utils/providers/types.ts";
import type { BenchmarkAdapter, BenchmarkTask, TaskResult } from "../types.ts";

/**
 * Berkeley Function Calling Leaderboard (BFCL) V4 adapter.
 *
 * Repo: https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard
 * Tests function/API calling accuracy across serial, parallel, and multi-turn
 * scenarios. AST-based evaluation. Supports agentic web search and multi-hop reasoning.
 *
 * Install: pip install bfcl-eval
 */

const BENCHMARK_DIR_ENV = "BFCL_DIR";
const DEFAULT_BENCHMARK_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "benchmarks",
  "bfcl"
);

interface BfclTask {
  id: string;
  category: string;
  question: string;
  function_definitions: object[];
  expected_calls: object[];
}

function getBenchmarkDir(): string {
  return process.env[BENCHMARK_DIR_ENV] || DEFAULT_BENCHMARK_DIR;
}

export class BfclAdapter implements BenchmarkAdapter {
  readonly name = "bfcl";
  readonly description = "Function calling accuracy across serial/parallel/multi-turn scenarios";
  readonly taskCount = 2000;
  readonly category = "tool-use" as const;

  async assertReady(): Promise<void> {
    // Check bfcl-eval pip package
    try {
      execFileSync("python3", ["-c", "import bfcl"], {
        stdio: "pipe",
        encoding: "utf-8",
      });
      return;
    } catch {
      // Not installed
    }

    // Check for repo
    const dir = getBenchmarkDir();
    if (!existsSync(dir)) {
      throw new Error(
        `BFCL not found. Install via: pip install bfcl-eval ` +
          `or clone https://github.com/ShishirPatil/gorilla to ${dir}. ` +
          `Set ${BENCHMARK_DIR_ENV} to override.`
      );
    }
  }

  async loadTasks(filter?: string[]): Promise<BenchmarkTask[]> {
    const tasks: BenchmarkTask[] = [];

    // Try loading via bfcl Python module
    try {
      const output = execFileSync(
        "python3",
        [
          "-c",
          `import json, bfcl; data = bfcl.load_dataset(); ` +
            `print(json.dumps([{"id": d["id"], "category": d.get("category",""), ` +
            `"question": d["question"], "function_definitions": d.get("function",[])} ` +
            `for d in data]))`,
        ],
        { stdio: "pipe", encoding: "utf-8", timeout: 30_000 }
      );
      const taskList = JSON.parse(output);

      for (const t of taskList) {
        if (filter && !filter.some((f) => t.id.includes(f) || t.category.includes(f))) {
          continue;
        }
        tasks.push({
          id: t.id,
          prompt: typeof t.question === "string" ? t.question : JSON.stringify(t.question),
          cwd: getBenchmarkDir(),
          meta: {
            category: t.category,
            functionDefinitions: t.function_definitions,
          },
        });
      }
      return tasks;
    } catch {
      // Fall back to loading from data files
    }

    // Load from repo data files
    const dir = getBenchmarkDir();
    const dataDir = join(dir, "berkeley-function-call-leaderboard", "data");
    const altDataDir = join(dir, "data");
    const searchDir = existsSync(dataDir) ? dataDir : existsSync(altDataDir) ? altDataDir : null;

    if (!searchDir) return tasks;

    const files = await readdir(searchDir).catch(() => [] as string[]);

    for (const file of files) {
      if (!file.endsWith(".json") && !file.endsWith(".jsonl")) continue;

      const content = await readFile(join(searchDir, file), "utf-8");
      let entries: any[];

      if (file.endsWith(".jsonl")) {
        entries = content
          .split("\n")
          .filter(Boolean)
          .map((line) => JSON.parse(line));
      } else {
        const parsed = JSON.parse(content);
        entries = Array.isArray(parsed) ? parsed : [parsed];
      }

      for (const entry of entries) {
        const taskId = entry.id || `${file}-${entries.indexOf(entry)}`;
        if (filter && !filter.some((f) => taskId.includes(f))) continue;

        tasks.push({
          id: taskId,
          prompt: typeof entry.question === "string" ? entry.question : JSON.stringify(entry.question),
          cwd: getBenchmarkDir(),
          meta: {
            category: entry.category || file.replace(/\.(json|jsonl)$/, ""),
            functionDefinitions: entry.function || entry.function_definitions || [],
            expectedCalls: entry.expected_calls || entry.ground_truth || [],
          },
        });
      }
    }

    return tasks;
  }

  async runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult> {
    const start = Date.now();
    const functionDefs = task.meta?.functionDefinitions as object[];
    const expectedCalls = task.meta?.expectedCalls as object[] | undefined;

    // Create a workspace for the agent to write its function call output
    const workDir = join(getBenchmarkDir(), ".workspaces", task.id.replace(/[^a-zA-Z0-9-_]/g, "_"));
    await mkdir(workDir, { recursive: true });

    try {
      // Present function definitions and ask agent to produce the correct call(s)
      const functionDefsStr = JSON.stringify(functionDefs, null, 2);
      const answerPath = join(workDir, "answer.json");

      const systemPrompt =
        `You are a function-calling assistant. Given a user question and a set of available functions, ` +
        `determine which function(s) to call and with what arguments. ` +
        `Write your answer as a JSON array of function calls to: ${answerPath}\n` +
        `Each call should be: {"name": "function_name", "arguments": {...}}\n\n` +
        `Available functions:\n${functionDefsStr}`;

      await provider.run({
        systemPrompt,
        userPrompt: task.prompt,
        cwd: workDir,
        addDir: workDir,
      });

      // Read agent's answer
      let passed = false;
      let agentCalls: object[] = [];

      if (existsSync(answerPath)) {
        try {
          const answerContent = await readFile(answerPath, "utf-8");
          agentCalls = JSON.parse(answerContent);

          // If we have expected calls, compare via AST matching
          if (expectedCalls && expectedCalls.length > 0) {
            passed = this.compareCalls(agentCalls, expectedCalls);
          } else {
            // Try using bfcl-eval for evaluation
            passed = this.evaluateViaBfcl(task.id, agentCalls);
          }
        } catch {
          passed = false;
        }
      }

      return {
        taskId: task.id,
        passed,
        durationMs: Date.now() - start,
        meta: {
          category: task.meta?.category,
          agentCalls,
        },
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  /** Simple structural comparison of function calls. */
  private compareCalls(actual: object[], expected: object[]): boolean {
    if (actual.length !== expected.length) return false;

    const normalize = (obj: any): string =>
      JSON.stringify(obj, Object.keys(obj).sort());

    const actualSet = new Set(actual.map(normalize));
    return expected.every((e) => actualSet.has(normalize(e)));
  }

  /** Try to use bfcl-eval Python package for AST-based evaluation. */
  private evaluateViaBfcl(taskId: string, agentCalls: object[]): boolean {
    try {
      const callsJson = JSON.stringify(agentCalls);
      const output = execFileSync(
        "python3",
        [
          "-c",
          `import json, bfcl; ` +
            `result = bfcl.evaluate("${taskId}", json.loads('${callsJson.replace(/'/g, "\\'")}')); ` +
            `print(json.dumps({"passed": result}))`,
        ],
        { stdio: "pipe", encoding: "utf-8", timeout: 30_000 }
      );
      const result = JSON.parse(output);
      return result.passed === true;
    } catch {
      return false;
    }
  }
}
