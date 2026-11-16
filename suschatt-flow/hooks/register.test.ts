import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { HELP, REFINE_SYSTEM, complete, missing, parse, sanitize, suggestion } from './register'

type On = Parameters<TestBody>[1]
const SHOW = 'Picks: '
const FULL = 'orch=opus:high workers=sonnet:medium'
const typed = (command: string, args: string) => ({
  command,
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 120 },
})
const spawn = (subagentType: string) => ({
  tool_use_id: 't1',
  prompt: 'x',
  description: 'task',
  subagentType,
  provider: { plugin: 'suschatt-flow', tier: 'user' } as const,
  parentModel: 'opus',
  background: false,
  fork: false,
})
const settle = async () => {
  for (let i = 0; i < 500; i++) await Promise.resolve()
}

/** Answers the engine calls the mod makes; returns the status lines it drew. */
function engine(on: On) {
  const status: (string | undefined)[] = []
  const toasts: string[] = []
  on('ui.status', (_, e) => {
    status.push((e as { text?: string }).text)
    return { value: undefined }
  })
  on('ui.toast', (_, e) => {
    toasts.push((e as { text?: string }).text ?? '')
    return { value: undefined }
  })
  on('clock.after', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('clock.now', () => ({ value: 0 }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.register', () => ({ value: { command: 'suschatt-flow' } }))
  on('tool.register', () => ({ value: { tool: 'mcp__suschatt-flow__status' } }))
  return Object.assign(status, { toasts })
}

/** Records runs the mod starts. */
function runs(on: On) {
  const started: string[] = []
  on('command.run', (_, e) => {
    if (e.command === 'suschatt-flow:flow') started.push(e.args)
    return { text: '' }
  })
  return started
}

const usage = { input_tokens: 1, output_tokens: 1, cache_creation_input_tokens: 0, cache_read_input_tokens: 0 }

/** Stubs the rewriter and the prompt box; records what the mod asked, filled and highlighted. */
function box(
  on: On,
  answer: { text: string } | { reason: 'api-error' | 'empty-reply' | 'aborted' } | 'throw' = { text: 'Goal: x' },
  state = { text: '', isFillable: true },
) {
  const seen = { prompt: '', system: '', model: '', filled: [] as string[], marks: [] as string[][] }
  on('model.complete', (_, e) => {
    if (answer === 'throw') throw new Error('model blocked')
    seen.prompt = String(e.prompt)
    seen.system = String(e.system)
    seen.model = e.model
    return 'text' in answer
      ? { value: { isAnswered: true as const, text: answer.text, usage } }
      : { value: { isAnswered: false as const, reason: answer.reason, usage } }
  })
  on('prompt.read', () => ({ value: { text: state.text, cursor: 0 } }))
  on('prompt.fill', (_, e) => {
    if (!state.isFillable) return { isFilled: false, refusal: 'dialog', text: '', cursor: 0 }
    seen.filled.push(e.text)
    seen.marks.push((e.decorations ?? []).map(d => e.text.slice(d.start, d.end)))
    return { isFilled: true, text: e.text, cursor: 0 }
  })
  return seen
}

// ---- pure parsing ----

test('parse takes leading model[:effort] picks and leaves the task verbatim', () => {
  expect(parse('orch=Opus:HIGH workers=sonnet deep=fable:xhigh fix the a=b  bug')).toEqual({
    picks: { orch: 'opus:high', workers: 'sonnet', deep: 'fable:xhigh' },
    rest: 'fix the a=b  bug',
    errors: [],
  })
  expect(parse('build a CLI')).toEqual({ picks: {}, rest: 'build a CLI', errors: [] })
  expect(parse('a=b task').rest).toBe('a=b task') // not a model: ordinary task text
  expect(parse('worker=sonnet orchestrator=opus x').picks).toEqual({ workers: 'sonnet', orch: 'opus' })
  expect(parse('heavy=opus task').errors).toEqual(['"heavy" is not a role (orch, workers, deep, careful, standard, quick)'])
  expect(parse('orch=gpt5 task').errors).toHaveLength(1)
  expect(parse('orch=opus:turbo task').errors).toHaveLength(1)
  expect(parse('quick=claude-haiku-5-5:low').picks).toEqual({ quick: 'claude-haiku-5-5:low' })
})

test('complete fills missing models and efforts with defaults, orch and workers first', () => {
  expect(complete({ orch: 'opus:high', workers: 'sonnet:low' })).toEqual({
    picks: { orch: 'opus:high', workers: 'sonnet:low' },
    gaps: [],
  })
  expect(complete({ deep: 'opus', orch: 'fable' }, 'sonnet')).toEqual({
    picks: { orch: 'fable:medium', workers: 'sonnet:medium', deep: 'opus:medium' },
    gaps: ['orch effort', 'workers=', 'deep effort'],
  })
  expect(complete({}, 'sonnet').picks).toEqual({ orch: 'sonnet:medium', workers: 'sonnet:medium' })
  // All four tiers named covers workers=.
  const tiers = { orch: 'opus:high', deep: 'opus:xhigh', careful: 'opus:high', standard: 'sonnet:medium', quick: 'haiku:low' }
  expect(missing(tiers)).toEqual([])
})

test('suggestion highlights exactly the filled-in picks', () => {
  const s = suggestion({ orch: 'opus', deep: 'fable:high' }, 'opus', 'Build it')
  expect(s.text).toBe('/suschatt-flow orch=opus:medium workers=sonnet:medium deep=fable:high Build it')
  expect(s.decorations.map(d => s.text.slice(d.start, d.end))).toEqual(['orch=opus:medium', 'workers=sonnet:medium'])
})

test('every help sample names every model and effort, and carries a real task', () => {
  const samples = HELP.slice(HELP.indexOf('SAMPLE PROMPTS'), HELP.indexOf('NOTES'))
    .split('\n')
    .map(l => l.trim())
    .filter(l => l.startsWith('/suschatt-flow '))
  expect(samples.length).toBeGreaterThanOrEqual(5)
  for (const line of samples) {
    const { errors, rest, picks } = parse(line.slice('/suschatt-flow '.length))
    expect(errors).toEqual([])
    expect(missing(picks)).toEqual([]) // samples model the habit
    expect(rest.length).toBeGreaterThan(40)
  }
})

test('sanitize: one line, no slash command, no swallowed picks or flag', () => {
  expect(sanitize('/suschatt-flow orch=opus:high -r Goal: x\n\nContext:  y')).toBe('Goal: x Context: y')
  expect(sanitize('workers=haiku Goal: keep a=b inside')).toBe('Goal: keep a=b inside')
  expect(sanitize('  Goal: plain  ')).toBe('Goal: plain')
})

// ---- the command ----

test('-help, show, merge, bad model and off', async ($, on) => {
  const status = engine(on)
  const run = async (args: string) => (await $.command.run(typed('suschatt-flow', args))).text ?? ''

  expect(await run('-HELP')).toBe(HELP)
  expect(await run('')).toContain(`${SHOW}defaults`)
  await run('workers=sonnet')
  expect(await run('deep=opus:high')).toBe(`${SHOW}workers=sonnet deep=opus:high`)
  expect(status.at(-1)).toBe('suschatt-flow: workers=sonnet deep=opus:high')
  expect(await run('deep=gpt')).toContain('Nothing changed')
  await run('off')
  expect(await run('')).toContain(`${SHOW}defaults`)
  expect(status.at(-1)).toBeUndefined()
})

test('a complete run replaces old picks and hands the bare task to the skill', async ($, on) => {
  const { toasts } = engine(on)
  const started = runs(on)
  const run = async (args: string) => (await $.command.run(typed('suschatt-flow', args))).text ?? ''

  await run('careful=haiku') // a previous run's pick must not leak into the next run
  expect(await run(`${FULL} Add CSV export`)).toContain(FULL)
  await settle()
  expect(toasts).toEqual([])
  expect(started).toEqual(['Add CSV export'])
  expect(await run('')).toBe(`${SHOW}${FULL}. /suschatt-flow -help for usage.`)
})

test('anything missing starts nothing: defaults filled in, highlighted, editable', async ($, on) => {
  engine(on) // session model claude-opus-5-5
  const seen = box(on)
  const started = runs(on)
  const run = async (args: string) => (await $.command.run(typed('suschatt-flow', args))).text ?? ''

  const reply = await run('orch=fable workers=haiku Build it')
  expect(reply).toContain('Nothing started. Missing: orch effort, workers effort.')
  expect(reply).toContain('effort = medium')
  expect(seen.filled.at(-1)).toBe('/suschatt-flow orch=fable:medium workers=haiku:medium Build it')
  expect(seen.marks.at(-1)).toEqual(['orch=fable:medium', 'workers=haiku:medium'])

  expect(await run('deep=fable:high Build it')).toContain('Missing: orch=, workers=.')
  expect(seen.filled.at(-1)).toBe('/suschatt-flow orch=opus:medium workers=sonnet:medium deep=fable:high Build it')
  expect(seen.marks.at(-1)).toEqual(['orch=opus:medium', 'workers=sonnet:medium'])

  await settle()
  expect(started).toEqual([])

  // Pressing Enter on the edited line starts the run.
  await run('orch=fable:high workers=haiku:low Build it')
  await settle()
  expect(started).toEqual(['Build it'])
})

test('a misspelled role is an error, and the old accident line now refines', async ($, on) => {
  engine(on)
  const seen = box(on)
  const started = runs(on)
  const run = async (args: string) => (await $.command.run(typed('suschatt-flow', args))).text ?? ''

  expect(await run('orch=opus:high heavy=opus Build it')).toContain('"heavy" is not a role')
  await run('orch=opus worker=sonnet standard=sonnet -r I want a dashboard')
  await settle()
  expect(started).toEqual([])
  expect(seen.filled).toEqual(['/suschatt-flow orch=opus:medium workers=sonnet:medium standard=sonnet:medium Goal: x'])
})

test('typing the skill directly strips picks too', async ($, on) => {
  engine(on)
  let args = ''
  on('command.run', (_, e) => {
    if (e.command === 'suschatt-flow:flow') args = e.args
    return { text: '' }
  })
  await $.command.run(typed('suschatt-flow:flow', 'quick=haiku:low Rename db_url'))
  expect(args).toBe('Rename db_url')
  expect((await $.command.run(typed('suschatt-flow', ''))).text).toContain('quick=haiku:low')
})

// ---- applying models and efforts ----

test('workers get their tier model, else workers; others untouched', async ($, on) => {
  engine(on)
  const models: Record<string, string | undefined> = {}
  on('agent.spawn', (_, e) => {
    models[e.subagentType] = e.model
    return { model: e.model ?? 'default', agentId: `id-${e.subagentType}` }
  })
  await $.command.run(typed('suschatt-flow', 'deep=fable:high workers=sonnet:low'))
  for (const t of ['suschatt-flow:deep', 'suschatt-flow:quick', 'Explore']) await $.agent.spawn(spawn(t))
  expect(models).toEqual({ 'suschatt-flow:deep': 'fable', 'suschatt-flow:quick': 'sonnet', Explore: undefined })
})

test('orch model and effort on main requests; each worker gets its own effort', async ($, on) => {
  engine(on)
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'default', agentId: `id-${e.subagentType}` }))
  const seen: string[] = []
  on('turn.step', async function* (_, e) {
    seen.push(`${e.agentId ?? 'main'}:${e.model}:${e.effort ?? '-'}`)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  const step = async (agentId?: string) => {
    const input = { turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1 }
    for await (const _ of $.turn.step(agentId === undefined ? input : { ...input, agentId })) {
      // drain the stream
    }
  }
  await step()
  await $.command.run(typed('suschatt-flow', 'orch=fable:max deep=opus:xhigh workers=sonnet:low'))
  await $.agent.spawn(spawn('suschatt-flow:deep'))
  await $.agent.spawn(spawn('suschatt-flow:quick'))
  await step()
  await step('id-suschatt-flow:deep')
  await step('id-suschatt-flow:quick')
  await step('someone-else')
  await $.command.run(typed('suschatt-flow', 'off'))
  await step()
  expect(seen).toEqual([
    'main:claude-sonnet-5-5:-',
    'main:fable:max',
    'id-suschatt-flow:deep:claude-sonnet-5-5:xhigh',
    'id-suschatt-flow:quick:claude-sonnet-5-5:low',
    'someone-else:claude-sonnet-5-5:-',
    'main:claude-sonnet-5-5:-',
  ])
})

test('status tool draws progress, and finished clears picks', async ($, on) => {
  const status = engine(on)
  await $.command.run(typed('suschatt-flow', 'orch=opus:high'))
  await $.tool.call({ tool: 'mcp__suschatt-flow__status', phase: 'delegate', done: 1, total: 3 })
  expect(status.at(-1)).toBe('suschatt-flow [delegate] 1/3 | orch=opus:high')
  await $.tool.call({ tool: 'mcp__suschatt-flow__status', finished: true })
  expect((await $.command.run(typed('suschatt-flow', ''))).text).toContain(`${SHOW}defaults`)
  expect(status.at(-1)).toBeUndefined()
})

// ---- -r ----

test('-r rewrites the dump, drafts it with completed picks, and leaves live picks alone', async ($, on) => {
  const status = engine(on)
  const seen = box(on, { text: 'Goal: stop double inserts; finance overcounts.\nOpen questions: which job?' })
  const run = async (args: string) => (await $.command.run(typed('suschatt-flow', args))).text ?? ''

  await run('careful=opus:high') // a run in progress
  const reply = await run('orch=fable:high -r loader double inserts again, ugh, finance mad')
  expect(reply).toContain('prompt box')
  expect(reply).toContain('Missing: workers=.')
  expect(seen.filled).toEqual([
    '/suschatt-flow orch=fable:high workers=sonnet:medium Goal: stop double inserts; finance overcounts. Open questions: which job?',
  ])
  expect(seen.marks).toEqual([['workers=sonnet:medium']])
  expect(seen.model).toBe('sonnet')
  expect(seen.system).toBe(REFINE_SYSTEM)
  expect(seen.prompt).toContain('<brain_dump>\nloader double inserts again, ugh, finance mad\n</brain_dump>')
  expect(await run('')).toContain('Picks: careful=opus:high.') // not replaced
  expect(status.at(-1)).toBe('suschatt-flow: careful=opus:high') // "refining..." cleared back
})

test('-r never starts a run; "refine" without the flag is an ordinary task', async ($, on) => {
  engine(on)
  box(on)
  const started = runs(on)
  await $.command.run(typed('suschatt-flow', `${FULL} --refine tidy up the search ranking`))
  await $.command.run(typed('suschatt-flow', `${FULL} refine the search ranking`))
  await settle()
  expect(started).toEqual(['refine the search ranking'])
})

test('-r prints the draft when the box is busy; usage for an empty dump', async ($, on) => {
  engine(on)
  const busy = box(on, { text: 'Goal: x' }, { text: 'half-typed thought', isFillable: true })
  const reply = (await $.command.run(typed('suschatt-flow', `${FULL} -r dump`))).text ?? ''
  expect(busy.filled).toEqual([])
  expect(reply).toContain(`/suschatt-flow ${FULL} Goal: x`)
  expect((await $.command.run(typed('suschatt-flow', '-r'))).text).toContain('Usage:')
})

test('-r prints the draft when the box refuses a fill', async ($, on) => {
  engine(on)
  box(on, { text: 'Goal: x' }, { text: '', isFillable: false })
  expect((await $.command.run(typed('suschatt-flow', `${FULL} -r dump`))).text).toContain(`/suschatt-flow ${FULL} Goal: x`)
})

test('-r reports a failed model without changing anything', async ($, on) => {
  engine(on)
  box(on, { reason: 'api-error' })
  expect((await $.command.run(typed('suschatt-flow', '-r dump'))).text).toContain('Could not refine (api-error)')
})

test('-r survives a model call that rejects', async ($, on) => {
  engine(on)
  box(on, 'throw')
  expect((await $.command.run(typed('suschatt-flow', '-r dump'))).text).toContain('Could not refine')
})

test('an unpicked tier keeps its own effort; a display-only label is never sent', async ($, on) => {
  engine(on)
  on('agent.spawn', (_, e) => ({ model: e.model ?? 'default', agentId: `id-${e.subagentType}` }))
  const seen: string[] = []
  on('turn.step', async function* (_, e) {
    seen.push(`${e.agentId}:${e.effort ?? '-'}`)
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [], stopReason: 'end_turn', usage: null }
  })
  // No picks at all: the quick tier's row shows "effort: auto", which must not reach the API.
  await $.agent.spawn(spawn('suschatt-flow:quick'))
  await $.agent.spawn(spawn('suschatt-flow:deep'))
  for (const id of ['id-suschatt-flow:quick', 'id-suschatt-flow:deep']) {
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-haiku-5-5', messageCount: 1, agentId: id })) {
      // drain the stream
    }
  }
  expect(seen).toEqual(['id-suschatt-flow:quick:-', 'id-suschatt-flow:deep:-'])
})
