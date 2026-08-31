/** Raw states of the OSC 9;4 protocol, as sent on the wire. */
export enum OscProgressState {
    Remove = 0,
    Normal = 1,
    Error = 2,
    Indeterminate = 3,
    Paused = 4,
}

/** One successfully parsed OSC 9;4 sequence. */
export interface OscProgressEvent {
    readonly state: OscProgressState
    /** Integer 0..100 when the sequence carried a usable percentage, else null. */
    readonly progress: number | null
    /** The raw payload between ESC ] and the terminator, for debugging. */
    readonly raw: string
}
