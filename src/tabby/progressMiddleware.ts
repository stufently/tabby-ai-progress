import { SessionMiddleware } from 'tabby-terminal'
import { OscScanner, OscSequence, stripOsc94 } from '../protocol/oscScanner'

export class Osc94Middleware extends SessionMiddleware {
    private readonly scanner = new OscScanner()

    constructor (
        private readonly onChunk: (sequences: OscSequence[], chunk: Buffer) => void,
        private readonly strip: () => boolean,
    ) {
        super()
    }

    feedFromSession (data: Buffer): void {
        const sequences = this.scanner.push(data)
        try { this.onChunk(sequences, data) } catch {
            // Observability must never interrupt terminal output.
        }
        let outgoing = data
        try {
            if (this.strip()) outgoing = Buffer.from(stripOsc94(data))
        } catch {
            outgoing = data
        }
        super.feedFromSession(outgoing)
    }

    reset (): void { this.scanner.reset() }
}
