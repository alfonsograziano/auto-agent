export interface AgentRunOptions {
  systemPrompt: string;
  userPrompt: string;
  cwd: string;
  addDir: string;
}

export interface AgentProvider {
  readonly name: string;
  assertInstalled(): void;
  run(opts: AgentRunOptions): Promise<number>;
  cleanup?(): Promise<void>;
}
