import { atom, read, update } from 'claude-code'
import type { EngineInterface, On } from 'claude-code'

import type { AgentMessage, AgentRow, Collapsed, RunInfo } from '../types'

export const PANE = 'suschatt-agents'
const TITLE = 'Subagents'
const PREFIX = 'suschatt-flow:'

// Change a tag when that value's fields change: it declines what an earlier version stored.
const agents = atom({ plugin: 'suschatt-flow', key: 'agents' } as const, [], { shape: 'agents-2' })
const messages = atom({ plugin: 'suschatt-flow', key: 'messages' } as const, [], { shape: 'messages-1' })
const tick = atom({ plugin: 'suschatt-flow', key: 'tick' } as const, 0)
const run = atom({ plugin: 'suschatt-flow', key: 'run' } as const, {} as RunInfo)
const collapsed = atom({ plugin: 'suschatt-flow', key: 'collapsed' } as const, {} as Collapsed) // kept across runs

// Each tier's default effort, from agents/*.md, shown when the run picked none.
const TIER_EFFORT: Record<string, string> = { deep: 'xhigh', careful: 'high', standard: 'medium', quick: 'auto' }

const TICK_MS = 1000 // redraw rate while anyone works, so elapsed times move

// Label colours per role.
const COLOURS: Record<string, string> = {
  orchestrator: '#f2c66d',
  deep: '#b48cf2',
  careful: '#6aa7ff',
  standard: '#5fd08a',
  quick: '#f2c14e',
}

// Card panel palette: header, section bars, "done" teal, and one colour per worker card.
const HEADER = '#f2c66d'
const RUNNING_BAR = '#2ee87a'
const FINISHED_BAR = '#f5e94a'
const DONE = '#4fd6c0'
const CARD_COLOURS = [0x3b82f6, 0xf06292, 0xf59e3a, 0xef5a3c, 0x34d36a, 0xa77bf0, 0x2fc4c4]
const SPINNER = ['◐', '◓', '◑', '◒']
const hex = (c: number) => `#${c.toString(16).padStart(6, '0')}`

// The card's pixel critter: 8 x 6 pixels, drawn as 8 x 3 half-block cells in the card's colour.
// '#' body, 'o' eye (dark), '.' transparent.
const CRITTER_ART = ['..####..', '.######.', '#o####o#', '########', '.#.##.#.', '#.#..#.#']
const CRITTER = { columns: 8, rows: 3 }
const CRITTER_COLS = 11
const critterCache = new Map<number, string>()

/** Raster cells for the critter in `colour` (memoised per colour). */
export function critterCells(colour: number): string {
  const cached = critterCache.get(colour)
  if (cached !== undefined) return cached
  const DEFAULT = 0x01000000
  const px = (ch: string | undefined) => (ch === '#' ? colour : ch === 'o' ? 0x1a1a24 : null)
  const words = new Uint32Array(CRITTER.columns * CRITTER.rows * 3)
  for (let cy = 0; cy < CRITTER.rows; cy++) {
    for (let x = 0; x < CRITTER.columns; x++) {
      const top = px(CRITTER_ART[cy * 2]?.[x])
      const bottom = px(CRITTER_ART[cy * 2 + 1]?.[x])
      const i = (cy * CRITTER.columns + x) * 3
      if (top !== null) words.set([0x2580, top, bottom ?? DEFAULT], i)
      else if (bottom !== null) words.set([0x2584, bottom, DEFAULT], i)
      else words.set([0x20, DEFAULT, DEFAULT], i)
    }
  }
  const cells = (new Uint8Array(words.buffer) as unknown as { toBase64(): string }).toBase64()
  critterCache.set(colour, cells)
  return cells
}

/** 1.2M, 34.5k, 812 */
export function formatTokens(n: number): string {
  return n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e3 ? `${(n / 1e3).toFixed(1)}k` : String(n)
}

// The orchestrator's phase, as the status tool reports it, in words.
const PHASE: Record<string, string> = {
  plan: 'planning',
  design: 'designing',
  delegate: 'delegating',
  review: 'reviewing',
  finished: 'finished',
}

export const tierOf = (subagentType: string) => subagentType.slice(PREFIX.length)
export const shortModel = (model: string) => model.replace(/^claude-/, '')

/** `████░░░░ 3/8`, or undefined when the worker has not reported a plan yet. */
export function bar(done: number, total: number | undefined, width = 8): string | undefined {
  if (total === undefined || total <= 0) return undefined
  const filled = Math.round((Math.min(done, total) / total) * width)
  return `${'█'.repeat(filled)}${'░'.repeat(width - filled)} ${Math.min(done, total)}/${total}`
}

