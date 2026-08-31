import { Clock, ProgressSink } from './types'

export class ManualClock implements Clock {
    time = 0
    readonly periods: number[] = []
    readonly cleared: unknown[] = []
    private nextHandle = 1
    private readonly callbacks = new Map<number, () => void>()

    now (): number { return this.time }
    setInterval (fn: () => void, ms: number): unknown {
        const handle = this.nextHandle++
        this.callbacks.set(handle, fn)
        this.periods.push(ms)
        return handle
    }
    clearInterval (handle: unknown): void {
        this.cleared.push(handle)
        this.callbacks.delete(handle as number)
    }
    advance (ms: number): void { this.time += ms }
    tick (count = 1): void {
        for (let i = 0; i < count; i++) [...this.callbacks.values()].forEach(callback => callback())
    }
}

export class RecordingSink implements ProgressSink {
    readonly progress: Array<number | null> = []
    readonly attention: boolean[] = []
    readonly colors: Array<string | null> = []
    setProgress (value: number | null): void { this.progress.push(value) }
    setAttention (on: boolean): void { this.attention.push(on) }
    setColor (color: string | null): void { this.colors.push(color) }
}
