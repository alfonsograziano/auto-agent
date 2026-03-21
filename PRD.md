# PRD: Self-Evolving Agent System

> **Implementation status legend**: [DONE] = implemented and working, [PARTIAL] = partially implemented, [PLANNED] = not yet built.

## 1. Problem Statement

Building and maintaining AI agents is a manual, iterative process: a developer writes code, runs evaluations, reads results, forms hypotheses, implements fixes, and repeats. This cycle is slow, expensive, and doesn't scale when the task surface grows (new question types, tighter latency requirements, cost constraints).

We need a system that **automates this entire loop** — given only a golden dataset of expected input/output pairs, it should autonomously evolve a target agent's code, tools, and prompts until the agent meets the desired performance bar.

## 2. Goals

1. **Human-triggered improvement**: The human triggers the optimization loop manually against whatever golden dataset is currently available. The system then runs autonomously until completion.
2. **Measurable progress**: Every trial produces quantifiable results (eval pass rate, latency, cost) compared to a baseline.
3. **Safe iteration**: Failed trials are rolled back. The eval suite is immutable — the system cannot cheat by changing the tests.
4. **Accumulated learning**: A shared memory persists across trials and loops, so the system doesn't repeat failed strategies or forget successful ones.
5. **Bounded execution**: Each optimization loop has a configurable max number of trials to prevent runaway costs.

## 2.1 Implementation Progress Summary

| Capability | Status | Script / Module |
|-----------|--------|-----------------|
| Job scaffolding (folder, templates, SQLite) | [DONE] | `scripts/create-job.ts` |
| Baseline eval runner | [DONE] | `scripts/run-baseline-evals.ts` |
| Hypothesis creation (idempotent) | [DONE] | `utils/create-hypothesis.ts` |
| Claude Code subprocess with streaming output | [DONE] | `run-baseline-evals.ts` (stream-json) |
| Prompt engineering (EARS + VERIFY) | [DONE] | `.claude/skills/prompt-engineering/` |
| SQLite schema (hypotheses, eval_runs, eval_cases) | [DONE] | `create-job.ts` |
| Full optimization loop (`run-job`) | [PLANNED] | — |
| Analyzer (failure categorization, hypothesis formulation) | [PLANNED] | — |
| Hypothesis runner (implement → eval → accept/reject) | [PLANNED] | — |
| Memory manager (MEMORY.md read/write + summarizer) | [PLANNED] | — |
| Git manager (branch, merge, rollback) | [PARTIAL] | inline in `run-baseline-evals.ts` |
| Constraint validation (forbidden files check) | [PLANNED] | — |
| Reporter (per-hypothesis + final reports) | [PLANNED] | — |

## 3. System Architecture

### 3.1 Two-Repository Structure [DONE]

```
┌──────────────────────────────────────────────┐
│   Orchestrator Repository (this repo)        │
│   TypeScript CLI — auto-agent                │
│                                              │
│   scripts/               ← npm run scripts   │
│   utils/                 ← shared utilities   │
│   templates/             ← JOB + MEMORY       │
│   jobs/                                      │
│     <job-id>/          ← one folder per job  │
│       JOB.md           ← objective, config   │
│       MEMORY.md        ← shared learnings    │
│       hypotheses/      ← one folder per try  │
│       results.db       ← node:sqlite store   │
│       final-report.md                        │
└──────────┬───────────────────────────────────┘
           │ controls (branches, runs evals, spawns coding agent)
           ▼
┌──────────────────────────────────────────────┐
│   Target Agent Repository                    │
│   Mastra-based TypeScript agent              │
│   (The agent being evolved)                  │
└──────────────────────────────────────────────┘
```

**Orchestrator (this repo)**: TypeScript CLI using `npm run` scripts. Controls the optimization loop, invokes the coding agent, runs evals, manages job artifacts and memory, produces reports. All job data (memory, hypotheses, reports) lives inside the `jobs/` folder of this repo. Uses Node.js 22+ with native TypeScript (type stripping), `node:sqlite`, and `node:util.parseArgs`.

**Target Agent**: A separate Mastra-based TypeScript project. Contains the agent code, system prompt, tools, and the eval suite. The orchestrator points at this repo via a path in `JOB.md`. The coding agent modifies everything in the target repo *except* the files listed as forbidden in the job config.

