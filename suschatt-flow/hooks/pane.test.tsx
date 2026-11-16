import { expect, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

import { bar, clock, critterCells, elapsed, formatTokens } from './pane'

type On = Parameters<TestBody>[1]
const pane = (bodyColumns: number) =>
  ({
    plugin: 'suschatt-flow',
    component: 'Pane',
    requestId: 'suschatt-agents',
    props: {
      title: 'Subagents',
      isFocused: false,
      bodyColumns,
      placement: 'dock',
      scroll: { offset: 0, bodyRows: 80 },
      view: {},
    },
  }) as const

const typed = (args: string, command = 'suschatt-flow') => ({
  command,
  args,
  origin: { kind: 'composer' } as const,
  presentation: { isFullscreen: false, columns: 160 },
})
const base = {
  tool_use_id: 't',
  prompt: 'brief',
  provider: { plugin: 'suschatt-flow', tier: 'user' } as const,
  parentModel: 'opus',
  background: true,
  fork: false,
}
const usage = (n: number) => ({ input_tokens: n, output_tokens: 0, cache_creation_input_tokens: 0, cache_read_input_tokens: 0, model: 'x' })

/** The engine beneath the mod; returns a clock the test can move. */
function engine(on: On) {
  const time = { now: 1_000_000 }
  let n = 0
  on('clock.now', () => ({ value: time.now }))
  on('clock.after', () => ({ value: undefined }))
  on('session.model', () => ({ value: 'claude-opus-5-5' }))
  on('ui.status', () => ({ value: undefined }))
  on('ui.open', () => ({ value: { isPlaced: true } }))
  on('command.run', () => ({ text: '' }))
  on('agent.spawn', (_, e) => ({ model: `claude-${e.model ?? 'opus'}-5-5`, agentId: `w${++n}` }))
  on('tool.call', () => ({ result: 'ok' }))
  on('turn.complete', () => ({ text: '' }))
  return time
}

type Ui = { find: (q: { type: 'Text'; text?: RegExp }) => Promise<{ text: string } | undefined> }
const line = async (ui: Ui, re: RegExp) => (await ui.find({ type: 'Text', text: re }))?.text

test('helpers: bar, elapsed, clock, tokens, critter', () => {
  expect(bar(3, 6, 6)).toBe('███░░░ 3/6')
  expect(elapsed(185_000)).toBe('3m05s')
  expect(clock(185_000)).toBe('03:05')
  expect(clock(3_725_000)).toBe('1:02:05')
  expect(formatTokens(812)).toBe('812')
  expect(formatTokens(34_500)).toBe('34.5k')
  expect(formatTokens(1_230_000)).toBe('1.2M')
  expect(atob(critterCells(0x3b82f6)).length).toBe(8 * 3 * 3 * 4) // 8 x 3 cells, 3 words each
})

test('card panel: header and stats, Running and Finished sections, cards with step and history', async ($, on) => {
  const time = engine(on)
  // Each model request a worker makes reports usage; the pane adds it up per worker.
  const perRequest = [
    { agentId: 'w2', input: 400_000, cacheRead: 590_000, cacheWrite: 10_000, output: 100_000 },
    { agentId: 'w2', input: 50_000, cacheRead: 0, cacheWrite: 0, output: 50_000 },
    { agentId: 'w1', input: 30_000, cacheRead: 0, cacheWrite: 0, output: 4_500 },
  ]
  let k = 0
  on('turn.step', async function* (_, e) {
    const r = perRequest[k++]!
    return {
      turnId: e.turnId,
      index: e.index,
      answer: '',
      toolUses: [],
      stopReason: 'end_turn',
      usage: { model: 'x', input_tokens: r.input, output_tokens: r.output, cache_read_input_tokens: r.cacheRead, cache_creation_input_tokens: r.cacheWrite },
    }
  })
  await $.command.run(typed('orch=opus:high workers=sonnet:medium deep=fable:xhigh Make the video'))
  await $.agent.spawn({ ...base, description: 'Motion graphics', subagentType: 'suschatt-flow:deep' })
  await $.agent.spawn({ ...base, description: 'Research', subagentType: 'suschatt-flow:standard' })
  await $.tool.call({ tool: 'mcp__suschatt-flow__status', phase: 'delegate', done: 1, total: 2 })
  for (const [done, note] of [[1, 'Listing 8 scenes'], [2, 'Sketching the opening scene'], [3, 'Writing the storyboard']] as const) {
    await $.tool.call({ tool: 'mcp__suschatt-flow__step', agentId: 'w1', done, total: 6, note })
  }
  await $.tool.call({ tool: 'mcp__suschatt-flow__step', agentId: 'w2', done: 6, total: 6, note: 'Reading r/ClaudeAI threads' })
  await $.tool.call({ tool: 'mcp__suschatt-flow__step', agentId: 'w2', done: 6, total: 6, note: 'Wrote research.md' })
  for (const r of perRequest) {
    for await (const _ of $.turn.step({ turnId: 't', index: 0, model: 'claude-sonnet-5-5', messageCount: 1, agentId: r.agentId })) {
      // drain the stream
    }
  }
  time.now += 161_000
  await $.turn.complete({ turnId: 't2', agentId: 'w2', answer: '', durationMs: 1, isAborted: false, reason: 'answer', usage: usage(1) })

  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await line(ui, /in this chat/)).toBe('2 subagents in this chat')
  expect(await line(ui, /^orchestrator/)).toBe('orchestrator · opus · effort: high · delegating · 1/2 accepted')
  expect(await line(ui, /^1\.2M$/)).toBe('1.2M') // total: 1,200,000 + 34,500
  expect(await line(ui, /34\.5k tokens/)).toBe('34.5k tokens · 4.5k out') // the running worker, live
  expect(await line(ui, /1\.2M tokens/)).toBe('1.2M tokens · 150.0k out') // the finished worker; the turn summary adds nothing
  expect(await line(ui, /^02:41$/)).toBe('02:41') // run time
  expect(await line(ui, /Running ·/)).toBe(' ▾ Running · 1'.padEnd(60))
  expect(await line(ui, /Finished ·/)).toBe(' ▾ Finished · 1'.padEnd(60))
  // The running card
  expect(await line(ui, /^Motion graphics$/)).toBe('Motion graphics')
  expect(await line(ui, /deep · /)).toBe('deep · fable-5-5:xhigh · 02:41')
  expect(await line(ui, /Step 4\/6/)).toMatch(/^[◐◓◑◒] Step 4\/6 · Writing the storyboard$/)
  expect(await line(ui, /Sketching/)).toBe('  Sketching the opening scene')
  expect(await line(ui, /Listing/)).toBe('  Listing 8 scenes')
  // The finished card
  expect(await line(ui, /Done ·/)).toBe('Done · 6 steps')
  expect(await line(ui, /Wrote research/)).toBe('  Wrote research.md')
  expect(await line(ui, /^✓$/)).toBe('✓')
  expect(await line(ui, /^●$/)).toBe('●')
  expect(await ui.find({ type: 'Raster' } as never)).toBeDefined() // the critters
  await ui.unmount()

  const desk = await $.ui.mount({ ...pane(60), surface: 'desktop' })
  expect(await desk.find({ type: 'Text', text: /▟██▙/ })).toBeDefined() // text critter off the terminal
  await desk.unmount()
})

