# A/B Testing Plan: Claude vs Kiro Provider Quality

## Goal

Compare the quality of Claude Code CLI vs Kiro CLI as auto-agent backends across **coding, data science, research, sysadmin, workflow automation, and scientific reasoning** tasks.

---

## Part A: Coding Benchmarks

### Tier 1: Best fit for auto-agent's JOB.md model

#### 1. Aider Polyglot Benchmark (START HERE for coding)

- **Repo**: [Aider-AI/polyglot-benchmark](https://github.com/Aider-AI/polyglot-benchmark)
- **What**: 225 Exercism exercises across 6 languages (C++, Go, Java, JS, Python, Rust). Agent edits a file, tests determine pass/fail. Two attempts per problem (second sees test output).
- **Why it fits**: Closest match to auto-agent. Each exercise = a target repo with tests. The agent edits code, tests run, pass/fail → accuracy.
- **Metrics**: `accuracy = exercises_passed / total`, plus cost and edit-format success rate.
- **License**: Apache-2.0 (aider), MIT (exercises)
- **Integration effort**: **Low-Medium**
- **Run time**: ~2-4 hours for 225 exercises per provider

#### 2. SWE-bench Verified

- **Repo**: [SWE-bench/SWE-bench](https://github.com/SWE-bench/SWE-bench)
- **What**: 500 real GitHub issues from popular Python repos (Django, scikit-learn, etc.). Agent produces a patch, eval checks if failing tests now pass.
- **Why it fits**: Industry gold standard. Tests full agent loop: read issue → explore repo → edit code → verify fix.
- **Metrics**: `accuracy = resolved / total`
- **License**: MIT
- **Integration effort**: **Medium**. Requires Docker.
- **Run time**: ~8-24 hours for 500 instances per provider

#### 3. SWE-bench Lite

- Same as above but 300 instances. Good for faster iteration.

### Tier 2: Supplementary coding signals

| Benchmark | Repo | What | License |
|-----------|------|------|---------|
| EvalPlus | [evalplus/evalplus](https://github.com/evalplus/evalplus) | 164 function-completion problems, 80x more tests | Apache-2.0 |
| BigCodeBench | [bigcode-project/bigcodebench](https://github.com/bigcode-project/bigcodebench) | 1,140 practical tasks across 139 libraries | Apache-2.0 |
| LiveCodeBench | [LiveCodeBench/LiveCodeBench](https://github.com/LiveCodeBench/LiveCodeBench) | 880+ competitive programming, contamination-free | Apache-2.0 |

---

## Part B: Non-Coding Benchmarks

### General Assistant / Research

#### 4. GAIA (General AI Assistants) — START HERE for non-coding

- **Repo**: Dataset on [HuggingFace](https://huggingface.co/gaia-benchmark); eval via [HAL harness](https://github.com/princeton-pli/hal-harness)
- **What**: ~450 real-world questions requiring web browsing, file reading, multi-step reasoning, tool use. 3 difficulty levels. Human baseline: 92%, best agent: ~75%.
- **Why it fits**: Gold standard for general assistant comparison. Same question → compare answers. Exact-match string scoring.
- **Metrics**: accuracy (exact match against gold answer)
- **License**: CC BY 4.0
- **Integration effort**: **Low**. Each task is a question + optional attached file. Eval is string match.
- **Run time**: ~2-6 hours for 450 questions per provider

### CLI / System Administration

#### 5. Terminal-Bench 2.0

- **Repo**: [laude-institute/terminal-bench](https://github.com/laude-institute/terminal-bench)
- **What**: 89 hard, realistic terminal tasks — configuring legacy systems, scientific computing, ML pipelines, sysadmin. Each task has a containerized environment + automated tests + reference solution.
- **Why it fits**: Literally designed for comparing CLI agents. Already follows the "target env + eval script" pattern. Top score is 52%.
- **Metrics**: task completion rate (pass/fail per task)
- **License**: Apache-2.0
- **Integration effort**: **Low**. Already supports Claude Code natively. Just need to add Kiro adapter.
- **Run time**: ~2-4 hours for 89 tasks per provider

### Workflow Automation / Multi-App

#### 6. AppWorld

- **Repo**: [StonyBrookNLP/appworld](https://github.com/StonyBrookNLP/appworld)
- **What**: 750 tasks across 9 simulated apps (Amazon, Spotify, etc.) with 457 APIs. Tasks require chaining multiple apps, complex control flow, iterative interaction.
- **Why it fits**: Fully local, deterministic, programmatic eval. State-based unit tests check correctness + collateral damage. GPT-4o solves ~49%.
- **Metrics**: task accuracy, collateral damage rate
- **License**: MIT
- **Integration effort**: **Low-Medium**. `pip install appworld`. HAL harness integration exists.
- **Run time**: ~4-8 hours for 750 tasks per provider

#### 7. tau2-bench (Customer Service)

- **Repo**: [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench)
- **What**: Multi-turn customer service dialogues in airline, retail, banking, telecom. Agent must use domain APIs, follow policies, handle unpredictable user behavior.
- **Why it fits**: Built for agent comparison. Simulated users = fully reproducible. CLI: `tau2 run --domain airline --agent-llm <model>`.
- **Metrics**: pass^k reliability metric (stricter than pass@k)
- **License**: MIT
- **Integration effort**: **Low**. Native CLI.
- **Run time**: ~1-3 hours per domain per provider

### Data Science / SQL

#### 8. InfiAgent-DABench

- **Repo**: [InfiAgent/InfiAgent](https://github.com/InfiAgent/InfiAgent)
- **What**: 603 data analysis questions over 124 CSV files. Agent writes + executes Python to answer questions about real datasets.
- **Why it fits**: Agent gets CSV + question, must produce correct answer. Closed-form exact-match eval.
- **Metrics**: accuracy (exact match)
- **License**: Apache-2.0
- **Integration effort**: **Medium**. Docker sandbox for code execution.

#### 9. Spider 2.0 (Enterprise SQL)

- **Repo**: [xlang-ai/Spider2](https://github.com/xlang-ai/Spider2)
- **What**: 632 enterprise text-to-SQL workflow problems. Multi-step reasoning, not just single SQL generation.
- **Metrics**: execution accuracy
- **License**: Apache-2.0
- **Integration effort**: **Medium**. Local DB subset works without cloud credentials.

### Scientific Reasoning / ML Research

#### 10. CORE-Bench

- **Repo**: [siegelz/core-bench](https://github.com/siegelz/core-bench)
- **What**: 270 tasks from 90 scientific papers (CS, social science, medicine). Agent navigates code repos, installs deps, runs experiments, answers questions about results.
- **Why it fits**: Containerized, reproducible. Best agent: 21% on hard tasks. HAL-integrated.
- **Metrics**: accuracy per difficulty level
- **License**: MIT
- **Integration effort**: **Medium**. Docker containers.

#### 11. MLAgentBench

- **Repo**: [snap-stanford/MLAgentBench](https://github.com/snap-stanford/MLAgentBench)
- **What**: End-to-end ML experimentation — agent gets dataset + task description, must develop/improve ML model autonomously.
- **Why it fits**: Already uses the "target directory + eval script" pattern natively. Each task = `benchmarks/<name>/env/` + `script/eval.py`.
- **Metrics**: task-specific (e.g., model accuracy improvement)
- **License**: MIT
- **Integration effort**: **Low**. Already matches auto-agent's pattern.

#### 12. MLE-bench

- **Repo**: [openai/mle-bench](https://github.com/openai/mle-bench)
- **What**: 75 Kaggle ML competitions. Lite split = 22 competitions.
- **Metrics**: medal-based scoring (bronze/silver/gold)
- **License**: MIT
- **Integration effort**: **Medium**. Needs Kaggle data download.

### Tool Use / Function Calling

#### 13. Berkeley Function Calling Leaderboard (BFCL V4)

- **Repo**: [ShishirPatil/gorilla](https://github.com/ShishirPatil/gorilla/tree/main/berkeley-function-call-leaderboard)
- **What**: Function calling across serial/parallel invocations, multi-turn agentic scenarios, web search with multi-hop reasoning.
- **Metrics**: AST-based accuracy + cost + latency
- **License**: Apache-2.0
- **Integration effort**: **Low-Medium**.

---

## Meta-Harness: HAL (Holistic Agent Leaderboard)

- **Repo**: [princeton-pli/hal-harness](https://github.com/princeton-pli/hal-harness)
- **What**: Unified evaluation harness wrapping 11+ benchmarks (SWE-bench, GAIA, CORE-bench, AppWorld, tau-bench, USACO, etc.) into a single CLI.
- **Why it matters**: Write one agent adapter per CLI tool, sweep across all benchmarks with `hal-eval`. Outputs `_UPLOAD.json` per run. ICLR 2026.
- **License**: MIT
- **Recommendation**: Use HAL as the runner for benchmarks 4, 6, 7, 10 above. Saves significant integration work.

---

## A/B Test Design

### Recommended Benchmark Suite (5 benchmarks, 5 categories)

| # | Benchmark | Category | Tasks | Signal |
|---|-----------|----------|-------|--------|
| 1 | Aider Polyglot | Coding | 225 | Code editing across 6 languages |
| 2 | GAIA | General assistant | 450 | Research, reasoning, tool use |
| 3 | Terminal-Bench | CLI/Sysadmin | 89 | Real terminal tasks |
| 4 | AppWorld | Workflow automation | 750 | Multi-app tool chaining |
| 5 | MLAgentBench | ML/Data science | ~13 | End-to-end ML experimentation |

Total: ~1,527 tasks across 5 categories. This gives broad coverage without being unmanageable.

### Execution Flow

```
┌─────────────────────────────────────────────────┐
│  For each provider in [claude, kiro]:            │
│    For each benchmark in suite:                  │
│      1. Reset environment to clean state         │
│      2. Run all tasks through the provider       │
│      3. Collect structured metrics (JSON)        │
│      4. Record: accuracy, duration, cost         │
│                                                  │
│  Compare providers across all dimensions:        │
│    - Per-benchmark accuracy                      │
│    - Per-category accuracy                       │
│    - Aggregate score (weighted or unweighted)    │
│    - Cost efficiency (accuracy per dollar)       │
│    - Speed (accuracy per hour)                   │
└─────────────────────────────────────────────────┘
```

### Dimensions to Measure

| Dimension | Metric | How |
|-----------|--------|-----|
| Coding accuracy | % exercises/issues resolved | Aider Polyglot + SWE-bench |
| General reasoning | % questions correct | GAIA |
| Terminal competence | % tasks completed | Terminal-Bench |
| Workflow accuracy | % tasks correct | AppWorld |
| ML engineering | improvement over baseline | MLAgentBench |
| Speed | wall-clock per task | timestamp deltas |
| Cost | API spend per benchmark | sum from provider logs |
| Reliability | variance across 3 runs | std dev of accuracy |

### Phase 1: Quick signal (1-2 days)

Run these three — they're the fastest to set up and give broadest coverage:
1. **Aider Polyglot** (coding, 225 tasks, ~3 hrs/provider)
2. **GAIA** (general, 450 tasks, ~4 hrs/provider)
3. **Terminal-Bench** (CLI, 89 tasks, ~3 hrs/provider)

### Phase 2: Deep dive (3-5 days)

Add these for fuller picture:
4. **AppWorld** (workflow, 750 tasks)
5. **SWE-bench Verified** (coding gold standard, 500 tasks)
6. **MLAgentBench** (ML/data science)

### Phase 3: auto-agent optimization loop

Use auto-agent itself as the final benchmark:
1. Pick a toy agent problem (e.g., a math agent scoring 30% on a golden dataset)
2. Run `npm run run-job` with each provider for 10 iterations
3. Compare convergence curves using the accuracy-chart skill

---

## Implementation Roadmap

### Step 1: HAL Harness setup

1. `pip install hal-harness`
2. Write two agent adapters: `claude-agent/main.py` and `kiro-agent/main.py`
3. Each adapter: receives task → invokes the CLI tool → returns submission
4. This unlocks GAIA, AppWorld, tau-bench, CORE-bench via a single harness

### Step 2: Aider Polyglot adapter

1. Clone `Aider-AI/polyglot-benchmark`
2. Write `eval-exercises.ts` wrapper
3. Create JOB.md pointing at the benchmark repo

### Step 3: Terminal-Bench adapter

1. `pip install terminal-bench`
2. Write thin wrapper that invokes each CLI tool via `tb run`
3. Aggregate results to JSON

### Step 4: MLAgentBench adapter

1. Clone `snap-stanford/MLAgentBench`
2. Already uses "target directory + eval script" — minimal wrapping needed

### Step 5: Head-to-head runs

1. Run full suite with Claude
2. Run full suite with Kiro
3. Generate comparison report

---

## Statistical Considerations

- **Sample size**: Suite total (~1,527 tasks) is more than sufficient for statistical significance.
- **Variance**: Run each benchmark 2-3 times per provider to measure non-determinism.
- **Significance**: Use McNemar's test for paired pass/fail, Wilcoxon signed-rank for continuous metrics.
- **Cost control**: Start with Phase 1 (764 tasks). Only expand if results are close.
- **Confounds**: Same model temperature, same system prompts. Only variable = CLI tool.
- **Stratified analysis**: Report per-category scores, not just aggregate, to find category-specific strengths.

---

## Sources

### Coding
- [Aider-AI/polyglot-benchmark](https://github.com/Aider-AI/polyglot-benchmark)
- [SWE-bench/SWE-bench](https://github.com/SWE-bench/SWE-bench)
- [evalplus/evalplus](https://github.com/evalplus/evalplus)
- [bigcode-project/bigcodebench](https://github.com/bigcode-project/bigcodebench)
- [LiveCodeBench/LiveCodeBench](https://github.com/LiveCodeBench/LiveCodeBench)

### Non-Coding
- [GAIA benchmark (HuggingFace)](https://huggingface.co/gaia-benchmark)
- [laude-institute/terminal-bench](https://github.com/laude-institute/terminal-bench)
- [StonyBrookNLP/appworld](https://github.com/StonyBrookNLP/appworld)
- [sierra-research/tau2-bench](https://github.com/sierra-research/tau2-bench)
- [InfiAgent/InfiAgent](https://github.com/InfiAgent/InfiAgent)
- [xlang-ai/Spider2](https://github.com/xlang-ai/Spider2)
- [siegelz/core-bench](https://github.com/siegelz/core-bench)
- [snap-stanford/MLAgentBench](https://github.com/snap-stanford/MLAgentBench)
- [openai/mle-bench](https://github.com/openai/mle-bench)
- [ShishirPatil/gorilla (BFCL)](https://github.com/ShishirPatil/gorilla)

### Meta-Harness
- [princeton-pli/hal-harness](https://github.com/princeton-pli/hal-harness)