### 3.2 Component Diagram

```
Human triggers: npm run run-job -- --id <job-id>
        │
        ▼
┌───────────────────────────────────────────────────┐
│                  ORCHESTRATOR CLI                   │
│                                                    │
│  ┌────────────┐  ┌────────────┐  ┌─────────────┐  │
│  │ Job Loader │  │  Analyzer  │  │  Reporter    │  │
│  │ (reads     │→ │ (reads     │  │ (produces    │  │
│  │  JOB.md,   │  │  MEMORY.md │  │  per-hyp &   │  │
│  │  creates   │  │  + evals,  │  │  final       │  │
│  │  job dir)  │  │  forms     │  │  reports)    │  │
│  └────────────┘  │  hypotheses│  └─────────────┘  │
│   [DONE]         └─────┬──────┘   [PLANNED]       │
│                        │ [PLANNED]                 │
│                        ▼                           │
│               ┌────────────────┐                   │
│               │ Hypothesis     │                   │
│               │ Runner         │ [PLANNED]         │
│               │ (one per try)  │                   │
│               └───────┬────────┘                   │
│                       │                            │
│            ┌──────────┼──────────┐                 │
│            ▼          ▼          ▼                  │
│     ┌──────────┐ ┌────────┐ ┌────────┐            │
│     │  Coding  │ │  Eval  │ │ Memory │            │
│     │  Agent   │ │ Runner │ │ Manager│            │
│     │ (Claude  │ │ (runs  │ │ (R/W   │            │
│     │  Code)   │ │ cmd    │ │ MEMORY │            │
│     │  via     │ │ from   │ │ .md +  │            │
│     │  spawn)  │ │ JOB.md)│ │ sqlite)│            │
│     └──────────┘ └────────┘ └────────┘            │
│      [DONE]      [DONE]      [PLANNED]            │
└───────────────────────────────────────────────────┘
```

## 4. Core Concepts

### 4.1 Golden Dataset

A JSON file containing input/output pairs that define the target agent's expected behavior.

```json
{
  "version": "1.0.0",
  "dataset": [
    {
      "id": "math-001",
      "input": "What is 2 + 2?",
      "expected_output": "4",
      "category": "arithmetic",
      "difficulty": "easy"
    },
    {
      "id": "math-002",
      "input": "What is the derivative of x^2?",
      "expected_output": "2x",
      "category": "calculus",
      "difficulty": "medium"
    }
  ]
}
```

- **Immutable during a loop**: The dataset is read at loop start and not modified during execution.
- **Progressive difficulty**: Items are ordered or tagged by difficulty so the system can prioritize low-hanging fruit first.

### 4.2 Jobs [DONE]

A job is a single optimization run against a target repo. The human creates a job by running `npm run create-job -- --id <job-id>`, which scaffolds a folder from templates (`JOB-TEMPLATE.md`, `MEMORY-TEMPLATE.md`) and initializes a SQLite database. The human then fills in `JOB.md` and triggers the optimization. Each job gets its own folder under `jobs/<job-id>/` containing all artifacts.

### 4.3 Hypotheses

A hypothesis is a single iteration within a job. Each hypothesis:

1. Starts from the current best state of the target agent (or baseline on first run).
2. Has a clear statement ("add a calculator tool to handle arithmetic").
3. Produces a set of code changes (new tools, prompt edits, code modifications).
4. Runs the full eval suite against the modified agent.
5. Is either **accepted** (metrics improved) or **rejected** (metrics regressed or unchanged).
6. May include a **"human intervention needed"** section if the coding agent identifies an improvement it cannot execute (e.g., needs an API key, external service setup, or a change to a forbidden file).

Each hypothesis gets its own subfolder: `jobs/<job-id>/hypotheses/<hypothesis-id>/`.

### 4.4 Job Memory (`MEMORY.md`)

Each job has a single `MEMORY.md` file at `jobs/<job-id>/MEMORY.md`. This file:

- Is **injected into the coding agent's context** at the start of every hypothesis session.
- Is **updated by a summarizer agent** after each hypothesis completes — capturing what worked, what didn't, and patterns observed.
- Accumulates learnings across hypotheses within the same job so the coding agent doesn't repeat failed strategies.
- Contains structured sections: successful patterns, failed patterns, known blockers, and current metrics.

