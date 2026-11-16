# suschatt-flow

A Claude Code mod for subagent-based delivery. The session acts as the **orchestrator**: it understands the task, plans it, owns all design decisions, writes a self-contained brief for each piece of work, hands the pieces to **tiered worker subagents**, and reviews what comes back as a skeptical reviewer would. You choose which model runs the orchestrator and which runs each worker tier, in the prompt, per run.

The process is modelled on savvy-flow by johnnyvizz (MIT), rewritten with four tiers, prompt-level model picks and briefs structured along Anthropic's prompting guidance for subagents.

## Quick start

```
/suschatt-flow -help
/suschatt-flow orch=opus:high workers=sonnet:medium <task>
```

## Commands

| Command | What it does |
|---|---|
| `/suschatt-flow orch=M:E workers=M:E [tier=M:E ...] <task>` | Starts a run (M = model, E = effort). Picks come first; the first word that is not a pick starts the task. `orch=` and `workers=` are required (naming all four tiers also covers `workers=`), and every pick needs an effort. If anything is missing, nothing starts: the line lands in the prompt box with defaults filled in and **highlighted** (orch = your session's model family, workers = `sonnet`, effort = `medium`), and the reply lists what was missing. Edit, then press Enter. A misspelled role such as `worker=` is accepted as `workers=`; any other unknown role is an error. A run replaces the previous run's picks. |
| `/suschatt-flow [role=model ...] -r <brain dump>` | Rewrites a messy dump into a structured prompt and puts it in the prompt box for you to review. Nothing runs until you press Enter. See [Refining a brain dump](#refining-a-brain-dump). |
| `/suschatt-flow role=model ...` | Changes picks mid-run, merged into the current ones. |
| `/suschatt-flow` | Shows the current picks. |
| `/suschatt-flow agents` | Opens the subagents pane beside the chat (see [Subagents pane](#subagents-pane)). It also opens by itself when a run starts its first worker. |
| `/suschatt-flow off` | Clears all picks; tier defaults apply. |
| `/suschatt-flow -help` | Usage, roles and sample prompts (`--help`, `-h`, `help` also work). |
| `/suschatt-flow:flow [role=model ...] <task>` | The underlying skill; same behaviour as starting a run. |

## Roles and defaults

| Role | Who | Default model | Gets tasks like |
|---|---|---|---|
| `orch` | The session itself: plans, designs, briefs, reviews | the session's model | — |
| `deep` | Worker | opus, xhigh effort | Unclear root cause, unfamiliar or messy code, non-obvious architecture: insight needed |
| `careful` | Worker | opus, high effort | Clear approach but delicate execution: multi-file refactors, invariants, many edge cases |
| `standard` | Worker | sonnet, medium effort | Standard features, bugs with a known cause, a few files |
| `quick` | Worker | haiku | Renames, boilerplate, config, running builds and tests |
| `workers` | Fallback | — | Applies to every tier you do not name |

Models: `sonnet`, `opus`, `haiku`, `fable`, or a full `claude-…` model id. Efforts: `low`, `medium`, `high`, `xhigh`, `max`, written after a colon: `orch=opus:high`. A run without an effort on a pick gets `medium` suggested (highlighted, editable). A worker tier you do not name runs on the `workers=` model and effort; the defaults in the table apply only to a pick changed mid-run without an effort.

Precedence for a worker: its own tier pick, then `workers`, then the agent file's default.

## How a run goes

1. **Understand.** The orchestrator reads the code the task touches, then restates your task as a brief (Goal, Context, Constraints, Done when, Verify with, Out of scope, Parallel) with real paths filled in from the code. It asks, in one batch, only if the request could still mean materially different work. A rough brain dump works here too. An empty folder triggers the new-project path: `docs/PLAN.md` and a short `CLAUDE.md` are written and approved before anything is built.
2. **Plan.** Tasks with briefs, dependencies and a tier each, shown to you compactly.
3. **Design.** Anything user-visible is decided by the orchestrator and written into briefs as concrete specs. Workers never invent UI.
4. **Delegate.** Independent tasks run in parallel; dependent ones are chained. Each brief follows: Goal and why, Context (paths, what was ruled out), Constraints, Done when, Verify with, Out of scope, Report format.
5. **Review.** The orchestrator reads the diffs, not just the reports, reruns verification, and accepts, returns with a defect list (at most twice), or fixes trivial things itself.
6. **Close.** A report of what changed, how it was verified, what was left out, and which tiers ran on which models.

The status line shows the picks and progress, for example `suschatt-flow [delegate] 2/5 | orch=opus:high workers=sonnet:medium`.

## Subagents pane

A panel beside the chat shows every worker of the current run as a card:

```
2 subagents in this chat
orchestrator · opus · effort: high · delegating · 1/2 accepted

Tokens        Time          Agents
1.2M          02:41         1 running

 ▾ Running · 1                                  (green bar)
  ▟██▙   Motion graphics                      ●
         deep · fable-5-5:xhigh · 02:41
         34.5k tokens · 4.5k out
         ◐ Step 4/6 · Writing the storyboard
           Sketching the opening scene
           Listing 8 scenes
         ────────────────────────────────────
 ▾ Finished · 1                                 (yellow bar)
  ▟██▙   Research                             ✓
         standard · sonnet-5-5:medium · 01:12
         1.2M tokens · 150.0k out
         Done · 6 steps
           Reading r/ClaudeAI threads
           Wrote research.md
         ────────────────────────────────────
```

- **Header:** how many subagents ran, the orchestrator's model and effort (the real session model when no `orch=` was picked) with its phase and accepted count, then totals: tokens used by the workers, elapsed time, and how many are running.
- **Running / Finished:** coloured section bars with counts. Click a bar (or focus it and press Enter) to fold or unfold its cards: `▾` open, `▸` folded. The choice is remembered across runs.
- **Each card:** a small pixel critter in the card's own colour, the task, `●` running, `✓` done or `✗` stopped, then tier, model, effort and time. While running: a spinner with `Step n/total` and the current step; when finished: `Done · n steps`. Below that, the two previous steps the worker reported, and an underline in the card's colour.
- **Messages:** appears only when agents send each other a `SendMessage`.

Workers fill in the steps by calling the `mcp__suschatt-flow__step` tool, which their agent files tell them to do. Tokens are counted from every model request each worker makes (input, cache reads and writes, and output), so a card's count grows live while the worker runs; the header shows the total. Cost is not shown because the engine reports no cost figure. The panel opens by itself when a run starts its first worker; `/suschatt-flow agents` opens it any time. It clears when a new run starts.

## Writing a good task

Each worker sees only the brief the orchestrator writes, and the orchestrator can only brief what it knows. Give it what you would give a capable engineer on day one:

- **Goal and why.** The outcome and the reason it matters; the reason guides judgment calls at the edges.
- **Context.** Exact paths, how the relevant code behaves today, what you already tried or ruled out.
- **Constraints.** What must not change, dependencies you will not accept, conventions to keep.
- **Done when.** Observable success criteria, not "make it better".
- **Verify with.** The exact command and what passing looks like.
- **Out of scope.** The neighbouring things to leave alone.
- **Parallelism hints.** Say which parts are independent so they run at the same time.
- **Investigation vs change.** Say "investigate only, change no code" when you want a report.

## Refining a brain dump

Two ways to go from a messy dump to a good prompt:

- **Just send the dump.** The orchestrator restates it as a brief in step 1, filling in real paths from the code. This costs nothing extra and is the better choice when the gaps are things the code answers.
- **`-r` to review first.** `/suschatt-flow orch=opus:high workers=sonnet:medium -r <dump>` sends the dump to Sonnet (low effort, one request, counted in `/cost`). The rewrite comes back as one line in the prompt box: `/suschatt-flow orch=opus Goal: … Context: … Done when: … Open questions: …`. Edit it and press Enter to run it.

What `-r` does and does not do:
- It keeps your identifiers, paths and commands verbatim, and never invents new ones. Anything missing comes back under **Open questions**: answer them in the draft or leave them for the orchestrator.
- It cannot see your code, so it restructures your words but adds no facts.
- Your picks are carried into the draft but not saved, so a run already in progress keeps its models.
- It never overwrites text you typed while it ran. If the prompt box is busy or unavailable, the rewrite is printed as the command's output to copy instead.
- Text inside the dump that tries to instruct the rewriter is treated as data. The output is cleaned of a leading slash command and of leading `role=model` words.

```
/suschatt-flow orch=opus:high workers=sonnet:medium -r loader keeps double inserting since my retry change last week in jobs/retry.py, finance is annoyed, dont touch the schema, tests are in tests/jobs
```
might come back as:
```
/suschatt-flow orch=opus:high workers=sonnet:medium Goal: stop the loader double-inserting rows; finance reports are wrong. Context: started after the retry change in jobs/retry.py last week. Constraints: no schema changes. Verify with: tests in tests/jobs. Open questions: which loader or job; how to reproduce; what counts as done beyond no duplicates?
```

## Sample prompts

Root-cause bug fix, strong investigator:
```
/suschatt-flow orch=opus:high workers=sonnet:medium deep=opus:xhigh Goal: the nightly orders load (jobs/load_orders.py) intermittently double-inserts rows; finance reports overcount. Context: began after the retry change in jobs/retry.py; logs in logs/load_orders/. Constraints: no schema changes; the job must stay idempotent. Done when: root cause explained, a failing test reproduces it, the fix makes it pass. Verify with: pytest tests/jobs. Out of scope: other jobs.
```

Feature with independent parts in parallel, cheaper workers:
```
/suschatt-flow orch=opus:high workers=sonnet:medium careful=opus:high Goal: add CSV and Parquet export to the report CLI (src/cli/report.py) so analysts stop hand-converting JSON. Context: follow the pattern in src/export/json.py. Constraints: pyarrow is installed; add no dependencies. Done when: report --format csv|parquet works, each format has tests, README usage is updated. CSV and Parquet are independent: run them in parallel.
```

Investigation only, strongest model for the hard part:
```
/suschatt-flow orch=opus:high workers=sonnet:medium deep=fable:high Goal: find why p95 latency of /api/search doubled since v2.3. Investigate only; change no code. Report: ranked causes with evidence (file:line, measurements) and a recommended fix per cause.
```

Mechanical change, cheapest setup:
```
/suschatt-flow orch=sonnet:medium workers=haiku:low Rename the config key db_url to database_url across code, tests and docs. Done when: rg db_url finds nothing and the test suite passes.
```

New project:
```
/suschatt-flow orch=opus:high workers=sonnet:medium Goal: a CLI that diffs two Snowflake schemas and prints the DDL to migrate one to the other, for release reviews. Constraints: Python 3.12, snowflake-connector-python, no ORM. Done when: it runs against two schemas from a config file and its tests pass. Ask me what you need before writing the plan.
```

## Things to know

- **Picks persist** until the run closes, `/suschatt-flow off`, or the next run. While `orch` is picked, every message in the session uses that model, not just the flow's.
- **Switching `orch` mid-session drops the prompt cache:** the next request re-reads the conversation at full price.
- **Cost.** Opus workers at high effort, run in parallel, consume tokens quickly. Use `workers=sonnet` or `quick`-heavy plans for routine work.
- **Weak picks.** The orchestrator tiers tasks by the table above; picking `haiku` for `deep` work will under-deliver.

## Files

| Path | Purpose |
|---|---|
| `skills/flow/SKILL.md` | The orchestrator's playbook |
| `agents/{deep,careful,standard,quick}.md` | The worker tiers and their defaults |
| `hooks/register.ts` | `/suschatt-flow` command, model picks, `-r` refiner (its rewrite instructions are `REFINE_SYSTEM`), status tool |
| `hooks/register.test.ts` | Tests: `claude plugin test <mod folder>` |