test('a stopped worker shows a cross and its step count', async ($, on) => {
  engine(on)
  await $.command.run(typed('orch=opus:high workers=sonnet:medium Fix it'))
  await $.agent.spawn({ ...base, description: 'Patch', subagentType: 'suschatt-flow:careful' })
  await $.tool.call({ tool: 'mcp__suschatt-flow__step', agentId: 'w1', done: 2, total: 5, note: 'Editing' })
  await $.turn.complete({ turnId: 't', agentId: 'w1', answer: '', durationMs: 1, isAborted: true, reason: 'error' })
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await line(ui, /Stopped/)).toBe('Stopped · 2 steps')
  expect(await line(ui, /^✗$/)).toBe('✗')
  await ui.unmount()
})

test('the orchestrator keeps its model and final count after the run closes', async ($, on) => {
  engine(on)
  await $.command.run(typed('orch=sonnet:low workers=haiku:low Rename it'))
  await $.agent.spawn({ ...base, description: 'Rename', subagentType: 'suschatt-flow:quick' })
  await $.tool.call({ tool: 'mcp__suschatt-flow__status', phase: 'delegate', done: 0, total: 1 })
  await $.tool.call({ tool: 'mcp__suschatt-flow__status', done: 1, finished: true })
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await line(ui, /^orchestrator/)).toBe('orchestrator · sonnet · effort: low · finished · 1/1 accepted')
  await ui.unmount()
})