### 4.5 Persisted Storage (`node:sqlite`)

Each job has a SQLite database (`jobs/<job-id>/results.db`) using Node.js built-in `node:sqlite` for structured/queryable data:

- Eval results per hypothesis (individual test case pass/fail, metrics).
- Metric time series (accuracy, latency, cost over hypotheses).
- Hypothesis metadata (status, timestamps, branch names).

The SQLite store complements the markdown/JSON files — use markdown for human-readable artifacts and SQLite for data that needs to be queried or aggregated.

### 4.4 Optimization Metrics

The system tracks multiple metrics per eval run:

| Metric | Description | Source |
|--------|-------------|--------|
| `accuracy` | % of golden dataset items answered correctly | Eval runner |
| `latency_avg_ms` | Average response time per query | Eval runner |
| `latency_p95_ms` | 95th percentile response time | Eval runner |
| `cost_usd` | Total API cost for the eval run | Token tracking |
| `tool_usage_count` | Number of tool calls made | Agent telemetry |

The orchestrator decides which metric(s) to optimize based on configuration. A trial is accepted if the **primary metric improves** and **no secondary metric regresses beyond a configurable threshold**.

## 5. Detailed Workflow

### 5.1 Optimization Loop (End-to-End)

```
[Human creates job: npm run create-job -- --id <job-id>]
   Creates job folder with JOB.md, MEMORY.md, hypotheses/, results.db.
        │
        ▼
[Human fills in JOB.md and optionally seeds MEMORY.md]
        │
        ▼
[Human runs job: npm run run-job -- --id <job-id>]
        │
        ▼
[1. JOB LOAD]
   Read JOB.md for objective, constraints, eval command, target repo path.
   Validate that required fields are filled in.
        │
        ▼
[2. BASELINE EVAL]
   Run eval command (from job.md) on current target agent state.
   Store baseline metrics in results.db and MEMORY.md.
        │
        ▼
[3. ANALYSIS]
   Read MEMORY.md (past hypotheses, known patterns).
   Identify failing eval cases.
   Categorize failures (missing capability, wrong answer, timeout, etc.).
        │
        ▼
[4. HYPOTHESIS FORMULATION]
   Based on analysis + MEMORY.md, form a hypothesis:
   "If I add tool X / change prompt Y / refactor Z, then metric M will improve."
   Prioritize by expected impact and difficulty.
   Create hypothesis folder: jobs/<job-id>/hypotheses/<hypothesis-id>/
        │
        ▼
[5. IMPLEMENTATION] ←── Coding Agent (Claude Code)
   Create a git branch from current best state.
   Inject MEMORY.md into coding agent's context.
   Coding agent implements the hypothesis:
     - Add/modify tools
     - Update system prompt
     - Refactor agent logic
     - Add helper functions
     - (optional) Write human-intervention.md if blocked
   CONSTRAINT: Cannot modify files listed in job.md constraints.
        │
        ▼
[6. EVAL RUN]
   Run eval command (from job.md) on the modified branch.
   Collect metrics (accuracy, latency, cost).
   Store results in results.db.
        │
        ▼
[7. DECISION]
   Compare metrics to baseline.
   IF improved → ACCEPT: merge branch, update baseline, record in MEMORY.md.
   IF regressed/unchanged → REJECT: discard branch, record failure in MEMORY.md.
        │
        ▼
[8. REPORT]
   Generate hypothesis report.md (changes, results, decision).
   Summarizer agent updates MEMORY.md with learnings from this hypothesis.
        │
        ▼
[9. LOOP CHECK]
   IF hypothesis_count < max_hypotheses AND there are still failing evals:
     → Go to step 3.
   ELSE:
     → Go to step 10.
        │
        ▼
[10. FINAL REPORT]
   Generate final-report.md: all hypotheses, net metric changes,
   remaining failures, human interventions needed.
```

### 5.2 Coding Agent Constraints

The coding agent (Claude Code) operates within strict boundaries defined by the job config.

