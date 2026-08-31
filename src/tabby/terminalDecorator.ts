import { Injectable } from '@angular/core'
import { ConfigService } from 'tabby-core'
import { BaseSession, BaseTerminalTabComponent, TerminalDecorator } from 'tabby-terminal'
import { Subscription } from 'rxjs'
import { BUILTIN_ADAPTERS } from '../adapters/builtin'
import { AdapterRegistry } from '../adapters/registry'
import { AgentAdapter } from '../adapters/types'
import { normalizeConfig, NormalizedConfig } from '../config/defaults'
import { FallbackHeuristic } from '../core/fallbackHeuristic'
import { TabProgressController } from '../core/tabController'
import { TitleSource } from '../core/titleSource'
import { Clock } from '../core/types'
import { parseOsc94 } from '../protocol/osc94'
import { OscScanner, OscSequence } from '../protocol/oscScanner'
import { parseOscTitle } from '../protocol/oscTitle'
import { OscProgressEvent } from '../protocol/types'
import { Osc94Middleware } from './progressMiddleware'
import { TabProgressSink } from './progressSink'

interface Unsubscribable { unsubscribe (): void }

interface TabContext {
    config: NormalizedConfig
    sink: TabProgressSink
    controller: TabProgressController
    titleSource: TitleSource
    fallback: FallbackHeuristic
    registry: AdapterRegistry
    agent: AgentAdapter | null
    tail: string
    session: BaseSession | null
    middleware: Osc94Middleware | null
    feedSubscription: Unsubscribable | null
}

interface TabEntry {
    /**
     * Null while the plugin is disabled. The entry and its subscriptions are kept alive
     * regardless, so toggling `enabled` back on takes effect on already-open tabs
     * instead of only on tabs opened afterwards.
     */
    context: TabContext | null
    subscriptions: Subscription
}

@Injectable()
export class AiProgressDecorator extends TerminalDecorator {
    private readonly entries = new Map<BaseTerminalTabComponent<any>, TabEntry>()
    private readonly clock: Clock = {
        now: () => Date.now(),
        setInterval: (fn, ms) => globalThis.setInterval(fn, ms),
        clearInterval: handle => globalThis.clearInterval(handle as any),
    }

    constructor (private readonly configService: ConfigService) { super() }

    attach (tab: BaseTerminalTabComponent<any>): void {
        if (this.entries.has(tab)) return
        const config = normalizeConfig(this.configService.store)

        // Subscribe even when disabled: the config listener is what lets a later
        // enable reach this tab. Only the context (which owns the sink and the
        // monkey-patch) is withheld while disabled, so a disabled plugin touches nothing.
        const entry: TabEntry = { context: null, subscriptions: new Subscription() }
        this.entries.set(tab, entry)
        if (config.enabled) this.startContext(tab, entry, config)
        entry.subscriptions.add(tab.sessionChanged$.subscribe(() => this.replaceSession(tab, entry)))
        entry.subscriptions.add(this.configService.changed$.subscribe(() => this.reconfigure(tab, entry)))
    }

    detach (tab: BaseTerminalTabComponent<any>): void {
        const entry = this.entries.get(tab)
        if (entry) {
            this.stopContext(entry)
            entry.subscriptions.unsubscribe()
            this.entries.delete(tab)
        }
        super.detach(tab)
    }

    private startContext (tab: BaseTerminalTabComponent<any>, entry: TabEntry, config: NormalizedConfig): void {
        entry.context = this.createContext(tab, config)
        this.attachFeed(tab, entry.context)
    }

    private stopContext (entry: TabEntry): void {
        if (entry.context) {
            this.releaseContext(entry.context)
            entry.context = null
        }
    }

