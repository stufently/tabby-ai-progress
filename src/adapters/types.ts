import type { AgentActivityState } from '../core/types'

export interface AgentAdapter {
    readonly id: string
    readonly displayName: string
    detect (text: string): boolean
    interpretTitle? (title: string): TitleVerdict | null
}

export interface TitleVerdict {
    readonly activity: AgentActivityState
    readonly percent: number | null
    readonly identifying: boolean
}
