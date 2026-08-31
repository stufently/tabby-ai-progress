import { BUILTIN_ADAPTERS } from '../adapters/builtin'
import { AgentAdapter, TitleVerdict } from '../adapters/types'
import { NormalizedConfig } from '../config/defaults'
import { AgentProgressState, Clock } from './types'

export class TitleSource {
    private last: Pick<AgentProgressState, 'activity' | 'percent'> | null = null
    private identified: AgentAdapter | null = null

    constructor (
        private readonly config: NormalizedConfig,
        private readonly clock: Clock,
        private readonly adapters: readonly AgentAdapter[] = BUILTIN_ADAPTERS,
    ) {}

    get identifiedAgent (): AgentAdapter | null { return this.identified }

    onTitle (title: string, agent: AgentAdapter | null): AgentProgressState | null {
        if (!this.config.title.enabled) return null
        try {
            let verdict: TitleVerdict | null = null
            if (agent) {
                this.identified = agent
                verdict = this.interpret(agent, title)
            } else {
                const claims = this.adapters
                    .map(candidate => ({ candidate, verdict: this.interpret(candidate, title) }))
                    .filter((claim): claim is { candidate: AgentAdapter, verdict: TitleVerdict } => claim.verdict !== null)
                if (claims.length !== 1 || !claims[0].verdict.identifying) return null
                this.identified = claims[0].candidate
                verdict = claims[0].verdict
            }
            if (!verdict) return null
            if (this.last?.activity === verdict.activity && this.last.percent === verdict.percent) return null
            this.last = { activity: verdict.activity, percent: verdict.percent }
            return { activity: verdict.activity, percent: verdict.percent, at: this.clock.now(), source: 'title' }
        } catch {
            return null
        }
    }

    reset (): void {
        this.last = null
        this.identified = null
    }

    private interpret (adapter: AgentAdapter, title: string): TitleVerdict | null {
        if (!adapter.interpretTitle) return null
        try {
            return adapter.interpretTitle(title)
        } catch (error) {
            if (this.config.debugLogging) console.debug(`[tabby-ai-progress] title adapter ${adapter.id} failed`, error)
            return null
        }
    }
}