/** Elapsed time as MM:SS (H:MM:SS past an hour), the way OpenCode's agents lists show it. */
export function clock(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, '0')
  const ss = String(s % 60).padStart(2, '0')
  return s >= 3600 ? `${Math.floor(s / 3600)}:${mm}:${ss}` : `${mm}:${ss}`
}

export function elapsed(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000))
  return s < 60 ? `${s}s` : `${Math.floor(s / 60)}m${String(s % 60).padStart(2, '0')}s`
}

/** A new run starts with an empty list. */
export async function resetAgents($: EngineInterface) {
  await update($, agents, () => [])
  await update($, messages, () => [])
  await update($, run, () => ({}))
}

export function openPane($: EngineInterface) {
  return $.ui.open({ id: PANE, title: TITLE })
}

/** The status tool's report, and the conductor's model at run start; drawn on the conductor. */
export async function recordRun($: EngineInterface, s: RunInfo & { finished?: boolean }) {
  // A closing call may carry the final count too ({ done: 4, finished: true }): keep it.
  await update($, run, r => ({
    orch: s.orch ?? r.orch,
    phase: s.finished === true ? 'finished' : (s.phase ?? r.phase),
    done: s.done ?? r.done,
    total: s.total ?? r.total,
  }))
}

/**
 * The effort to send for a worker's requests: its tier's pick, else workers=, and only a real
 * level. A tier left unpicked returns undefined, so the agent keeps the effort it was started with.
 * Read from state (the worker's row and the picks), so it survives a reload mid-run.
 */
export async function effortFor($: EngineInterface, agentId: string): Promise<string | undefined> {
  const list = await read($, agents).catch(() => [] as AgentRow[])
  const row = list.find(r => r.id === agentId)
  if (row === undefined) return undefined
  const { value: picks = {} } = await $.state
    .get({ plugin: 'suschatt-flow', key: 'picks' } as const)
    .catch(() => ({ value: {} as Record<string, string> }))
  const effort = (picks[row.tier] ?? picks.workers)?.split(':')[1]
  return effort !== undefined && ['low', 'medium', 'high', 'xhigh', 'max'].includes(effort) ? effort : undefined
}

function patch($: EngineInterface, id: string, fn: (row: AgentRow) => AgentRow) {
  return update($, agents, list => list.map(row => (row.id === id ? fn(row) : row)))
}

/** Called from the mod's session.start: the step tool and the animation timer. */
export async function paneStart($: EngineInterface) {
  await $.tool.register({
    name: 'step',
    description:
      'suschatt-flow workers only: report progress on your own task to the agents pane. Right after reading your brief, call it with total (your plan in 3-8 steps) and done: 0; call it again with done (and a few-word note) as each step finishes.',
    isDeferred: false,
    inputSchema: {
      type: 'object',
      properties: {
        done: { type: 'integer', minimum: 0 },
        total: { type: 'integer', minimum: 1 },
        note: { type: 'string' },
      },
      required: ['done'],
    },
  })
  // Redraw while anyone works, so elapsed times move.
  $.clock.every(TICK_MS, () => {
    void read($, agents)
      .then(list => (list.some(r => r.status === 'running') ? update($, tick, n => n + 1) : undefined))
      .catch(() => undefined)
  })
}

/**
 * Adds one model request's usage to a worker's token counts. Called from the mod's turn.step hook
 * after every request a worker makes, so the counts grow live while it runs.
 */
export async function addUsage(
  $: EngineInterface,
  agentId: string,
  u: { input_tokens: number; output_tokens: number; cache_read_input_tokens: number; cache_creation_input_tokens: number },
) {
  const tokensIn = u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0)
  await patch($, agentId, row => ({
    ...row,
    tokensIn: (row.tokensIn ?? 0) + tokensIn,
    tokensOut: (row.tokensOut ?? 0) + u.output_tokens,
  }))
}

/** Called from the mod's agent.spawn hook once the worker has an id. */
export async function recordSpawn(
  $: EngineInterface,
  e: { subagentType: string; description: string },
  spawned: { agentId?: string; model?: string },
) {
  if (!e.subagentType.startsWith(PREFIX) || spawned.agentId === undefined) return
  const tier = tierOf(e.subagentType)
  const { value: picks = {} } = await $.state
    .get({ plugin: 'suschatt-flow', key: 'picks' } as const)
    .catch(() => ({ value: {} as Record<string, string> }))
  const picked = (picks[tier] ?? picks.workers)?.split(':')[1]
  const row: AgentRow = {
    id: spawned.agentId,
    tier,
    title: e.description,
    model: shortModel(spawned.model ?? '?'),
    effort: picked ?? TIER_EFFORT[tier],
    done: 0,
    status: 'running',
    startedAt: await $.clock.now(),
  }
  await update($, agents, list => [...list.filter(r => r.id !== row.id), row])
  void openPane($).catch(() => undefined)
}

