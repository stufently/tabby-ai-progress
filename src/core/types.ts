export type AgentActivityState = 'idle' | 'working' | 'progress' | 'error' | 'paused'

export interface AgentProgressState {
    readonly activity: AgentActivityState
    readonly percent: number | null
    readonly at: number
    readonly source: StatusSource
}

export type StatusSource = 'osc' | 'title' | 'heuristic'

export const SOURCE_RANK: Readonly<Record<StatusSource, number>> = {
    osc: 3,
    title: 2,
    heuristic: 1,
}

export interface ProgressSink {
    setProgress (value: number | null): void
    setAttention (on: boolean): void
    setColor (color: string | null): void
}

export interface Clock {
    now (): number
    setInterval (fn: () => void, ms: number): unknown
    clearInterval (handle: unknown): void
}
