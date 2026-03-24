# auto-agent

auto-agent is like [Autoresearch](https://github.com/karpathy/autoresearch), but for AI agents.

This is an example of the system running agains a [test repo](https://github.com/alfonsograziano/auto-agent-demo).

![Example results](public/images/example-results.png)


A self-evolving agent optimization system that autonomously improves a target AI agent's performance through iterative, hypothesis-driven improvements. Given a golden dataset of expected input/output pairs, it runs an optimization loop — analyzing failures, implementing fixes, evaluating results, and accepting or rolling back changes — until the agent meets the desired performance bar.

## How It Works

auto-agent uses a **two-repository architecture**:

- **Orchestrator** (this repo) — controls the optimization loop, manages git branches, injects context, and tracks decisions.
- **Target agent** (separate repo) — the agent being improved. The orchestrator spawns a coding agent ([Claude Code](https://docs.anthropic.com/en/docs/claude-code) or [Kiro CLI](https://kiro.dev/cli/)) inside this repo to analyze and modify its code.



### The Optimization Loop

```mermaid
flowchart TD
    A[Read baseline report + MEMORY.md + JOB.md] --> B[Create git branch for new hypothesis]
    B --> C[Spawn coding agent in target repo with full context]
    C --> D[Agent: analyze failures → implement fix → run eval]
    D --> E[Parse decision from REPORT.md]
    E --> F{Decision?}
    F -->|CONTINUE| G[Keep hypothesis branch as new best]
    F -->|ROLLBACK| H[Discard branch, revert to previous best]
    G --> I{Max iterations reached?}
    H --> I
    I -->|No| A
    I -->|Yes| J[Done]
```

Each iteration produces a **hypothesis** — a single attempt at improvement. The coding agent receives:

- The **baseline evaluation report** (constant reference point)
- **MEMORY.md** (accumulated learnings from all prior hypotheses)
- **JOB.md** (objective, constraints, forbidden files, codebase overview)

After implementing changes and running evals, the agent fills a **REPORT.md** with metrics and a decision: `CONTINUE` (accept) or `ROLLBACK` (reject). Accepted hypotheses become the new baseline for the next iteration.

## Prerequisites

- **Node.js 22+**
- **[Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code)** or **[Kiro CLI](https://kiro.dev/cli/)** installed and authenticated
- **Git** available on PATH
- A **target agent repository** with an eval command that outputs JSON

## Providers

auto-agent supports multiple coding agent backends via a provider abstraction:

| Provider | CLI | Flag |
|----------|-----|------|
| Claude Code | `claude` | `--provider claude` (default) |
| Kiro CLI | `kiro-cli` | `--provider kiro` |

Set the provider in your `JOB.md` under `## Provider`:

```markdown
## Provider
- **Provider**: kiro
```

## Quick Start

```bash
# 1. Clone and install
git clone <repo-url> && cd auto-agent
npm install

# 2. Create a new optimization job
npm run create-job -- --id my-job

# 3. Fill in jobs/my-job/JOB.md with your target repo details
#    (path, eval command, metrics, forbidden files, constraints)

# 4. Run the optimization loop
npm run run-job -- --id my-job
```

The system will automatically run a baseline evaluation on the first run if one doesn't exist yet.

### Try it with the demo agent

To see auto-agent in action, you can use the [auto-agent-demo](https://github.com/alfonsograziano/auto-agent-demo) repo — a Mastra-based math agent with a golden dataset and eval suite ready to go.

```bash
# 1. Clone the demo repo alongside auto-agent
git clone https://github.com/alfonsograziano/auto-agent-demo
cd auto-agent-demo && npm install && cd ..

# 2. Create a job pointing to the demo repo
cd auto-agent
npm run create-job -- --id math-demo

# 3. Edit jobs/math-demo/JOB.md:
#    - Set **Path** to the absolute path of auto-agent-demo
#    - Under Scripts, set the eval command to `npm run experiment:math`

# 4. Run the optimization loop
npm run run-job -- --id math-demo
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run create-job -- --id <job-id>` | Scaffold a new job folder with templates |
| `npm run run-job -- --id <job-id>` | Run the full optimization loop |
| `npm run run-job -- --id <job-id> --max-iterations 10` | Run with a custom iteration limit (default: 5) |
| `npm run generate-changelog -- --job <job-id>` | Generate a CHANGELOG.md summarizing all changes after a job run |
| `npm run generate-changelog -- --job <job-id> --branch <branch>` | Generate changelog using a specific branch as the final state |
| `npm run run-benchmark -- --benchmark <name> --provider <provider>` | Run a benchmark suite against a provider |


## Configuring a Job

After running `create-job`, edit `jobs/<job-id>/JOB.md` to configure:

| Section | Purpose |
|---------|---------|
| **Objective** | What "better" means — the specific goal for this optimization run |
| **Target Repository** | Absolute path and starting branch of the agent repo |
| **Metrics** | Primary metric to optimize + secondary constraints (regression thresholds) |
| **Scripts** | Install, build, eval, and test commands to run in the target repo |
| **Forbidden Files** | Glob patterns the agent must not modify (evals, golden dataset, etc.) |
| **Constraints** | Additional rules (model restrictions, token limits, etc.) |
| **Codebase Overview** | Map of the target repo so the agent knows where things are |
| **Golden Dataset Info** | Size, categories, and difficulty distribution |

## Key Concepts

### MEMORY.md

A shared memory file that persists across hypotheses within a job. The coding agent reads it at the start of each iteration and updates it after finishing. It tracks:

- **Current metrics** — accuracy, latency, cost after the latest accepted hypothesis
- **Hypothesis log** — table of all attempts with decisions and impact
- **What works** — successful patterns and strategies
- **What doesn't work** — failed approaches and why they failed
- **Known blockers** — problems that can't be solved within current constraints

This prevents the system from repeating failed strategies and helps it build on successful ones.

### REPORT.md

Each hypothesis produces a report containing:

- What was changed and why (hypothesis statement)
- Before/after metrics comparison
- Detailed failing cases (if any)
- A decision: **`CONTINUE`** (accept changes) or **`ROLLBACK`** (discard changes)

The orchestrator parses this decision to determine whether to keep the hypothesis branch or revert to the previous best.

### Git Branching

Each hypothesis runs on its own git branch created from the current best state. If a hypothesis is accepted (`CONTINUE`), its branch becomes the new best. If rejected (`ROLLBACK`), the orchestrator checks out the previous best branch. This ensures safe, reversible iteration.

### CHANGELOG.md

After a job completes, run `npm run generate-changelog -- --job <job-id>` to generate a summary of all changes. The changelog breaks down the cumulative diff into per-hypothesis sections — each with the problem it solved, accuracy impact, and the actual code diff inline. Rolled-back hypotheses are documented as short paragraphs explaining what was tried and why it failed. A cherry-pick guide lists accepted branches in order (with a caveat that branches build incrementally, so cherry-picking may not apply cleanly).


## Design Principles

- **Human-triggered, machine-driven** — you start the loop; the system runs autonomously until completion.
- **Safe by default** — failed hypotheses are rolled back. The eval suite is immutable. If a decision can't be parsed, the system assumes `ROLLBACK`.
- **Bounded execution** — configurable max iterations prevent runaway costs.
- **Accumulated learning** — MEMORY.md prevents repeating mistakes across iterations and across runs.
- **Zero dependencies** — only Node.js built-ins, keeping the orchestrator minimal and auditable.

## Sponsors

This project is sponsored by [Nearform](https://nearform.com/).

## License

[MIT](LICENSE)
