/** One complete OSC sequence lifted out of the stream. */
export interface OscSequence {
    readonly code: number
    readonly body: string
    readonly raw: string
}

export interface OscScannerOptions {
    readonly codes?: readonly number[]
    readonly maxPendingBytes?: number
}

const ESC = 0x1b
const OSC = 0x5d
const BEL = 0x07
const ST_SECOND = 0x5c

function concat (left: Uint8Array, right: Uint8Array): Uint8Array {
    if (left.length === 0) return right
    const result = new Uint8Array(left.length + right.length)
    result.set(left)
    result.set(right, left.length)
    return result
}

function decodeSequence (bytes: Uint8Array): OscSequence {
    const raw = Buffer.from(bytes).toString('latin1')
    const separator = raw.indexOf(';')
    const codeText = separator === -1 ? raw : raw.slice(0, separator)
    return {
        code: /^\d+$/.test(codeText) ? Number(codeText) : Number.NaN,
        body: separator === -1 ? '' : raw.slice(separator + 1),
        raw,
    }
}

export class OscScanner {
    private readonly codes: ReadonlySet<number>
    private readonly maxPendingBytes: number
    private pending = new Uint8Array(0)

    constructor (options: OscScannerOptions = {}) {
        this.codes = new Set(options.codes ?? [0, 2, 9])
        const requestedCap = options.maxPendingBytes ?? 512
        this.maxPendingBytes = Number.isFinite(requestedCap) && requestedCap >= 2
            ? Math.floor(requestedCap)
            : 512
    }

    push (chunk: Uint8Array): OscSequence[] {
        try {
            const data = concat(this.pending, chunk)
            this.pending = new Uint8Array(0)
            const found: OscSequence[] = []
            let cursor = 0

            while (cursor < data.length) {
                const introducer = this.findIntroducer(data, cursor)
                if (introducer === -1) {
                    if (data.length > 0 && data[data.length - 1] === ESC) {
                        this.pending = data.slice(data.length - 1)
                    }
                    break
                }

                const code = this.readCode(data, introducer + 2)
                if (code.kind === 'nested') {
                    cursor = code.index
                    continue
                }
                if (code.kind === 'incomplete') {
                    const length = data.length - introducer
                    if (length <= this.maxPendingBytes) {
                        this.pending = data.slice(introducer)
                        break
                    }
                    cursor = introducer + 1
                    continue
                }
                if (!this.codes.has(code.value)) {
                    // Resume immediately after ESC so overlapping introducers remain visible.
                    cursor = introducer + 1
                    continue
                }

                const boundary = this.findBoundary(data, introducer + 2)
                if (boundary.kind === 'nested') {
                    cursor = boundary.index
                    continue
                }
                if (boundary.kind === 'incomplete') {
                    const length = data.length - introducer
                    if (length <= this.maxPendingBytes) {
                        this.pending = data.slice(introducer)
                        break
                    }
                    cursor = introducer + 1
                    continue
                }

                if (boundary.index + boundary.length - introducer > this.maxPendingBytes) {
                    cursor = introducer + 1
                    continue
                }

                const sequence = decodeSequence(data.slice(introducer + 2, boundary.index))
                if (this.codes.has(sequence.code)) found.push(sequence)
                cursor = boundary.index + boundary.length
            }

            return found
        } catch {
            this.reset()
            return []
        }
    }

    reset (): void {
        this.pending = new Uint8Array(0)
    }

    get pendingLength (): number {
        return this.pending.length
    }

    private findIntroducer (data: Uint8Array, from: number): number {
        for (let i = from; i + 1 < data.length; i++) {
            if (data[i] === ESC && data[i + 1] === OSC) return i
        }
        return -1
    }

    private findBoundary (
        data: Uint8Array,
        from: number,
    ): { kind: 'terminator', index: number, length: number } | { kind: 'nested', index: number } | { kind: 'incomplete' } {
        for (let i = from; i < data.length; i++) {
            if (data[i] === BEL) return { kind: 'terminator', index: i, length: 1 }
            if (data[i] === ESC && i + 1 < data.length) {
                if (data[i + 1] === ST_SECOND) return { kind: 'terminator', index: i, length: 2 }
                if (data[i + 1] === OSC) return { kind: 'nested', index: i }
            }
            // C1 ST (0x9c) is deliberately not accepted: it may be a UTF-8 continuation byte.
        }
        return { kind: 'incomplete' }
    }

    private readCode (
        data: Uint8Array,
        from: number,
    ): { kind: 'code', value: number } | { kind: 'nested', index: number } | { kind: 'incomplete' } {
        for (let i = from; i < data.length; i++) {
            if (data[i] === 0x3b || data[i] === BEL || (data[i] === ESC && i + 1 < data.length && data[i + 1] === ST_SECOND)) {
                const text = Buffer.from(data.slice(from, i)).toString('latin1')
                return { kind: 'code', value: /^\d+$/.test(text) ? Number(text) : Number.NaN }
            }
            if (data[i] === ESC && i + 1 < data.length && data[i + 1] === OSC) {
                return { kind: 'nested', index: i }
            }
        }
        return { kind: 'incomplete' }
    }
}

/** Removes complete OSC 9;4 sequences while preserving every other byte. */
export function stripOsc94 (chunk: Uint8Array): Uint8Array {
    try {
        const ranges: Array<[number, number]> = []
        let cursor = 0
        while (cursor + 1 < chunk.length) {
            let start = -1
            for (let i = cursor; i + 1 < chunk.length; i++) {
                if (chunk[i] === ESC && chunk[i + 1] === OSC) {
                    start = i
                    break
                }
            }
            if (start === -1) break

            let end = -1
            let terminatorLength = 0
            let nested = -1
            for (let i = start + 2; i < chunk.length; i++) {
                if (chunk[i] === BEL) {
                    end = i
                    terminatorLength = 1
                    break
                }
                if (chunk[i] === ESC && i + 1 < chunk.length) {
                    if (chunk[i + 1] === ST_SECOND) {
                        end = i
                        terminatorLength = 2
                        break
                    }
                    if (chunk[i + 1] === OSC) {
                        nested = i
                        break
                    }
                }
            }
            if (nested !== -1) {
                cursor = nested
                continue
            }
            if (end === -1) break

            const sequence = decodeSequence(chunk.slice(start + 2, end))
            if (sequence.code === 9 && (sequence.body === '4' || sequence.body.startsWith('4;'))) {
                ranges.push([start, end + terminatorLength])
            }
            cursor = end + terminatorLength
        }

        if (ranges.length === 0) return chunk
        const size = chunk.length - ranges.reduce((sum, [start, end]) => sum + end - start, 0)
        const result = new Uint8Array(size)
        let source = 0
        let target = 0
        for (const [start, end] of ranges) {
            result.set(chunk.slice(source, start), target)
            target += start - source
            source = end
        }
        result.set(chunk.slice(source), target)
        return result
    } catch {
        return chunk
    }
}
