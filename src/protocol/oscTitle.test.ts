import { describe, expect, it } from 'vitest'
import { OscScanner } from './oscScanner'
import { parseOscTitle } from './oscTitle'

const scanOne = (wire: string) => parseOscTitle(new OscScanner({ codes: [0, 1, 2, 9] }).push(Buffer.from(wire, 'latin1'))[0])

describe('parseOscTitle', () => {
    it.each([
        ['\x1b]0;hello\x07', 'hello'],
        ['\x1b]2;hello\x07', 'hello'],
        ['\x1b]0;\x07', ''],
        ['\x1b]0;hello\0\0\x07', 'hello'],
        ['\x1b]1;icon\x07', null],
        ['\x1b]9;4;3\x07', null],
    ])('interprets %j', (wire, expected) => expect(scanOne(wire)).toBe(expected))
})
