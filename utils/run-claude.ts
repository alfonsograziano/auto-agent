import { spawn } from "node:child_process";

export function runClaude(
  systemPrompt: string,
  userPrompt: string,
  cwd: string,
  addDir: string
): Promise<number> {
  return new Promise((resolve) => {
    const claude = spawn(
      "claude",
      [
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "--system-prompt",
        systemPrompt,
        "--add-dir",
        addDir,
        "-p",
        userPrompt,
      ],
      {
        cwd,
        stdio: ["ignore", "pipe", "inherit"],
      }
    );

    claude.stdout.on("data", (chunk: Buffer) => {
      for (const line of chunk.toString().split("\n").filter(Boolean)) {
        try {
          const event = JSON.parse(line);
          if (event.type === "assistant" && event.message?.content) {
            for (const block of event.message.content) {
              if (block.type === "text") {
                process.stdout.write(block.text);
              } else if (block.type === "tool_use") {
                console.log(
                  `\n[tool] ${block.name}: ${JSON.stringify(block.input).slice(0, 200)}`
                );
              }
            }
          } else if (event.type === "result") {
            console.log("\n[done]", event.subtype ?? "");
          }
        } catch {
          // not valid JSON, skip
        }
      }
    });

    claude.on("close", (code) => {
      resolve(code ?? 1);
    });
  });
}
