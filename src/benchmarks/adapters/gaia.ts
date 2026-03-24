import { readFile, rm } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, resolve } from "node:path";
import type { AgentProvider } from "../../utils/providers/types.ts";
import type { BenchmarkAdapter, BenchmarkTask, TaskResult } from "../types.ts";

/**
 * GAIA (General AI Assistants) benchmark adapter.
 *
 * Dataset: https://huggingface.co/datasets/gaia-benchmark/GAIA
 * ~450 real-world questions requiring web browsing, file reading, multi-step
 * reasoning, and tool use. Three difficulty levels. Exact-match scoring.
 *
 * Expected data format (HuggingFace JSONL export):
 *   { "task_id": "...", "question": "...", "final_answer": "...", "level": 1, "file_name": "..." }
 */

const DATA_DIR_ENV = "GAIA_DATA_DIR";
const DEFAULT_DATA_DIR = resolve(
  import.meta.dirname,
  "..",
  "..",
  "..",
  "benchmarks",
  "gaia"
);

interface GaiaEntry {
  task_id: string;
  question: string;
  final_answer: string;
  level: number;
  file_name?: string;
  file_path?: string;
}

function getDataDir(): string {
  return process.env[DATA_DIR_ENV] || DEFAULT_DATA_DIR;
}

export class GaiaAdapter implements BenchmarkAdapter {
  readonly name = "gaia";
  readonly description = "Real-world assistant questions requiring reasoning and tool use";
  readonly taskCount = 450;
  readonly category = "general" as const;

  async assertReady(): Promise<void> {
    const dir = getDataDir();
    if (!existsSync(dir)) {
      throw new Error(
        `GAIA dataset not found at ${dir}. ` +
          `Download from https://huggingface.co/datasets/gaia-benchmark/GAIA ` +
          `or set ${DATA_DIR_ENV} env var.`
      );
    }
    // Look for validation or test JSONL
    const hasData =
      existsSync(join(dir, "validation.jsonl")) ||
      existsSync(join(dir, "test.jsonl")) ||
      existsSync(join(dir, "metadata.jsonl"));
    if (!hasData) {
      throw new Error(
        `No JSONL data files found in ${dir}. ` +
          `Expected validation.jsonl, test.jsonl, or metadata.jsonl`
      );
    }
  }

  async loadTasks(filter?: string[]): Promise<BenchmarkTask[]> {
    const dir = getDataDir();
    const entries = await this.loadEntries(dir);
    const tasks: BenchmarkTask[] = [];

    for (const entry of entries) {
      if (filter && !filter.some((f) => entry.task_id.includes(f))) continue;

      let prompt = entry.question;
      if (entry.file_name) {
        const filePath = entry.file_path || join(dir, "files", entry.file_name);
        prompt += `\n\nAn attached file is available at: ${filePath}`;
      }

      tasks.push({
        id: entry.task_id,
        prompt,
        cwd: dir,
        meta: {
          level: entry.level,
          expectedAnswer: entry.final_answer,
          fileName: entry.file_name,
        },
      });
    }

    return tasks;
  }

  async runTask(task: BenchmarkTask, provider: AgentProvider): Promise<TaskResult> {
    const start = Date.now();
    const expectedAnswer = task.meta?.expectedAnswer as string;

    const systemPrompt =
      `You are answering a factual question that may require web search, file reading, ` +
      `calculation, or multi-step reasoning. ` +
      `Your FINAL answer must be on the LAST line of your response, prefixed with "FINAL ANSWER: ". ` +
      `The answer should be concise — a single word, number, or short phrase. ` +
      `Do not include explanations in the final answer line.`;

    // Create a temp file to capture the agent's output
    const outputPath = join(getDataDir(), `.output-${task.id.replace(/[^a-zA-Z0-9]/g, "_")}`);

    const exitCode = await provider.run({
      systemPrompt,
      userPrompt: task.prompt,
      cwd: task.cwd,
      addDir: task.addDir || task.cwd,
    });

    // For GAIA, we need to capture the agent's final answer from its output.
    // Since providers stream to stdout, we read back the captured output.
    // In practice, a more robust approach would parse provider-specific output formats.
    // For now, we check if the agent produced a "FINAL ANSWER:" line.

    // Since we can't easily intercept provider stdout in this architecture,
    // we ask the agent to write its answer to a file.
    const answerPath = join(task.cwd, `.gaia-answer-${task.id.replace(/[^a-zA-Z0-9]/g, "_")}`);

    // Re-run with answer-file instruction if first run didn't write one
    if (!existsSync(answerPath)) {
      const retryPrompt =
        `${task.prompt}\n\nIMPORTANT: Write ONLY your final answer (a single word, number, or short phrase) ` +
        `to the file: ${answerPath}`;

      await provider.run({
        systemPrompt,
        userPrompt: retryPrompt,
        cwd: task.cwd,
        addDir: task.addDir || task.cwd,
      });
    }

    let agentAnswer = "";
    if (existsSync(answerPath)) {
      agentAnswer = (await readFile(answerPath, "utf-8")).trim();
      await rm(answerPath, { force: true }).catch(() => {});
    }

    const passed = normalizeAnswer(agentAnswer) === normalizeAnswer(expectedAnswer);

    return {
      taskId: task.id,
      passed,
      durationMs: Date.now() - start,
      meta: {
        agentAnswer,
        expectedAnswer,
        level: task.meta?.level,
      },
    };
  }

  private async loadEntries(dir: string): Promise<GaiaEntry[]> {
    const candidates = ["validation.jsonl", "test.jsonl", "metadata.jsonl"];
    for (const filename of candidates) {
      const path = join(dir, filename);
      if (!existsSync(path)) continue;
      const content = await readFile(path, "utf-8");
      return content
        .split("\n")
        .filter(Boolean)
        .map((line) => JSON.parse(line) as GaiaEntry);
    }
    return [];
  }
}

/** Normalize answers for comparison: lowercase, strip whitespace/punctuation. */
function normalizeAnswer(answer: string): string {
  return answer
    .toLowerCase()
    .trim()
    .replace(/[.,;:!?'"()[\]{}]/g, "")
    .replace(/\s+/g, " ");
}
