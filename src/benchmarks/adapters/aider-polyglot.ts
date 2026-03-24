import { execFileSync } from "node:child_process";
import { readdir, readFile, cp, rm, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { randomBytes } from "node:crypto";
import type { AgentProvider } from "../../utils/providers/types.ts";
import type { BenchmarkAdapter, BenchmarkTask, TaskResult } from "../types.ts";

/**
 * Aider Polyglot Benchmark adapter.
 *
 * Repo: https://github.com/Aider-AI/polyglot-benchmark
 * 225 Exercism exercises across 6 languages (C++, Go, Java, JS, Python, Rust).
 * Agent edits a source file, then language-specific tests determine pass/fail.
 * Two attempts per problem: second attempt includes test failure output.
 */

const BENCHMARK_DIR_ENV = "AIDER_POLYGLOT_DIR";
const DEFAULT_BENCHMARK_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "benchmarks",
  "polyglot-benchmark"
);

const LANGUAGES = ["cpp", "go", "java", "javascript", "python", "rust"] as const;

/** Map language dir names to test runner commands. */
const TEST_COMMANDS: Record<string, { cmd: string; args: string[] }> = {
  python: { cmd: "python", args: ["-m", "pytest", "-x", "--tb=short"] },
  javascript: { cmd: "npx", args: ["jest", "--no-coverage"] },
  go: { cmd: "go", args: ["test", "-v", "./..."] },
  rust: { cmd: "cargo", args: ["test"] },
  java: { cmd: "gradle", args: ["test"] },
  cpp: { cmd: "cmake", args: ["--build", ".", "--target", "test"] },
};

function getBenchmarkDir(): string {
  return process.env[BENCHMARK_DIR_ENV] || DEFAULT_BENCHMARK_DIR;
}

export class AiderPolyglotAdapter implements BenchmarkAdapter {
  readonly name = "aider-polyglot";
  readonly description = "225 Exercism exercises across 6 languages";
  readonly taskCount = 225;
  readonly category = "coding" as const;

  async assertReady(): Promise<void> {
    const dir = getBenchmarkDir();
    if (!existsSync(dir)) {
      throw new Error(
        `Polyglot benchmark not found at ${dir}. ` +
          `Clone it: git clone https://github.com/Aider-AI/polyglot-benchmark ${dir} ` +
          `or set ${BENCHMARK_DIR_ENV} env var.`
      );
    }
    // Check at least one language dir exists
    const hasLanguage = LANGUAGES.some((lang) =>
      existsSync(join(dir, "exercises", lang))
    );
    if (!hasLanguage) {
      throw new Error(
        `No exercise directories found in ${join(dir, "exercises")}. ` +
          `Expected subdirectories: ${LANGUAGES.join(", ")}`
      );
    }
  }

  async loadTasks(filter?: string[]): Promise<BenchmarkTask[]> {
    const dir = getBenchmarkDir();
    const tasks: BenchmarkTask[] = [];

    for (const lang of LANGUAGES) {
      const exercisesDir = join(dir, "exercises", lang);
      if (!existsSync(exercisesDir)) continue;

      const exercises = await readdir(exercisesDir, { withFileTypes: true });
      for (const entry of exercises) {
        if (!entry.isDirectory()) continue;
        const taskId = `${lang}/${entry.name}`;

        if (filter && !filter.some((f) => taskId.includes(f))) continue;

        // Read the exercise instructions if available
        const instructionsPath = join(exercisesDir, entry.name, ".docs", "instructions.md");
        let instructions = "";
        if (existsSync(instructionsPath)) {
          instructions = await readFile(instructionsPath, "utf-8");
        }

        tasks.push({
          id: taskId,
          prompt: instructions || `Solve the "${entry.name}" exercise in ${lang}.`,
          cwd: join(exercisesDir, entry.name),
          meta: { language: lang, exercise: entry.name },
        });
      }
    }

    return tasks.sort((a, b) => a.id.localeCompare(b.id));
  }

  async runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult> {
    const start = Date.now();
    const lang = task.meta?.language as string;
    const testCmd = TEST_COMMANDS[lang];

    if (!testCmd) {
      return {
        taskId: task.id,
        passed: false,
        durationMs: Date.now() - start,
        error: `No test command configured for language: ${lang}`,
      };
    }

    // Work in a temp copy so we don't pollute the original
    const workDir = join(
      getBenchmarkDir(),
      ".workspaces",
      `${task.meta?.exercise}-${randomBytes(3).toString("hex")}`
    );
    await mkdir(workDir, { recursive: true });
    await cp(task.cwd, workDir, { recursive: true });

    try {
      // Attempt 1: Agent edits the code
      const systemPrompt =
        `You are solving an Exercism exercise. Edit the source file(s) in the current directory to make all tests pass. ` +
        `Language: ${lang}. Do NOT modify test files.`;

      const exitCode = await provider.run({
        systemPrompt,
        userPrompt: task.prompt,
        cwd: workDir,
        addDir: workDir,
      });

      if (exitCode !== 0) {
        return {
          taskId: task.id,
          passed: false,
          durationMs: Date.now() - start,
          error: `Agent exited with code ${exitCode}`,
        };
      }

      // Run tests (attempt 1)
      let testPassed = this.runTests(workDir, testCmd);

      // Attempt 2: If tests failed, give agent the failure output
      if (!testPassed) {
        const testOutput = this.getTestOutput(workDir, testCmd);
        const retryPrompt =
          `The tests failed on first attempt. Here is the test output:\n\n${testOutput}\n\n` +
          `Fix the code to make all tests pass.`;

        await provider.run({
          systemPrompt,
          userPrompt: retryPrompt,
          cwd: workDir,
          addDir: workDir,
        });

        testPassed = this.runTests(workDir, testCmd);
      }

      return {
        taskId: task.id,
        passed: testPassed,
        durationMs: Date.now() - start,
      };
    } finally {
      await rm(workDir, { recursive: true, force: true }).catch(() => {});
    }
  }

  private runTests(cwd: string, testCmd: { cmd: string; args: string[] }): boolean {
    try {
      execFileSync(testCmd.cmd, testCmd.args, {
        cwd,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 60_000,
      });
      return true;
    } catch {
      return false;
    }
  }

  private getTestOutput(cwd: string, testCmd: { cmd: string; args: string[] }): string {
    try {
      execFileSync(testCmd.cmd, testCmd.args, {
        cwd,
        stdio: "pipe",
        encoding: "utf-8",
        timeout: 60_000,
      });
      return "(tests passed)";
    } catch (err: any) {
      return (err.stdout ?? "") + "\n" + (err.stderr ?? "");
    }
  }
}
