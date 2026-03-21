# Job Memory

<!-- This file is automatically managed by the orchestrator.
     It is injected into the coding agent's context at the start of every hypothesis.
     After each hypothesis completes, a summarizer agent updates this file
     with learnings from that run.

     You can also edit this manually before starting a job to seed it with
     knowledge you already have (e.g. from prior jobs or your own debugging). -->

## Current Metrics

<!-- Updated after each hypothesis eval run. Shows the latest baseline
     that the next hypothesis will be measured against. -->

| Metric | Value |
|--------|-------|
| accuracy | — |
| latency_avg_ms | — |
| cost_usd | — |

## Hypothesis Log

<!-- One-line summary of each hypothesis and its outcome.
     Gives the coding agent a quick history without reading every report. -->

| # | Hypothesis | Decision | Impact |
|---|-----------|----------|--------|
| — | — | — | — |

## What Works

<!-- Patterns, strategies, and approaches that led to accepted hypotheses.
     Be specific — "added a calculator tool" is better than "added tools".
     Include WHY it worked when possible. -->



## What Doesn't Work

<!-- Approaches that were tried and rejected. Include what went wrong
     so the coding agent doesn't repeat the same mistakes.
     Examples:
     - "Generic prompt changes like 'try harder' had no measurable impact"
     - "Caching at the tool level broke stateless assumptions in the eval runner" -->



## Known Blockers

<!-- Problems that have been identified but cannot be solved by the coding agent
     within its current constraints. These often correspond to human-intervention
     requests from previous hypotheses.
     Examples:
     - "Integration questions need a CAS library but adding native deps is forbidden"
     - "Timeout on complex queries — eval runner hardcodes 5s limit, which is a forbidden file" -->



## Codebase Notes

<!-- Observations about the target repo that are useful across hypotheses.
     Things the coding agent discovered while working that aren't obvious
     from reading the code once.
     Examples:
     - "The agent config in src/agent.ts re-exports tools from src/tools/index.ts — new tools must be registered there"
     - "System prompt is split across src/prompt.ts (base) and src/tools/*.ts (per-tool instructions)"
     - "Eval runner expects JSON output on stdout — anything on stderr is ignored" -->