    private createContext (tab: BaseTerminalTabComponent<any>, config: NormalizedConfig): TabContext {
        const sink = new TabProgressSink(tab, config.suppressBuiltInDetection, config.debugLogging)
        const registry = new AdapterRegistry([...BUILTIN_ADAPTERS])
        const context: TabContext = {
            config,
            sink,
            controller: new TabProgressController({ config, sink, clock: this.clock }),
            titleSource: new TitleSource(config, this.clock, registry.all),
            fallback: new FallbackHeuristic(config, this.clock),
            registry,
            agent: null,
            tail: '',
            session: null,
            middleware: null,
            feedSubscription: null,
        }
        context.controller.setTickListener(() => {
            const state = context.fallback.onTick(context.agent)
            if (state) context.controller.applyFallback(state)
        })
        return context
    }

    private attachFeed (tab: BaseTerminalTabComponent<any>, context: TabContext): void {
        const session = tab.session ?? null
        context.session = session
        if (session) {
            const middleware = new Osc94Middleware(
                (sequences, chunk) => this.dispatch(context, sequences, chunk),
                () => context.config.stripSequences,
            )
            try {
                if (!(session as any).middleware) throw new Error('middleware unavailable')
                session.middleware.push(middleware)
                context.middleware = middleware
                this.log(context, 'using session middleware feed')
            } catch {
                context.middleware = null
            }
        }
        if (!context.middleware) {
            const scanner = new OscScanner()
            context.feedSubscription = tab.binaryOutput$.subscribe(chunk => {
                const data = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
                this.dispatch(context, scanner.push(data), data)
            })
            this.log(context, 'using binaryOutput$ fallback feed')
        }
    }

    private dispatch (context: TabContext, sequences: OscSequence[], chunk: Buffer): void {
        for (const sequence of sequences) {
            const progress = parseOsc94(sequence)
            if (progress) {
                context.controller.applyOscEvents([progress] as OscProgressEvent[])
                continue
            }
            const title = parseOscTitle(sequence)
            if (title !== null) {
                const state = context.titleSource.onTitle(title, context.agent)
                if (state) context.controller.applyTitle(state)
                if (!context.agent && context.titleSource.identifiedAgent) context.agent = context.titleSource.identifiedAgent
            }
        }

        const text = chunk.toString('utf8')
        context.tail = (context.tail + text).slice(-4096)
        if (!context.agent) context.agent = context.registry.identify(context.tail)
        if (context.config.fallback.enabled) {
            const fallback = context.fallback.onOutput(text, context.agent)
            if (fallback) context.controller.applyFallback(fallback)
        }
    }

    private replaceSession (tab: BaseTerminalTabComponent<any>, entry: TabEntry): void {
        if (!entry.context) return
        const config = entry.context.config
        this.stopContext(entry)
        this.startContext(tab, entry, config)
    }

    private reconfigure (tab: BaseTerminalTabComponent<any>, entry: TabEntry): void {
        const config = normalizeConfig(this.configService.store)
        if (!config.enabled) {
            // Tear the context down but keep the entry and its subscriptions, so a
            // later re-enable is seen by this tab.
            this.stopContext(entry)
            return
        }
        if (!entry.context) {
            this.startContext(tab, entry, config)
            return
        }
        entry.context.config = config
        entry.context.sink.setSuppressed(config.suppressBuiltInDetection)
        entry.context.sink.setDebugLogging(config.debugLogging)
        entry.context.controller.reconfigure(config)
        entry.context.titleSource = new TitleSource(config, this.clock, entry.context.registry.all)
        entry.context.fallback = new FallbackHeuristic(config, this.clock)
    }

    private releaseContext (context: TabContext): void {
        if (context.middleware && context.session) {
            try { context.session.middleware.remove(context.middleware) } catch {}
            context.middleware.reset()
        }
        context.feedSubscription?.unsubscribe()
        context.controller.dispose()
        context.sink.release()
    }

    private log (context: TabContext, message: string): void {
        if (context.config.debugLogging) console.debug(`[tabby-ai-progress] ${message}`)
    }
}
