import { AgentAdapter } from '../adapters/types'
import { NormalizedConfig } from '../config/defaults'
import { AgentProgressState, Clock } from './types'

export class FallbackHeuristic {
    private lastOutputAt: number | null = null
    private activity: 'idle' | 'working' = 'idle'

    constructor (private readonly config: NormalizedConfig, private readonly clock: Clock) {}

    onOutput (_text: string, agent: AgentAdapter | null): AgentProgressState | null {
        if (!this.allowed(agent)) return null
        this.lastOutputAt = this.clock.now()
        if (this.activity === 'working') return null
        this.activity = 'working'
        return this.state('working')
    }

    onTick (agent: AgentAdapter | null): AgentProgressState | null {
        if (!this.allowed(agent) || this.activity !== 'working' || this.lastOutputAt === null) return null
        if (this.clock.now() - this.lastOutputAt < this.config.fallback.activityWindowMs) return null
        this.activity = 'idle'
        return this.state('idle')
    }

    reset (): void {
        this.lastOutputAt = null
        this.activity = 'idle'
    }

    private allowed (agent: AgentAdapter | null): agent is AgentAdapter {
        return this.config.fallback.enabled && agent !== null && this.config.fallback.agents[agent.id] !== false
    }

    private state (activity: 'idle' | 'working'): AgentProgressState {
        return { activity, percent: null, at: this.clock.now(), source: 'heuristic' }
    }
}