**Allowed**:
- Modify agent source code (logic, handlers, utilities).
- Add new tool definitions (e.g., a calculator tool, a derivative solver).
- Modify the system prompt.
- Add new dependencies (npm packages).
- Create new source files.
- Read eval results and error messages.
- Write a `human-intervention.md` file in its hypothesis folder if it identifies an improvement it cannot execute.

**Forbidden** (defined per-job in `job.md` constraints section):
- Modify any file/directory listed in constraints (e.g., `evals/`, `golden-dataset.json`).
- Modify the orchestrator code.
- Make network calls to external services not already configured.
- Delete or rename eval infrastructure.

These constraints are enforced by:
1. The coding agent's working directory is scoped to the target repo.
2. Post-implementation validation (orchestrator checks via `git diff --name-only` that no forbidden files were modified).
3. The `MEMORY.md` and hypothesis instructions injected into the coding agent's context explicitly list forbidden paths.

### 5.3 Branching Strategy

```
main (current best state)
  │
  ├── hyp/001-add-calculator-tool      ← accepted, merged
  ├── hyp/002-improve-system-prompt    ← accepted, merged
  ├── hyp/003-add-caching             ← rejected, deleted
  └── hyp/004-add-derivative-solver   ← accepted, merged
```

- Each hypothesis creates a branch from `main` in the target repo.
- Accepted hypotheses are merged into `main` (fast-forward or squash).
- Rejected hypotheses' branches are deleted.
- This gives a clean git history of successful improvements.

## 6. Job Folder Structure

### 6.1 Directory Layout

```
jobs/
  job-2026-03-21-math-agent/
    job.md                          # Job config (from template)
    MEMORY.md                       # Shared learnings (injected into coding agent)
    results.db                      # node:sqlite — structured eval data
    final-report.md                 # Generated at end of job
    hypotheses/
      001-add-calculator-tool/
        hypothesis.md               # What we're testing and why
        report.md                   # Results, metrics, decision
        human-intervention.md       # (optional) Things the agent couldn't do
        diff.patch                  # Git diff of changes made
      002-improve-system-prompt/
        hypothesis.md
        report.md
        diff.patch
      003-add-caching/
        hypothesis.md
        report.md                   # Status: REJECTED
        diff.patch
```

### 6.2 Job Config Template (`job.md`)

The human creates this file before triggering a job. It defines everything the orchestrator needs to know about the target repo and this optimization run.

```markdown
# Job: Improve math agent accuracy

## Objective
Improve the target agent's accuracy on the golden dataset of math NL queries.
Focus on arithmetic and algebra first, then calculus.

## Target Repository
- **Path**: ../target-agent
- **Branch to start from**: main

## Eval Command
<!-- The command the orchestrator runs to evaluate the target agent -->
```
npm run eval -- --output json
```

## Optimization Target
- **Primary metric**: accuracy (maximize)
- **Secondary constraints**:
  - latency_avg_ms: max 20% regression
  - cost_usd: max 50% regression

## Constraints
<!-- Files/directories the coding agent CANNOT modify -->
- evals/
- golden-dataset.json
- package-lock.json

## Max Hypotheses
10

## Additional Context
<!-- Any extra info the coding agent should know -->
The agent uses Mastra framework. Tools are in src/tools/.
The system prompt is in src/prompt.ts.
```

### 6.3 MEMORY.md Structure

```markdown
# Job Memory

## Current Metrics
- Accuracy: 0.72 (36/50)
- Avg latency: 1100ms
- Cost: $0.035

## What Works
- Adding dedicated tools for specific math categories (calculator tool: +27% accuracy)
- Keeping the system prompt concise (<1000 tokens)

## What Doesn't Work
- Generic "try harder" prompt changes (no measurable impact)
- Adding caching at the tool level (breaks stateless assumptions)

## Known Blockers
- Integration questions require an external CAS library — not yet installed

## Human Intervention Needed
- Hypothesis 003 identified that a Wolfram Alpha API key would unlock integration solving
```

### 6.4 Hypothesis Record Schema

Each hypothesis folder contains a `report.md` with structured results. The same data is also stored in `results.db` for querying.

