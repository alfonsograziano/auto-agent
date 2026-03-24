## Objective

<!-- What is the main goal of this optimization job? Be specific about what "better" means.
     Examples:
     - "Improve accuracy on the math golden dataset from ~20% to 80%+"
     - "Reduce average latency below 500ms while maintaining current accuracy"
     - "Add support for x questions (currently 0% pass rate on that category)"
-->



## Target Repository

<!-- Absolute or relative path to the repo the coding agent will modify.
     Also specify which branch to start from — this is the baseline. -->

- **Path**: ../target-agent
- **Branch**: main

## Provider

<!-- Which CLI agent backend to use: "claude" (default) or "kiro" -->

- **Provider**: claude

## Metrics

<!-- Which metric should the system optimize, and what guardrails apply to other metrics?
     The primary metric determines whether a hypothesis is accepted or rejected.
     Secondary constraints prevent regressions — a hypothesis is rejected if any
     secondary metric regresses beyond its threshold, even if the primary metric improves. -->

- **Primary metric**: accuracy (maximize)
- **Secondary constraints**:
  - latency_avg_ms: max 20% regression
  - cost_usd: max 50% regression

## Scripts

<!-- Commands the orchestrator runs inside the target repo.
     These must exit 0 on success and print results to stdout.
     The eval command MUST output JSON with at least a `summary` object
     containing the metrics listed above. -->

| Script | Command | When it runs |
|--------|---------|--------------|
| Install dependencies | `npm install` | Once at job start |
| Build | `npm run build` | After each hypothesis implementation |
| Run evals | `npm run eval -- --output json` | After each successful build |
| Test | `npm test` | After each successful build (optional) |

## Forbidden Files

<!-- Files and directories the coding agent MUST NOT modify.
     These are enforced by the orchestrator via git diff after each hypothesis.
     Typically: eval files, golden dataset, config that shouldn't change.
     Use glob patterns or exact paths. -->

- `evals/`
- `golden-dataset.json`

## Constraints

<!-- Any rule or limitation the coding agent must respect beyond forbidden files.
     These are injected into the agent's context. Can be hard rules or soft guidelines.
     Examples:
     - "Only use gpt-4o-mini or claude-haiku — no SOTA models"
     - "Do not add external API dependencies that require paid keys"
     - "Do not increase the total number of LLM calls per query beyond 3"
     - "Keep the system prompt under 2000 tokens"
     - "Do not remove or reorder existing tools, only add new ones"
     - "All new code must be in TypeScript, no plain JS files"
     - "Do not change the agent's response format — downstream systems depend on it"
     - "Don't restructure the project layout"
     - "Don't optimize for latency at the expense of accuracy" -->



## Codebase Overview

<!-- Give the coding agent a map of the target repo so it knows where things are.
     What framework is used? Where are the main entry points?
     Where does the agent definition live? Where are tools defined?
     Where is the system prompt? What's the general architecture?
     The more context here, the fewer wasted hypotheses on wrong assumptions. -->



## What the Agent Can Do

<!-- Describe the kinds of changes the coding agent is allowed to make.
     This helps it understand the solution space.
     Examples:
     - Add new tools in src/tools/
     - Modify the system prompt in src/prompt.ts
     - Add npm dependencies
     - Refactor existing handlers
     - Create new utility files in src/utils/ -->



## Starting State

<!-- Describe the current state of the target agent so the coding agent
     has context on what exists vs what needs to be built.
     Examples:
     - "Bare bones agent with no tools — only uses the LLM directly"
     - "Has a calculator tool but no algebra or calculus support"
     - "System prompt is minimal, just says 'You are a math assistant'"
     Include current approximate metrics if known. -->



## Golden Dataset Info

<!-- Describe the golden dataset: where it lives, how many items, what categories,
     what the difficulty spread looks like. The coding agent can read it, but
     this summary helps it prioritize.
     Examples:
     - "50 items: 20 arithmetic, 15 algebra, 15 calculus"
     - "All items have category and difficulty tags"
     - "Located at evals/golden-dataset.json" -->



## Environment & Prerequisites

<!-- Anything the coding agent needs to know about the runtime environment.
     Examples:
     - "Node.js 22+ required (uses node:sqlite)"
     - "Needs OPENAI_API_KEY env var set"
     - "Uses pnpm, not npm"
     - "Runs on macOS, no Docker" -->


## Priority Hints

<!-- Optional: guide the order in which the system tackles problems.
     The analyzer uses these hints to prioritize hypotheses.
     Examples:
     - "Start with basic arithmetic before attempting calculus"
     - "Fix the timeout issues before optimizing accuracy"
     - "System prompt improvements first, then add tools" -->


