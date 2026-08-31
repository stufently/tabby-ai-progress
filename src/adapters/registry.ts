import { AgentAdapter } from './types'

export class AdapterRegistry {
    private readonly adapters: readonly AgentAdapter[]

    constructor (adapters: readonly AgentAdapter[]) {
        this.adapters = [...adapters]
    }

    identify (text: string): AgentAdapter | null {
        for (const adapter of this.adapters) {
            try {
                if (adapter.detect(text)) return adapter
            } catch {
                // A third-party adapter must not disrupt terminal output processing.
            }
        }
        return null
    }

    get (id: string): AgentAdapter | null {
        return this.adapters.find(adapter => adapter.id === id) ?? null
    }

    get all (): readonly AgentAdapter[] {
        return this.adapters
    }
}
