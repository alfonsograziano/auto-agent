import { createWriteStream, type WriteStream } from "node:fs";
import { join } from "node:path";

let logStream: WriteStream | null = null;

const ANSI_RE = /\x1B\[[0-9;]*m/g;

function stripAnsi(text: string): string {
  return text.replace(ANSI_RE, "");
}

export function initLogger(jobDir: string): void {
  const logPath = join(jobDir, "out.log.txt");
  logStream = createWriteStream(logPath, { flags: "a" });
  logStream.write(`\n${"=".repeat(60)}\n`);
  logStream.write(`Log started at ${new Date().toISOString()}\n`);
  logStream.write(`${"=".repeat(60)}\n\n`);

  // Tee stdout and stderr to the log file
  const origStdoutWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = function (chunk: any, ...args: any[]) {
    logStream?.write(stripAnsi(String(chunk)));
    return origStdoutWrite(chunk, ...args);
  } as typeof process.stdout.write;

  const origStderrWrite = process.stderr.write.bind(process.stderr);
  process.stderr.write = function (chunk: any, ...args: any[]) {
    logStream?.write(stripAnsi(String(chunk)));
    return origStderrWrite(chunk, ...args);
  } as typeof process.stderr.write;
}

export function closeLogger(): void {
  logStream?.end();
  logStream = null;
}

export function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;
  if (minutes < 60) return `${minutes}m ${remainingSeconds}s`;
  const hours = Math.floor(minutes / 60);
  const remainingMinutes = minutes % 60;
  return `${hours}h ${remainingMinutes}m ${remainingSeconds}s`;
}

export function formatTimestamp(): string {
  return new Date().toLocaleTimeString("en-US", { hour12: false });
}
