import { BaseTerminalTabComponent } from 'tabby-terminal'
import { ProgressSink } from '../core/types'

const marker = Symbol.for('tabby-ai-progress.patched')

export class TabProgressSink implements ProgressSink {
    private readonly original: (value: number | null) => void
    private readonly originalColor: string | null
    private installedPatch = false
    private changedColor = false
    private released = false

    constructor (
        private readonly tab: BaseTerminalTabComponent<any>,
        suppressBuiltIn: boolean,
        private debugLogging = false,
    ) {
        this.original = tab.setProgress.bind(tab)
        this.originalColor = tab.color
        this.setSuppressed(suppressBuiltIn)
    }

    setSuppressed (suppressed: boolean): void {
        if (this.released) return
        if (suppressed && !this.installedPatch && !(this.tab as any)[marker]) {
            ;(this.tab as any)[marker] = true
            ;(this.tab as any).setProgress = (_value: number | null): void => {}
            this.installedPatch = true
        } else if (!suppressed && this.installedPatch) {
            this.safe(() => { delete (this.tab as any).setProgress })
            this.safe(() => { delete (this.tab as any)[marker] })
            this.installedPatch = false
        }
    }

    setDebugLogging (enabled: boolean): void { this.debugLogging = enabled }

    setProgress (value: number | null): void {
        this.safe(() => this.original(value))
    }

    setAttention (on: boolean): void {
        this.safe(() => on ? this.tab.displayActivity() : this.tab.clearActivity())
    }

    setColor (color: string | null): void {
        this.safe(() => {
            this.tab.color = color
            this.changedColor = true
        })
    }

    release (): void {
        if (this.released) return
        this.released = true
        if (this.installedPatch) {
            this.safe(() => { delete (this.tab as any).setProgress })
            this.safe(() => { delete (this.tab as any)[marker] })
        }
        this.safe(() => this.original(null))
        this.safe(() => this.tab.clearActivity())
        if (this.changedColor) this.safe(() => { this.tab.color = this.originalColor })
    }

    private safe (operation: () => void): void {
        try { operation() } catch {
            if (this.debugLogging) console.debug('[tabby-ai-progress] Tabby host API call failed')
        }
    }
}
