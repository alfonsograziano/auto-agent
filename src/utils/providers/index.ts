export type { AgentProvider, AgentRunOptions } from "./types.ts";

import type { AgentProvider } from "./types.ts";
import { ClaudeProvider } from "./claude.ts";
import { KiroProvider } from "./kiro.ts";

export type ProviderName = "claude" | "kiro";

export function createProvider(name: ProviderName): AgentProvider {
  switch (name) {
    case "claude":
      return new ClaudeProvider();
    case "kiro":
      return new KiroProvider();
    default:
      throw new Error(
        `Unknown provider: "${name}". Supported providers: claude, kiro`
      );
  }
}
