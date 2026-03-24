import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { styleText } from "node:util";
import { formatDuration, formatTimestamp } from "../utils/logger.ts";
import type {
  BenchmarkAdapter,
  BenchmarkRunOptions,
  BenchmarkResult,
  TaskResult,
} from "./types.ts";

/**
 * Run a benchmark end-to-end: load tasks, run each through the provider,
 * collect results, write output JSON, and print a summary.
 */
export async function runBenchmark(
  adapter: BenchmarkAdapter,
  options: BenchmarkRunOptions
): Promise<BenchmarkResult> {
  const { provider, outputDir, limit = 0, taskFilter } = options;

  console.log(styleText("bold", `\nBenchmark: ${adapter.name}`));
  console.log(styleText("dim", "─".repeat(60)));
  console.log(`  Category:    ${styleText("cyan", adapter.category)}`);
  console.log(`  Provider:    ${styleText("cyan", provider.name)}`);
  console.log(`  Total tasks: ${styleText("cyan", String(adapter.taskCount))}`);
  if (limit > 0) {
    console.log(`  Limit:       ${styleText("yellow", String(limit))}`);
  }
  console.log(styleText("dim", "─".repeat(60)));
  console.log("");

  // 1. Check prerequisites
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} Checking prerequisites...`);
  await adapter.assertReady();
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} ${styleText("green", "✓")} Prerequisites OK`);

  // 2. Load tasks
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} Loading tasks...`);
  let tasks = await adapter.loadTasks(taskFilter);
  if (limit > 0) {
    tasks = tasks.slice(0, limit);
  }
  console.log(`${styleText("dim", `[${formatTimestamp()}]`)} ${styleText("green", "✓")} Loaded ${tasks.length} tasks`);
  console.log("");

  // 3. Run tasks
  const startedAt = new Date().toISOString();
  const runStart = Date.now();
  const results: TaskResult[] = [];
  let passed = 0;

  for (let i = 0; i < tasks.length; i++) {
    const task = tasks[i];
    const taskNum = `[${i + 1}/${tasks.length}]`;

    console.log(
      `${styleText("dim", `[${formatTimestamp()}]`)} ${taskNum} ${styleText("cyan", task.id)} ...`
    );

    const taskStart = Date.now();
    let result: TaskResult;

    try {
      result = await adapter.runTask(task, provider);
    } catch (err) {
      result = {
        taskId: task.id,
        passed: false,
        durationMs: Date.now() - taskStart,
        error: err instanceof Error ? err.message : String(err),
      };
    }

    results.push(result);
    if (result.passed) passed++;

    const statusIcon = result.passed
      ? styleText("green", "✓")
      : result.error
        ? styleText("red", "✗ ERROR")
        : styleText("red", "✗");
    const accuracy = ((passed / (i + 1)) * 100).toFixed(1);

    console.log(
      `${styleText("dim", `[${formatTimestamp()}]`)} ${taskNum} ${statusIcon} ${styleText("dim", task.id)} ` +
        `${styleText("dim", formatDuration(result.durationMs))} ` +
        `(running: ${styleText("yellow", `${accuracy}%`)})`
    );
  }

  const finishedAt = new Date().toISOString();
  const totalDurationMs = Date.now() - runStart;

  // 4. Compute aggregate metrics
  const accuracy = tasks.length > 0 ? passed / tasks.length : 0;
  const scores = results.filter((r) => r.score !== undefined).map((r) => r.score!);
  const meanScore = scores.length > 0 ? scores.reduce((a, b) => a + b, 0) / scores.length : undefined;

  const benchmarkResult: BenchmarkResult = {
    benchmarkName: adapter.name,
    providerName: provider.name,
    tasks: results,
    accuracy,
    meanScore,
    totalDurationMs,
    startedAt,
    finishedAt,
  };

  // 5. Write results to disk
  await mkdir(outputDir, { recursive: true });
  const resultsPath = join(outputDir, `${adapter.name}_${provider.name}_${Date.now()}.json`);
  await writeFile(resultsPath, JSON.stringify(benchmarkResult, null, 2), "utf-8");

  // 6. Print summary
  console.log("");
  console.log(styleText("bold", "  Results:"));
  console.log(styleText("dim", "  " + "─".repeat(50)));
  console.log(`  Passed:     ${styleText("green", String(passed))} / ${tasks.length}`);
  console.log(`  Accuracy:   ${styleText("bold", `${(accuracy * 100).toFixed(1)}%`)}`);
  if (meanScore !== undefined) {
    console.log(`  Mean score: ${styleText("bold", meanScore.toFixed(3))}`);
  }
  console.log(`  Duration:   ${styleText("dim", formatDuration(totalDurationMs))}`);
  console.log(`  Results:    ${styleText("cyan", resultsPath)}`);
  console.log("");

  return benchmarkResult;
}
