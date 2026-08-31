import { describe, expect, it } from 'vitest'
import { OscScanner, stripOsc94 } from './oscScanner'
import { parseOsc94 } from './osc94'
import { parseOscTitle } from './oscTitle'
import { OscProgressEvent, OscProgressState } from './types'

const b = (value: string): Buffer => Buffer.from(value, 'latin1')

function feed (scanner: OscScanner, value: string): OscProgressEvent[] {
    return scanner.push(b(value)).map(parseOsc94).filter((event): event is OscProgressEvent => event !== null)
}

describe('OscScanner and parseOsc94', () => {
    it.each([
        ['\x1b]9;4;0\x07', OscProgressState.Remove, null],
        ['\x1b]9;4;1;50\x07', OscProgressState.Normal, 50],
        ['\x1b]9;4;2\x07', OscProgressState.Error, null],
        ['\x1b]9;4;3\x07', OscProgressState.Indeterminate, null],
        ['\x1b]9;4;4\x07', OscProgressState.Paused, null],
        ['\x1b]9;4;4;70\x07', OscProgressState.Paused, 70],
        ['\x1b]9;4;1;25\x1b\\', OscProgressState.Normal, 25],
        ['\x1b]9;4;1;0\x07', OscProgressState.Normal, 0],
        ['\x1b]9;4;1;100\x07', OscProgressState.Normal, 100],
        ['\x1b]9;4;1;150\x07', OscProgressState.Normal, 100],
        ['\x1b]9;4;1;abc\x07', OscProgressState.Normal, null],
        ['\x1b]9;4;1;50.5\x07', OscProgressState.Normal, null],
        ['\x1b]9;4;1;-5\x07', OscProgressState.Normal, null],
        ['\x1b]9;4;1;\x07', OscProgressState.Normal, null],
        ['\x1b]9;4;0;\x07', OscProgressState.Remove, null],
    ])('parses %j', (wire, state, progress) => {
        const terminatorLength = wire.endsWith('\x1b\\') ? 2 : 1
        expect(feed(new OscScanner(), wire)).toEqual([{ state, progress, raw: wire.slice(2, -terminatorLength) }])
    })

    it('treats the three- and four-field clear forms equivalently', () => {
        const first = feed(new OscScanner(), '\x1b]9;4;0\x07')[0]
        const second = feed(new OscScanner(), '\x1b]9;4;0;\x07')[0]
        expect({ state: first.state, progress: first.progress }).toEqual({ state: second.state, progress: second.progress })
    })

    it.each(['\x1b]9;4;9\x07', '\x1b]9;4;01\x07', '\x1b]9;4;\x07'])(
        'rejects invalid state in %j', wire => expect(feed(new OscScanner(), wire)).toEqual([]),
    )

    it('handles every two-chunk split point', () => {
        const wire = '\x1b]9;4;1;42\x07'
        for (let i = 1; i < wire.length; i++) {
            const scanner = new OscScanner()
            expect([...feed(scanner, wire.slice(0, i)), ...feed(scanner, wire.slice(i))]).toMatchObject([
                { state: OscProgressState.Normal, progress: 42 },
            ])
        }
    })

    it('handles three chunks including a split inside an ST terminator', () => {
        const scanner = new OscScanner()
        expect([
            ...feed(scanner, '\x1b]9;4;'),
            ...feed(scanner, '1;42\x1b'),
            ...feed(scanner, '\\'),
        ]).toMatchObject([{ state: OscProgressState.Normal, progress: 42 }])
    })

    it('handles byte-at-a-time input', () => {
        const scanner = new OscScanner()
        const events = [...b('\x1b]9;4;1;42\x07')].flatMap(byte => scanner.push(Uint8Array.of(byte))).map(parseOsc94).filter(Boolean)
        expect(events).toHaveLength(1)
        expect(events[0]).toMatchObject({ progress: 42 })
    })

    it('finds sequences around garbage and returns multiples in order', () => {
        expect(feed(new OscScanner(), 'hello\x1b]9;4;1;10\x07junk\x1b]9;4;1;90\x07world').map(x => x.progress)).toEqual([10, 90])
    })

    it('coexists with title OSC and skips other codes', () => {
        const sequences = new OscScanner().push(b('\x1b]0;title\x07\x1b]9;4;3\x07\x1b]7;file:///tmp\x07'))
        expect(sequences.map(x => [x.code, x.body])).toEqual([[0, 'title'], [9, '4;3']])
        expect(sequences.map(parseOsc94).filter(Boolean)).toHaveLength(1)
        expect(sequences.map(parseOscTitle).filter(x => x !== null)).toEqual(['title'])
    })

    it.each(['\x1b]9;Build finished\x07', '\x1b]9;12;x\x07'])(
        'does not confuse OSC 9 notifications with progress', wire => expect(feed(new OscScanner(), wire)).toEqual([]),
    )

    // Regression guard for the `4;` disambiguation in parseOsc94.
    // The cases above all die on state validation instead, so they pass even when the
    // `4;` check is deleted. These do not: the second field is a valid state digit, so
    // without the check an ordinary OSC 9 desktop notification — the form Codex CLI
    // emits — would drive the progress bar. Found by mutation testing.
    it.each([
        '\x1b]9;Done;3\x07',
        '\x1b]9;Build;0\x07',
        '\x1b]9;Tests passed;1\x07',
        '\x1b]9;41;2\x07',
    ])('does not treat OSC 9 notification %j as progress', wire =>
        expect(feed(new OscScanner(), wire)).toEqual([]),
    )

    it('recovers an overlapping introducer', () => {
        expect(feed(new OscScanner(), '\x1b]\x1b]9;4;3\x07')).toMatchObject([{ state: OscProgressState.Indeterminate }])
    })

    it('holds an unterminated sequence and emits when BEL arrives', () => {
        const scanner = new OscScanner()
        expect(feed(scanner, '\x1b]9;4;1;50')).toEqual([])
        expect(scanner.pendingLength).toBeGreaterThan(0)
        expect(feed(scanner, '\x07')).toMatchObject([{ progress: 50 }])
    })

    it('bounds pending data and recovers after overflow', () => {
        const scanner = new OscScanner({ maxPendingBytes: 32 })
        expect(feed(scanner, '\x1b]9;4;1;' + 'A'.repeat(1000))).toEqual([])
        expect(scanner.pendingLength).toBeLessThanOrEqual(32)
        expect(feed(scanner, '\x1b]9;4;3\x07')).toMatchObject([{ state: OscProgressState.Indeterminate }])
    })

    it('drops an oversized candidate even when its terminator is in the same chunk', () => {
        const scanner = new OscScanner({ maxPendingBytes: 32 })
        expect(feed(scanner, '\x1b]9;4;1;' + '1'.repeat(100) + '\x07')).toEqual([])
        expect(feed(scanner, '\x1b]9;4;3\x07')).toMatchObject([{ state: OscProgressState.Indeterminate }])
    })

    it('reset drops pending state', () => {
        const scanner = new OscScanner()
        feed(scanner, '\x1b]9;4;1;')
        scanner.reset()
        expect(feed(scanner, '50\x07')).toEqual([])
    })

    it('never throws on deterministic binary noise and remains bounded', () => {
        let seed = 0x12345678
        const noise = new Uint8Array(4096)
        for (let i = 0; i < noise.length; i++) {
            seed = (seed * 1664525 + 1013904223) >>> 0
            noise[i] = seed & 0xff
        }
        const scanner = new OscScanner({ maxPendingBytes: 64 })
        expect(() => scanner.push(noise)).not.toThrow()
        expect(scanner.pendingLength).toBeLessThanOrEqual(64)
    })

    it('finds a sequence amid UTF-8 text', () => {
        const wire = Buffer.concat([Buffer.from('привет 🎉'), b('\x1b]9;4;3\x07'), Buffer.from('мир')])
        expect(new OscScanner().push(wire).map(parseOsc94).filter(Boolean)).toMatchObject([{ state: OscProgressState.Indeterminate }])
    })

    it('does not accept C1 ST as a terminator', () => {
        const scanner = new OscScanner()
        expect(scanner.push(b('\x1b]9;4;3\x9c'))).toEqual([])
        expect(scanner.pendingLength).toBeGreaterThan(0)
    })
})

describe('stripOsc94', () => {
    it('removes complete progress sequences and preserves surrounding bytes', () => {
        expect(Buffer.from(stripOsc94(b('hello\x1b]9;4;3\x07world'))).toString('latin1')).toBe('helloworld')
    })

    it('removes multiple complete progress sequences', () => {
        expect(Buffer.from(stripOsc94(b('a\x1b]9;4;3\x07b\x1b]9;4;0\x1b\\c'))).toString('latin1')).toBe('abc')
    })

    it.each(['plain text', '\x1b]9;4;3', '\x1b]9;Build finished\x07'])(
        'leaves non-complete-progress input byte-identical: %j', wire => {
            expect(Buffer.from(stripOsc94(b(wire)))).toEqual(b(wire))
        },
    )
})
