import { parseArgs, styleText } from "node:util";
import { resolve, join } from "node:path";
import { mkdir } from "node:fs/promises";
import { initLogger, closeLogger, formatDuration } from "../utils/logger.ts";
import { createProvider, type ProviderName } from "../utils/providers/index.ts";
import {
  createBenchmarkAdapter,
  BENCHMARK_NAMES,
  type BenchmarkName,
} from "../benchmarks/adapters/index.ts";
import { runBenchmark } from "../benchmarks/runner.ts";
import type { BenchmarkResult } from "../benchmarks/types.ts";

// --- CLI parsing ---

const { values } = parseArgs({
  options: {
    benchmark: { type: "string", short: "b" },
    provider: { type: "string", short: "p", default: "claude" },
    limit: { type: "string", short: "l", default: "0" },
    filter: { type: "string", short: "f" },
    output: { type: "string", short: "o" },
    list: { type: "boolean" },
    all: { type: "boolean" },
  },
  strict: true,
});

// --- List mode ---

if (values.list) {
  console.log(styleText("bold", "\nAvailable benchmarks:\n"));
  for (const name of BENCHMARK_NAMES) {
    const adapter = createBenchmarkAdapter(name);
    console.log(
      `  ${styleText("cyan", adapter.name.padEnd(20))} ` +
        `${styleText("dim", adapter.category.padEnd(12))} ` +
        `${adapter.description} (${adapter.taskCount} tasks)`
    );
  }
  console.log("");
  process.exit(0);
}

// --- Validate inputs ---

const benchmarkNames: BenchmarkName[] = [];

if (values.all) {
  benchmarkNames.push(...BENCHMARK_NAMES);
} else if (values.benchmark) {
  const names = values.benchmark.split(",").map((s) => s.trim()) as BenchmarkName[];
  for (const name of names) {
    if (!BENCHMARK_NAMES.includes(name)) {
      console.error(
        styleText("red", `Unknown benchmark: "${name}". Available: ${BENCHMARK_NAMES.join(", ")}`)
      );
      process.exit(1);
    }
    benchmarkNames.push(name);
  }
} else {
  console.error(
    styleText(
      "red",
      "Usage: node src/scripts/run-benchmark.ts --benchmark <name> --provider <claude|kiro> [--limit N] [--filter id1,id2]"
    )
  );
  console.error(`\nAvailable benchmarks: ${BENCHMARK_NAMES.join(", ")}`);
  console.error(`Use --list to see details, --all to run all benchmarks.`);
  process.exit(1);
}

const providerName = values.provider as ProviderName;
const limit = parseInt(values.limit ?? "0", 10);
const taskFilter = values.filter?.split(",").map((s) => s.trim());

const projectRoot = resolve(import.meta.dirname, "..", "..");
const outputDir = values.output
  ? resolve(values.output)
  : join(projectRoot, "benchmark-results", `${providerName}-${Date.now()}`);

await mkdir(outputDir, { recursive: true });

// --- Init ---

initLogger(outputDir);

const provider = createProvider(providerName);
provider.assertInstalled();

console.log(styleText("bold", "\nBenchmark Runner"));
console.log(styleText("dim", "─".repeat(60)));
console.log(`  Provider:    ${styleText("cyan", providerName)}`);
console.log(`  Benchmarks:  ${styleText("cyan", benchmarkNames.join(", "))}`);
if (limit > 0) console.log(`  Limit:       ${styleText("yellow", String(limit))}`);
if (taskFilter) console.log(`  Filter:      ${styleText("yellow", taskFilter.join(", "))}`);
console.log(`  Output:      ${styleText("cyan", outputDir)}`);
console.log(styleText("dim", "─".repeat(60)));

// --- Run benchmarks ---

const allResults: BenchmarkResult[] = [];
const suiteStart = Date.now();

for (const benchmarkName of benchmarkNames) {
  const adapter = createBenchmarkAdapter(benchmarkName);

  try {
    const result = await runBenchmark(adapter, {
      provider,
      outputDir,
      limit,
      taskFilter,
    });
    allResults.push(result);
  } catch (err) {
    console.error(
      styleText("red", `\nBenchmark "${benchmarkName}" failed: ${err instanceof Error ? err.message : err}`)
    );
  }
}

await provider.cleanup?.();

// --- Suite summary ---

const suiteDuration = Date.now() - suiteStart;

console.log(`\n${styleText("green", "=".repeat(60))}`);
console.log(styleText("bold", "  Suite Summary"));
console.log(`${styleText("green", "=".repeat(60))}\n`);

console.log(
  `  ${"Benchmark".padEnd(20)} ${"Category".padEnd(12)} ${"Accuracy".padEnd(12)} ${"Tasks".padEnd(8)} Duration`
);
console.log(`  ${styleText("dim", "─".repeat(64))}`);

for (const r of allResults) {
  const adapter = createBenchmarkAdapter(r.benchmarkName as BenchmarkName);
  const pct = `${(r.accuracy * 100).toFixed(1)}%`;
  const passed = r.tasks.filter((t) => t.passed).length;
  console.log(
    `  ${r.benchmarkName.padEnd(20)} ${adapter.category.padEnd(12)} ` +
      `${styleText("bold", pct.padEnd(12))} ${`${passed}/${r.tasks.length}`.padEnd(8)} ` +
      `${formatDuration(r.totalDurationMs)}`
  );
}

console.log("");
console.log(`  Total duration: ${styleText("bold", formatDuration(suiteDuration))}`);
console.log(`  Results dir:    ${styleText("cyan", outputDir)}`);
console.log("");

closeLogger();
