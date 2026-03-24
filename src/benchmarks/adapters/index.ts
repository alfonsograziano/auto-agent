import type { BenchmarkAdapter } from "../types.ts";
import { AiderPolyglotAdapter } from "./aider-polyglot.ts";
import { GaiaAdapter } from "./gaia.ts";
import { TerminalBenchAdapter } from "./terminal-bench.ts";
import { AppWorldAdapter } from "./appworld.ts";
import { MLAgentBenchAdapter } from "./mlagentbench.ts";
import { TauBenchAdapter } from "./tau-bench.ts";
import { BfclAdapter } from "./bfcl.ts";

export type BenchmarkName =
  | "aider-polyglot"
  | "gaia"
  | "terminal-bench"
  | "appworld"
  | "mlagentbench"
  | "tau-bench"
  | "bfcl";

const ADAPTERS: Record<BenchmarkName, () => BenchmarkAdapter> = {
  "aider-polyglot": () => new AiderPolyglotAdapter(),
  gaia: () => new GaiaAdapter(),
  "terminal-bench": () => new TerminalBenchAdapter(),
  appworld: () => new AppWorldAdapter(),
  mlagentbench: () => new MLAgentBenchAdapter(),
  "tau-bench": () => new TauBenchAdapter(),
  bfcl: () => new BfclAdapter(),
};

export const BENCHMARK_NAMES = Object.keys(ADAPTERS) as BenchmarkName[];

export function createBenchmarkAdapter(name: BenchmarkName): BenchmarkAdapter {
  const factory = ADAPTERS[name];
  if (!factory) {
    throw new Error(
      `Unknown benchmark: "${name}". Available: ${BENCHMARK_NAMES.join(", ")}`
    );
  }
  return factory();
}

export {
  AiderPolyglotAdapter,
  GaiaAdapter,
  TerminalBenchAdapter,
  AppWorldAdapter,
  MLAgentBenchAdapter,
  TauBenchAdapter,
  BfclAdapter,
};