```json
{
  "hypothesis_id": "001-add-calculator-tool",
  "job_id": "job-2026-03-21-math-agent",
  "timestamp": "2026-03-21T14:30:00Z",
  "statement": "Adding a dedicated calculator tool will improve accuracy on arithmetic questions",
  "category_targeted": "arithmetic",
  "changes": [
    {
      "file": "src/tools/calculator.ts",
      "action": "created",
      "summary": "New tool that evaluates arithmetic expressions"
    },
    {
      "file": "src/agent.ts",
      "action": "modified",
      "summary": "Registered calculator tool in agent config"
    }
  ],
  "metrics_before": {
    "accuracy": 0.45,
    "latency_avg_ms": 1200,
    "cost_usd": 0.03
  },
  "metrics_after": {
    "accuracy": 0.72,
    "latency_avg_ms": 1100,
    "cost_usd": 0.035
  },
  "decision": "accepted",
  "reasoning": "Accuracy improved by 27 percentage points. Latency decreased. Cost slightly increased but within threshold.",
  "human_intervention_needed": null
}
```

## 7. Target Agent (Mastra) Structure

The target agent is a standard Mastra TypeScript project:

```
target-agent/
  src/
    agent.ts              # Agent definition and configuration
    prompt.ts             # System prompt (modifiable by coding agent)
    tools/                # Tool definitions (modifiable, new ones can be added)
      index.ts
    utils/                # Helper functions
  evals/                  # IMMUTABLE — cannot be modified by the system
    runner.ts             # Eval execution logic
    golden-dataset.json   # The golden dataset
    metrics.ts            # Metric calculation
  package.json
  tsconfig.json
```

### 7.1 Eval Runner Interface

The orchestrator calls the eval runner via CLI:

```bash
# Run all evals and output results as JSON
cd target-agent && npm run eval -- --output json

# Output:
{
  "timestamp": "2026-03-21T14:30:00Z",
  "results": [
    {
      "id": "math-001",
      "input": "What is 2 + 2?",
      "expected": "4",
      "actual": "4",
      "pass": true,
      "latency_ms": 850,
      "cost_usd": 0.001
    }
  ],
  "summary": {
    "total": 50,
    "passed": 36,
    "failed": 14,
    "accuracy": 0.72,
    "latency_avg_ms": 1100,
    "latency_p95_ms": 2300,
    "cost_usd": 0.035
  }
}
```

## 8. Orchestrator Design

### 8.1 Configuration

Configuration is defined per-job in `job.md` (see section 6.2). There is no global config file — each job is self-contained.

The orchestrator CLI reads the job folder path and loads everything from there:

```bash
npx auto-agent run --job job-2026-03-21-math-agent
```

This loads `jobs/job-2026-03-21-math-agent/job.md` and uses it to determine:
- Target repo path and starting branch
- Eval command to run
- Primary/secondary metrics and thresholds
- Forbidden file paths
- Max number of hypotheses

### 8.2 Orchestrator Modules

| Module | Responsibility |
|--------|---------------|
| `JobLoader` | Reads `job.md`, initializes job folder, MEMORY.md, and results.db |
| `BaselineRunner` | Runs eval command on current state, establishes metrics baseline |
| `Analyzer` | Reads eval failures + MEMORY.md, identifies improvement areas |
| `Hypothesizer` | Generates ranked hypotheses for what to try next |
| `HypothesisRunner` | Creates branch, invokes coding agent, runs evals, makes accept/reject decision |
| `CodingAgentBridge` | Interfaces with Claude Code — injects MEMORY.md, constraints, and hypothesis context |
| `MemoryManager` | Reads/writes MEMORY.md; invokes summarizer agent after each hypothesis |
| `Reporter` | Generates per-hypothesis reports and final-report.md |
| `GitManager` | Handles branching, merging, and rollback in the target repo |
| `SqliteStore` | Manages `results.db` via `node:sqlite` — eval results, metrics, hypothesis metadata |

### 8.3 Coding Agent Invocation

The orchestrator constructs a prompt for the coding agent that includes:

