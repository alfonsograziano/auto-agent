import { parseArgs } from "node:util";
import { mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";

const { values } = parseArgs({
  options: {
    id: { type: "string", short: "i" },
  },
  strict: true,
});

if (!values.id) {
  console.error("Usage: node scripts/create-job.ts --id <job-id>");
  process.exit(1);
}

const jobId: string = values.id;
const projectRoot: string = resolve(import.meta.dirname, "..");
const jobDir: string = join(projectRoot, "jobs", jobId);

if (existsSync(jobDir)) {
  console.error(`Error: Job folder already exists at ${jobDir}`);
  process.exit(1);
}

await mkdir(jobDir, { recursive: true });
await mkdir(join(jobDir, "hypotheses"), { recursive: true });

const templatesDir: string = join(projectRoot, "templates");

await copyFile(
  join(templatesDir, "JOB-TEMPLATE.md"),
  join(jobDir, "JOB.md")
);

await copyFile(
  join(templatesDir, "MEMORY-TEMPLATE.md"),
  join(jobDir, "MEMORY.md")
);

// Initialize SQLite database
const dbPath = join(jobDir, "results.db");
const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS hypotheses (
    id TEXT PRIMARY KEY,
    statement TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    branch_name TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    completed_at TEXT,
    reasoning TEXT
  );

  CREATE TABLE IF NOT EXISTS eval_runs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    hypothesis_id TEXT,
    run_type TEXT NOT NULL,
    accuracy REAL,
    latency_avg_ms REAL,
    latency_p95_ms REAL,
    cost_usd REAL,
    total_cases INTEGER,
    passed_cases INTEGER,
    failed_cases INTEGER,
    raw_output TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (hypothesis_id) REFERENCES hypotheses(id)
  );

  CREATE TABLE IF NOT EXISTS eval_cases (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    eval_run_id INTEGER NOT NULL,
    case_id TEXT NOT NULL,
    input TEXT NOT NULL,
    expected TEXT NOT NULL,
    actual TEXT,
    pass INTEGER NOT NULL,
    latency_ms REAL,
    cost_usd REAL,
    error TEXT,
    FOREIGN KEY (eval_run_id) REFERENCES eval_runs(id)
  );
`);

db.close();

console.log(`Job "${jobId}" created at: ${jobDir}`);
console.log();
console.log("Created:");
console.log(`  ${join(jobDir, "JOB.md")}           — fill in job config`);
console.log(`  ${join(jobDir, "MEMORY.md")}        — optionally seed with prior knowledge`);
console.log(`  ${join(jobDir, "hypotheses/")}      — hypothesis folders will go here`);
console.log(`  ${join(jobDir, "results.db")}       — SQLite database (initialized)`);
console.log();
console.log("Next steps:");
console.log(`  1. Open ${join(jobDir, "JOB.md")} and fill in the job details`);
console.log(`  2. Optionally seed ${join(jobDir, "MEMORY.md")} with prior knowledge`);
console.log(`  3. Run: npm run run-job -- --id ${jobId}`);
