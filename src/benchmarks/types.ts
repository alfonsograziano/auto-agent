import type { AgentProvider } from "../utils/providers/types.ts";

/** A single task within a benchmark. */
export interface BenchmarkTask {
  /** Unique identifier for this task (e.g., "python/two-fer", "gaia-001"). */
  id: string;
  /** Human-readable description of what the agent must do. */
  prompt: string;
  /** Optional system prompt override for this task. */
  systemPrompt?: string;
  /** Working directory for the agent to operate in. */
  cwd: string;
  /** Optional additional directory context (e.g., data files). */
  addDir?: string;
  /** Arbitrary metadata carried through to results. */
  meta?: Record<string, unknown>;
}

/** Result of evaluating a single task. */
export interface TaskResult {
  taskId: string;
  /** Whether the task was completed successfully. */
  passed: boolean;
  /** Optional numeric score (0-1) for partial credit benchmarks. */
  score?: number;
  /** Wall-clock duration in milliseconds. */
  durationMs: number;
  /** Error message if the task failed to run (not the same as !passed). */
  error?: string;
  /** Arbitrary metadata from evaluation. */
  meta?: Record<string, unknown>;
}

/** Aggregate results for an entire benchmark run. */
export interface BenchmarkResult {
  benchmarkName: string;
  providerName: string;
  tasks: TaskResult[];
  /** Overall accuracy: tasks passed / tasks attempted. */
  accuracy: number;
  /** Mean score for partial-credit benchmarks. */
  meanScore?: number;
  /** Total wall-clock duration in milliseconds. */
  totalDurationMs: number;
  /** ISO timestamp of when the run started. */
  startedAt: string;
  /** ISO timestamp of when the run finished. */
  finishedAt: string;
}

/** Configuration for running a benchmark. */
export interface BenchmarkRunOptions {
  /** Agent provider to use. */
  provider: AgentProvider;
  /** Directory to store results. */
  outputDir: string;
  /** Maximum number of tasks to run (for quick testing). 0 = all. */
  limit?: number;
  /** Number of parallel tasks (default 1 = sequential). */
  concurrency?: number;
  /** Filter to specific task IDs. */
  taskFilter?: string[];
}

/**
 * A benchmark adapter knows how to:
 * 1. Verify prerequisites are installed
 * 2. Load tasks from the benchmark's data source
 * 3. Evaluate a single task's output
 */
export interface BenchmarkAdapter {
  /** Short identifier (e.g., "aider-polyglot", "gaia"). */
  readonly name: string;
  /** Human-readable description. */
  readonly description: string;
  /** Estimated tasks count. */
  readonly taskCount: number;
  /** Category for grouping in reports. */
  readonly category: "coding" | "general" | "cli" | "workflow" | "ml" | "tool-use";

  /** Check that all prerequisites (repos, tools, data) are available. */
  assertReady(): Promise<void>;

  /** Load all tasks (or a filtered subset). */
  loadTasks(filter?: string[]): Promise<BenchmarkTask[]>;

  /**
   * Run a single task through the provider and evaluate the result.
   * The adapter is responsible for:
   *   1. Setting up the task environment
   *   2. Invoking provider.run() with appropriate prompts
   *   3. Evaluating the output (running tests, checking answers, etc.)
   *   4. Cleaning up the task environment
   */
  runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult>;
}
