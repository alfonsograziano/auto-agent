import { parseArgs } from "node:util";
import { mkdir, copyFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { existsSync } from "node:fs";

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

console.log(`Job "${jobId}" created at: ${jobDir}`);
console.log();
console.log("Created:");
console.log(`  ${join(jobDir, "JOB.md")}           — fill in job config`);
console.log(`  ${join(jobDir, "MEMORY.md")}        — optionally seed with prior knowledge`);
console.log(`  ${join(jobDir, "hypotheses/")}      — hypothesis folders will go here`);
console.log();
console.log("Next steps:");
console.log(`  1. Open ${join(jobDir, "JOB.md")} and fill in the job details`);
console.log(`  2. Optionally seed ${join(jobDir, "MEMORY.md")} with prior knowledge`);
console.log(`  3. Run: npm run run-job -- --id ${jobId}`);