```
You are improving a Mastra-based TypeScript agent. Your goal for this hypothesis:

**Hypothesis**: {hypothesis_statement}
**Target metric**: Improve {metric} (currently {current_value})
**Failing eval cases**: {list of failing cases with inputs/expected/actual}

--- MEMORY.md (injected from job) ---
{contents of jobs/<job-id>/MEMORY.md}
--- END MEMORY.md ---

**Rules**:
1. You may modify any file EXCEPT those listed as forbidden below
2. Forbidden paths: {list from job.md constraints}
3. You may add new npm dependencies if needed
4. You may add new tools, update the system prompt, or refactor agent logic
5. When done, ensure the project builds (npm run build) and tests pass (npm test)
6. If you identify an improvement you CANNOT execute (missing API key,
   needs external setup, requires changing a forbidden file), write a
   human-intervention.md file explaining what's needed and why

**Working directory**: {target_repo_path} (on branch hyp/{hypothesis_id})
```

## 9. Acceptance Criteria for Hypotheses

A hypothesis is **accepted** if ALL of the following are true:

1. The target agent builds successfully (`npm run build` exits 0).
2. The primary metric improved (e.g., accuracy went up).
3. No secondary metric regressed beyond its configured threshold (from job.md).
4. No forbidden files were modified (verified via `git diff --name-only` against job.md constraints).
5. The coding agent did not introduce obvious issues (build errors, test failures).

A hypothesis is **rejected** if ANY of the above fail. Either way, the result is recorded in the hypothesis folder and MEMORY.md is updated.

## 10. Report Format

### 10.1 Per-Hypothesis Report (`hypotheses/<id>/report.md`)

```markdown
## Hypothesis 003: Add derivative solver tool

**Statement**: Adding a symbolic math tool will improve accuracy on calculus questions.
**Branch**: hyp/003-add-derivative-solver
**Status**: ACCEPTED

### Changes
- Created `src/tools/derivative-solver.ts` — symbolic differentiation using mathjs
- Modified `src/agent.ts` — registered new tool
- Modified `src/prompt.ts` — added instruction to use derivative solver for calculus

### Metrics
| Metric       | Before | After  | Change |
|-------------|--------|--------|--------|
| accuracy    | 0.72   | 0.84   | +16.7% |
| latency_avg | 1100ms | 1250ms | +13.6% |
| cost_usd    | $0.035 | $0.041 | +17.1% |

### Eval Breakdown
- arithmetic: 20/20 (unchanged)
- calculus: 12/15 (was 6/15, +6)
- algebra: 10/15 (unchanged)
```

### 10.2 Final Job Report (`final-report.md`)

```markdown
# Job: job-2026-03-21-math-agent — Final Report

**Objective**: Improve math agent accuracy (from job.md)
**Duration**: 45 minutes
**Hypotheses**: 5 (3 accepted, 2 rejected)

## Net Improvement
| Metric       | Start  | End    | Change  |
|-------------|--------|--------|---------|
| accuracy    | 0.45   | 0.88   | +95.6%  |
| latency_avg | 1200ms | 1300ms | +8.3%   |
| cost_usd    | $0.030 | $0.045 | +50.0%  |

## Accepted Hypotheses
1. **001**: Added calculator tool (+27% accuracy)
2. **002**: Improved system prompt (+4% accuracy)
3. **004**: Added derivative solver (+16.7% accuracy)

## Rejected Hypotheses
1. **003**: Added caching layer (broke build)
2. **005**: Prompt chain-of-thought (no accuracy change, +40% latency)

## Human Intervention Needed
- **003**: Wolfram Alpha API key needed to unlock integration solving
- **005**: Consider increasing timeout limit in eval runner config

## Remaining Failures
- math-042: "Solve x^2 + 3x + 2 = 0" — agent returns approximate instead of exact roots
- math-048: "What is the integral of sin(x)?" — agent times out

## Recommendations for Next Job
- Add an equation solver tool for algebraic equations
- Investigate timeout on integration problems (may need streaming or async)
```

## 11. Progressive Difficulty Strategy

The golden dataset is designed with increasing difficulty tiers:

| Tier | Examples | Expected Starting Accuracy |
|------|----------|---------------------------|
| 1 — Basic arithmetic | 2+2, 10*5, 100/4 | ~0% (no tools yet) |
| 2 — Complex arithmetic | 15% of 240, √144 | ~0% (needs calculator tool) |
| 3 — Algebra | Solve 2x+3=7, factor x²-4 | ~0% (needs algebra tool) |
| 4 — Calculus | d/dx(x³), ∫x dx | ~0% (needs calculus tool) |
| 5 — Multi-step | "A train leaves at..." | ~0% (needs reasoning chain) |