test('with no orch pick the orchestrator names the real session model', async ($, on) => {
  engine(on)
  await $.command.run(typed('orch=opus:high Tidy', 'suschatt-flow:flow'))
  await $.tool.call({ tool: 'mcp__suschatt-flow__status', reset: true })
  await $.agent.spawn({ ...base, description: 'Tidy', subagentType: 'suschatt-flow:quick' })
  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await line(ui, /^orchestrator/)).toMatch(/opus-5-5 \(session model\)|opus · effort: high/)
  expect(await line(ui, /quick · /)).toMatch(/^quick · opus-5-5:auto · \d\d:\d\d$/)
  await ui.unmount()
})

test('messages appear only when agents send some', async ($, on) => {
  engine(on)
  await $.command.run(typed('orch=opus:high workers=sonnet:medium Research it'))
  for (const [d, t] of [['A', 'deep'], ['B', 'careful'], ['C', 'standard']] as const) {
    await $.agent.spawn({ ...base, description: d, subagentType: `suschatt-flow:${t}` })
  }
  let ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await line(ui, /^Messages$/)).toBeUndefined()
  await ui.unmount()
  await $.tool.call({ tool: 'SendMessage', to: 'w3', message: 'also check pricing', summary: 'check pricing' })
  await $.tool.call({ tool: 'SendMessage', agentId: 'w1', to: 'w2', message: 'see arXiv', summary: 'shared a source' })
  ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await line(ui, /check pricing/)).toBe('orchestrator → C: check pricing · 00:00 ago')
  expect(await line(ui, /shared a source/)).toBe('A → B: shared a source · 00:00 ago')
  await ui.unmount()
})

test('an empty panel before any run delegates, and reset clears it', async ($, on) => {
  engine(on)
  let ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No subagents in this chat yet')
  await ui.unmount()
  await $.command.run(typed('orch=opus:high Tidy', 'suschatt-flow:flow'))
  await $.agent.spawn({ ...base, description: 'Literature', subagentType: 'suschatt-flow:quick' })
  await $.tool.call({ tool: 'mcp__suschatt-flow__status', reset: true, phase: 'delegate', done: 0, total: 4 })
  ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect((await ui.find({ type: 'Text' }))?.text).toBe('No subagents in this chat yet')
  await ui.unmount()
})

test('pressing a section header folds and unfolds its cards', async ($, on) => {
  engine(on)
  await $.command.run(typed('orch=opus:high workers=sonnet:medium Research it'))
  await $.agent.spawn({ ...base, description: 'Literature', subagentType: 'suschatt-flow:deep' })
  await $.agent.spawn({ ...base, description: 'Vendors', subagentType: 'suschatt-flow:standard' })
  await $.turn.complete({ turnId: 't', agentId: 'w2', answer: '', durationMs: 1, isAborted: false, reason: 'answer' })

  const ui = await $.ui.mount({ ...pane(60), surface: 'terminal' })
  expect(await line(ui, /^Literature$/)).toBe('Literature')
  await ui.press({ key: 'section-running' })
  expect(await line(ui, /Running ·/)).toBe(' ▸ Running · 1'.padEnd(60))
  expect(await line(ui, /^Literature$/)).toBeUndefined() // folded away
  expect(await line(ui, /^Vendors$/)).toBe('Vendors') // the other section is untouched
  await ui.press({ key: 'section-running' })
  expect(await line(ui, /Running ·/)).toBe(' ▾ Running · 1'.padEnd(60))
  expect(await line(ui, /^Literature$/)).toBe('Literature')
  await ui.unmount()
})