/** "opus · effort: high", or the real session model when no orch= was picked. */
async function conductorModel($: EngineInterface, orch: string | undefined): Promise<string> {
  if (orch !== undefined) {
    const [model, effort] = orch.split(':')
    return `${model} · effort: ${effort ?? 'default'}`
  }
  const session = await $.session.model().catch(() => 'unknown')
  return `${shortModel(session)} (session model)`
}

export function agentsPane(on: On) {
  // Any agent-to-agent message: from the orchestrator (no agentId) or from a worker.
  on('tool.call', { tool: 'SendMessage' }, async ($, e, next) => {
    const result = await next(e)
    const m = e as unknown as { agentId?: string; to?: unknown; summary?: unknown }
    const msg: AgentMessage = {
      from: m.agentId ?? 'orch',
      to: String(m.to ?? '?'),
      summary: typeof m.summary === 'string' ? m.summary : undefined,
      at: await $.clock.now().catch(() => 0),
    }
    await update($, messages, list => [...list, msg].slice(-50)).catch(() => undefined)
    return result
  })

  on('tool.call', { tool: 'mcp__suschatt-flow__step' }, async ($, e) => {
    const s = e as unknown as { agentId?: string; done?: number; total?: number; note?: string }
    if (s.agentId === undefined) return { result: 'Only suschatt-flow workers report steps.' }
    await patch($, s.agentId, row => ({
      ...row,
      done: s.done ?? row.done,
      total: s.total ?? row.total,
      note: s.note ?? row.note,
      notes: s.note !== undefined && s.note !== row.note ? [...(row.notes ?? []), s.note].slice(-3) : row.notes,
    }))
    return { result: 'ok' }
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId !== undefined) {
      await patch($, e.agentId, row => (row.status === 'running' ? row : { ...row, status: 'running', endedAt: undefined }))
    }
    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) {
      const now = await $.clock.now()
      const failed = e.reason === 'error' || e.reason === 'aborted' || e.reason === 'refusal'
      await patch($, e.agentId, row => ({ ...row, status: failed ? 'stopped' : 'done', endedAt: now }))
    }
    return result
  })

  // Card-style subagents panel: a summary header, then "Running" and "Finished" sections, each
  // worker a card with a small pixel critter, its task, status mark, model, current step and history.
  on('ui.render', { component: 'Pane', requestId: 'suschatt-agents' }, async ($, e) => {
    const { Box, Text } = $.ui.resolve(e)
    const terminal = e.surface === 'terminal' ? $.ui.resolve(e) : undefined
    const list = await read($, agents)
    const info = await read($, run)
    const talk = await read($, messages)
    const beat = await read($, tick) // 1 s while anyone works: spinner and timers move
    const now = await $.clock.now()
    const { value: picks = {} } = await $.state
      .get({ plugin: 'suschatt-flow', key: 'picks' } as const)
      .catch(() => ({ value: {} as Record<string, string> }))
    const width = Math.max(30, (e.props as { bodyColumns?: number }).bodyColumns ?? 60)
    const folded = await read($, collapsed)
    const { Button } = $.ui.resolve(e)

    if (list.length === 0) {
      return (
        <Box flexDirection="column">
          <Text color={HEADER}>No subagents in this chat yet</Text>
          <Text dimColor>They appear here when a /suschatt-flow run delegates.</Text>
        </Box>
      )
    }

    const runningRows = list.filter(r => r.status === 'running')
    const finishedRows = list.filter(r => r.status !== 'running')
    const tokensOf = (r: AgentRow) => (r.tokensIn ?? 0) + (r.tokensOut ?? 0)
    const tokens = list.reduce((sum, r) => sum + tokensOf(r), 0)
    const runStart = Math.min(...list.map(r => r.startedAt))
    const runEnd = runningRows.length === 0 ? Math.max(...list.map(r => r.endedAt ?? now)) : now
    const orch = await conductorModel($, info.orch ?? picks.orch)
    const phase =
      info.phase !== undefined ? `${PHASE[info.phase] ?? info.phase} · ${info.done ?? 0}/${info.total ?? list.length} accepted` : ''
    const label = (id: string) => {
      if (id === 'orch') return 'orchestrator'
      const row = list.find(r => r.id === id)
      return row ? row.title : id
    }

    const critter = (row: AgentRow, colour: number) => {
      if (terminal !== undefined) {
        return <terminal.Raster key={`critter-${row.id}`} columns={CRITTER.columns} rows={CRITTER.rows} cells={critterCells(colour)} />
      }
      return <Text color={hex(colour)}>{'▟██▙'}</Text>
    }

    const card = (row: AgentRow) => {
      const colour = CARD_COLOURS[list.indexOf(row) % CARD_COLOURS.length]!
      const playing = row.status === 'running'
      const stopped = row.status === 'stopped'
      const time = clock((row.endedAt ?? now) - row.startedAt)
      const notes = row.notes ?? (row.note ? [row.note] : [])
      const steps = row.total ?? row.done
      const current = playing
        ? `${SPINNER[beat % SPINNER.length]} ${row.total !== undefined ? `Step ${Math.min(row.done + 1, row.total)}/${row.total} · ` : ''}${notes.at(-1) ?? 'Starting…'}`
        : stopped
          ? `Stopped · ${row.done} step${row.done === 1 ? '' : 's'}`
          : `Done · ${steps} step${steps === 1 ? '' : 's'}`
      const history = (playing ? notes.slice(0, -1) : notes).slice(-2)
      const body = width - CRITTER_COLS
      return (
        <Box key={row.id} flexDirection="row" marginBottom={1}>
          <Box width={CRITTER_COLS} flexShrink={0} marginTop={1} paddingLeft={1}>
            {critter(row, colour)}
          </Box>
          <Box flexDirection="column" width={body} minWidth={0}>
            <Box flexDirection="row" justifyContent="space-between">
              <Text bold wrap="truncate-end">
                {row.title}
              </Text>
              <Text color={stopped ? 'error' : playing ? 'success' : DONE}>{stopped ? '✗' : playing ? '●' : '✓'}</Text>
            </Box>
            <Text dimColor wrap="truncate-end">{`${row.tier} · ${row.model}:${row.effort ?? 'auto'} · ${time}`}</Text>
            <Text dimColor wrap="truncate-end">{`${formatTokens(tokensOf(row))} tokens · ${formatTokens(row.tokensOut ?? 0)} out`}</Text>
            <Text color={stopped ? 'error' : playing ? 'warning' : DONE} wrap="truncate-end">
              {current}
            </Text>
            {history.map(n => (
              <Text dimColor wrap="truncate-end">{`  ${n}`}</Text>
            ))}
            <Text color={hex(colour)}>{'─'.repeat(Math.max(4, body - 2))}</Text>
          </Box>
        </Box>
      )
    }

    // A section header is a button: press it (or click it) to fold or unfold its cards; the choice
    // is kept in state, so it survives redraws and later runs.
    const section = (which: 'running' | 'finished', title: string, rows: AgentRow[], bg: string) => {
      if (rows.length === 0) return null
      const isFolded = folded[which] === true
      return (
        <Box flexDirection="column" marginBottom={isFolded ? 1 : 0}>
          <Button key={`section-${which}`} plain onPress={() => update($, collapsed, c => ({ ...c, [which]: !isFolded }))}>
            <Text bold color="#111111" backgroundColor={bg}>
              {` ${isFolded ? '▸' : '▾'} ${title} · ${rows.length}`.padEnd(width)}
            </Text>
          </Button>
          {!isFolded && <Box height={1} />}
          {!isFolded && rows.map(card)}
        </Box>
      )
    }

    return (
      <Box flexDirection="column">
        <Text color={HEADER} bold>{`${list.length} subagent${list.length === 1 ? '' : 's'} in this chat`}</Text>
        <Text dimColor wrap="truncate-end">{`orchestrator · ${orch}${phase ? ` · ${phase}` : ''}`}</Text>
        <Box flexDirection="row" marginTop={1} marginBottom={1}>
          <Box flexDirection="column" width={Math.floor(width / 3)}>
            <Text dimColor>Tokens</Text>
            <Text color={HEADER}>{formatTokens(tokens)}</Text>
          </Box>
          <Box flexDirection="column" width={Math.floor(width / 3)}>
            <Text dimColor>Time</Text>
            <Text color={HEADER}>{clock(runEnd - runStart)}</Text>
          </Box>
          <Box flexDirection="column" width={Math.floor(width / 3)}>
            <Text dimColor>Agents</Text>
            <Text color={HEADER}>{`${runningRows.length} running`}</Text>
          </Box>
        </Box>

        {section('running', 'Running', runningRows, RUNNING_BAR)}
        {section('finished', 'Finished', finishedRows, FINISHED_BAR)}

        {talk.length > 0 && (
          <Box flexDirection="column" marginTop={1}>
            <Text bold>Messages</Text>
            {talk.slice(-6).map(m => (
              <Text dimColor wrap="truncate-end">
                {`${label(m.from)} → ${label(m.to)}${m.summary ? `: ${m.summary}` : ''} · ${clock(now - m.at)} ago`}
              </Text>
            ))}
          </Box>
        )}
      </Box>
    )
  })
}
