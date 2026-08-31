import { Component } from '@angular/core'
import { ConfigService } from 'tabby-core'

@Component({
    selector: 'tabby-ai-progress-settings',
    template: require('./settingsTab.component.pug'),
})
export class AiProgressSettingsTabComponent {
    readonly agents = [
        ['claude-code', 'Claude Code'],
        ['codex', 'OpenAI Codex'],
        ['opencode', 'OpenCode'],
        ['gemini-cli', 'Gemini CLI'],
        ['aider', 'Aider'],
    ] as const

    constructor (public readonly config: ConfigService) {}

    isFallbackEnabled (id: string): boolean {
        return this.config.store.aiProgress.fallback.agents[id] !== false
    }

    setFallbackEnabled (id: string, enabled: boolean): void {
        this.config.store.aiProgress.fallback.agents[id] = enabled
        this.config.save()
    }
}
