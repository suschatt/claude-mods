/** Model picks for the running flow: role -> `model` or `model:effort`. */
export type Picks = Record<string, string>

/** One worker on the agents pane. */
export type AgentRow = {
  id: string
  tier: string
  title: string
  model: string
  effort?: string
  done: number
  total?: number
  note?: string
  notes?: string[] // recent step notes, newest last
  tokensIn?: number // input + cache read + cache write tokens, summed over every model request
  tokensOut?: number // output tokens, summed over every model request
  status: 'running' | 'done' | 'stopped'
  startedAt: number
  endedAt?: number
}

/** The orchestrator's progress, as it last reported through the status tool. */
/** Which sections of the subagents pane are folded. */
export type Collapsed = { running?: boolean; finished?: boolean }

export type RunInfo = { orch?: string; phase?: string; done?: number; total?: number }

/** One SendMessage between agents: 'orch' or a worker id on each end. */
export type AgentMessage = { from: string; to: string; summary?: string; at: number }

declare module 'claude-code' {
  interface PluginState {
    'suschatt-flow': {
      picks: Picks
      agents: Shaped<AgentRow[]>
      tick: number
      run: RunInfo
      collapsed: Collapsed
      messages: Shaped<AgentMessage[]>
    }
  }
}