The analyzer should prioritize lower tiers first — no point attempting calculus if basic arithmetic doesn't work yet.

## 12. CLI Interface

The system is a TypeScript CLI. The human triggers jobs manually.

```bash
# 1. Create a new job (scaffolds folder with templates + SQLite db)
npm run create-job -- --id my-math-agent
# → Creates jobs/my-math-agent/ with JOB.md, MEMORY.md, hypotheses/, results.db

# 2. Human fills in JOB.md and optionally seeds MEMORY.md

# 3. Run the optimization job
npm run run-job -- --id my-math-agent

# Run with max hypotheses override
npm run run-job -- --id my-math-agent --max-hypotheses 5

# View job status / results
npm run job-status -- --id my-math-agent

# List all jobs
npm run list-jobs
```

## 13. Error Handling and Safety

| Scenario | Handling |
|----------|----------|
| Coding agent produces code that doesn't compile | Hypothesis rejected. Error stored in MEMORY.md for future context. |
| Coding agent modifies forbidden files | Hypothesis rejected. Violation logged in MEMORY.md. Agent re-instructed on next hypothesis. |
| Coding agent exceeds turn limit | Hypothesis rejected. Partial work discarded. |
| Eval runner crashes | Hypothesis rejected. Crash log stored. Orchestrator continues to next hypothesis. |
| All hypotheses rejected | Job ends. Final report highlights that no progress was made and lists all failure reasons. |
| Target repo has uncommitted changes | Loop aborted with warning. User must commit or stash first. |
| Coding agent introduces security vulnerability | Out of scope for v1. Future: add static analysis check. |

## 14. Tech Stack

| Component | Technology |
|-----------|-----------|
| Orchestrator | TypeScript CLI (Node.js) |
| Target Agent | Mastra (TypeScript) |
| Coding Agent | Claude Code (CLI) or Claude API with tool use |
| Eval Runner | Custom (runs in target repo via command from job.md) |
| Structured Storage | `node:sqlite` (built-in, per-job `results.db`) |
| Human-readable Storage | Markdown + JSON files (job.md, MEMORY.md, reports, hypotheses) |
| Git Operations | `simple-git` npm package or shell commands |
| Process Management | Node.js `child_process` |

## 15. MVP Scope

For the first working version:

**In scope**:
- Single optimization metric (accuracy).
- Golden dataset with math NL queries (tiers 1-3).
- Job folder structure with MEMORY.md, hypotheses, and `node:sqlite` storage.
- Job config via `job.md` template (objective, constraints, eval command).
- Claude Code as the coding agent (invoked via CLI).
- MEMORY.md injection into coding agent context.
- Human intervention needed mechanism.
- Git branching and merge/rollback.
- Per-hypothesis and final reports.
- CLI trigger (`npx auto-agent run --job <id>`).

**Out of scope (v2+)**:
- Multi-metric optimization with Pareto frontiers.
- Parallel trial execution.
- Web dashboard for monitoring.
- Automatic golden dataset generation.
- Security/vulnerability scanning of generated code.
- Cost budgets per loop.

## 16. Success Criteria

The system is considered working when:

1. Starting from a baseline Mastra agent with 0% accuracy on a 20-item math golden dataset...
2. After a single optimization loop (max 10 trials)...
3. The agent achieves ≥80% accuracy...
4. With a clean git history showing only accepted improvements...
5. And a final report that accurately describes what happened.

## 17. Open Questions

1. **Coding agent choice**: Should we use Claude Code CLI (spawns a subprocess) or the Claude API with tool use (more control but more code to write)?
2. **Eval comparison strategy**: Should we compare to the original baseline or to the previous trial's result? (Recommendation: compare to the latest accepted state, not the original baseline.)
3. **Partial improvements**: If accuracy improves on tier 1 but regresses on tier 2, is that accepted? (Recommendation: accept if net accuracy improves; flag regressions in the report.)
4. **Memory pruning**: How aggressively should we prune old trial memory? (Recommendation: keep summaries forever, prune full diffs after 30 days.)
5. **Concurrent loops**: Can the human trigger a new loop while one is running? (Recommendation for v1: reject with a message. Only one loop at a time.)
