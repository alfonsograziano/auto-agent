import { spawn, execFileSync } from "node:child_process";
import { writeFile, mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { randomBytes } from "node:crypto";
import { styleText } from "node:util";
import type { AgentProvider, AgentRunOptions } from "./types.ts";

export class KiroProvider implements AgentProvider {
  readonly name = "kiro";

  private tempFiles: string[] = [];

  assertInstalled(): void {
    try {
      execFileSync("kiro-cli", ["version"], {
        stdio: "pipe",
        encoding: "utf-8",
      });
    } catch {
      console.error(
        styleText("red", "Error: Kiro CLI is not installed or not found in PATH.")
      );
      console.error(
        `Install it from: ${styleText("yellow", "https://kiro.dev/cli/")}`
      );
      process.exit(1);
    }
  }

  async run(opts: AgentRunOptions): Promise<number> {
    // Use a steering file to inject the system prompt. The --agent flag
    // disables all built-in tools, so we avoid it entirely. Steering files
    // with `inclusion: always` are prepended to the agent's context while
    // keeping all tools (fs_read, fs_write, execute_bash, etc.) available.
    const suffix = randomBytes(4).toString("hex");
    const steeringDir = join(opts.cwd, ".kiro", "steering");
    await mkdir(steeringDir, { recursive: true });

    const steeringFile = join(steeringDir, `auto-agent-${suffix}.md`);
    const content = `---\ninclusion: always\n---\n${opts.systemPrompt}`;
    await writeFile(steeringFile, content, "utf-8");
    this.tempFiles.push(steeringFile);

    // Kiro has no --add-dir, so fold the job directory context into the prompt
    const userPrompt = opts.addDir
      ? `The job directory with MEMORY.md, REPORT templates, and hypothesis folders is at: ${opts.addDir}\n\n${opts.userPrompt}`
      : opts.userPrompt;

    return new Promise((resolve) => {
      const kiro = spawn(
        "kiro-cli",
        [
          "chat",
          "--no-interactive",
          "--trust-all-tools",
          userPrompt,
        ],
        {
          cwd: opts.cwd,
          stdio: ["ignore", "pipe", "inherit"],
        }
      );

      kiro.stdout.on("data", (chunk: Buffer) => {
        process.stdout.write(chunk);
      });

      kiro.on("close", (code) => {
        resolve(code ?? 1);
      });
    });
  }

  async cleanup(): Promise<void> {
    for (const filePath of this.tempFiles) {
      try {
        await rm(filePath, { force: true });
      } catch {
        // Best effort cleanup
      }
    }
    this.tempFiles = [];
  }
}
