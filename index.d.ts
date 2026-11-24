import { Terminal, FitAddon } from 'ghostty-web';
export type BinaryInput = ArrayBuffer | ArrayBufferView;
export type DecodedFrame = {
    channel: number;
    kind: number;
    payload: Uint8Array;
};
export type TerminalRecord = {
    address: string;
    name?: string;
    state?: string;
    title?: string;
    labels?: Record<string, string>;
    cols?: number;
    rows?: number;
    exit_code?: number;
    [key: string]: unknown;
};
export type WebSocketLike = {
    binaryType: string;
    readyState: number;
    onopen: ((event: Event) => void) | null;
    onerror: ((event: Event) => void) | null;
    onmessage: ((event: MessageEvent) => void) | null;
    onclose: ((event: CloseEvent) => void) | null;
    send: (data: string | ArrayBuffer | ArrayBufferView) => void;
    close: () => void;
};
export type WebSocketConstructor = new (url: string) => WebSocketLike;
export type HerdConnectionOptions = {
    /**
     * WebSocket endpoint for the herdr gateway.
     */
    url: string;
    /**
     * Authentication token added to the WebSocket URL.
     */
    token?: string;
    /**
     * WebSocket implementation, useful for non-browser hosts and tests.
     */
    WebSocket?: WebSocketConstructor;
    /**
     * Whether to reconnect after a disconnect.
     */
    reconnect?: boolean;
    /**
     * Initial reconnect delay in milliseconds.
     */
    reconnectDelay?: number;
    /**
     * Maximum reconnect delay in milliseconds.
     */
    maxReconnectDelay?: number;
    /**
     * RPC timeout in milliseconds.
     */
    rpcTimeout?: number;
};
export type HerdConnectionState = 'idle' | 'connecting' | 'connected' | 'ready' | 'disconnected' | 'reconnecting' | 'destroyed';
export type HerdConnectionStatusEvent = {
    state: HerdConnectionState;
    attempt: number;
    code?: number;
    reason?: string;
    delay?: number;
};
export type HerdTerminalsEvent = {
    terminals: TerminalRecord[];
};
export type HerdTerminalEvent = {
    type: string;
    terminal: string;
    data?: Record<string, unknown>;
};
export type HerdMissedEvent = {
    terminals: TerminalRecord[];
};
export type HerdErrorEvent = {
    error: unknown;
};
export type HerdConnectionEventMap = {
    /**
     * Connection lifecycle state changed.
     */
    status: HerdConnectionStatusEvent;
    /**
     * Initialization completed.
     */
    ready: HerdTerminalsEvent;
    /**
     * The terminal snapshot changed.
     */
    terminals: HerdTerminalsEvent;
    /**
     * A terminal event notification arrived.
     */
    event: HerdTerminalEvent;
    /**
     * Events were missed and the snapshot was replaced.
     */
    missed: HerdMissedEvent;
    /**
     * A socket or initialization error occurred.
     */
    error: HerdErrorEvent;
};
export type HerdListTerminalsOptions = {
    all?: boolean;
    labels?: Record<string, string>;
};
export type HerdCloseEvent = {
    reason?: string;
    exit_code?: number;
    [key: string]: unknown;
};
export type HerdAttachmentOptions = {
    /**
     * Terminal address.
     */
    terminal: string;
    /**
     * Initial column count.
     */
    cols: number;
    /**
     * Initial row count.
     */
    rows: number;
    /**
     * Number of history bytes to request.
     */
    history?: number;
    /**
     * Whether to attach in observer mode.
     */
    observe?: boolean;
    /**
     * Terminal output callback.
     */
    onData: (bytes: Uint8Array) => void;
    /**
     * Remote terminal resize callback.
     */
    onResize?: (cols: number, rows: number) => void;
    /**
     * Close callback.
     */
    onClose?: (reason: HerdCloseEvent | null) => void;
    /**
     * Disconnect callback.
     */
    onDisconnect?: () => void;
};
export type HerdAttachmentResult = {
    channel: number;
    terminal: TerminalRecord;
    /**
     * Whether core-to-viewer RESIZE notifications are enabled.
     */
    resize_notifications?: boolean;
};
export type HerdAttachment = {
    channel: number;
    result: HerdAttachmentResult;
    socket: WebSocketLike;
    open: boolean;
    onData: (bytes: Uint8Array) => void;
    onResize: ((cols: number, rows: number) => void) | undefined;
    onClose: ((reason: HerdCloseEvent | null) => void) | undefined;
    onDisconnect: (() => void) | undefined;
    write: (data: string | BinaryInput) => boolean;
    resize: (cols: number, rows: number) => boolean;
    focus: (focused: boolean) => boolean;
    close: () => void;
};
export type HerdTerminalOptions = import('ghostty-web').ITerminalOptions;
export type FocusTarget = {
    addEventListener?: (type: string, listener: EventListener) => void;
    removeEventListener?: (type: string, listener: EventListener) => void;
};
export type HerdViewOptions = {
    /**
     * Options passed to the ghostty-web terminal.
     */
    terminalOptions?: HerdTerminalOptions;
    /**
     * Number of history bytes to request on attach.
     */
    history?: number;
    /**
     * Whether to focus after attaching as a viewer.
     */
    autoFocus?: boolean;
    /**
     * Whether to observe the container size.
     */
    autoResize?: boolean;
    /**
     * Target for focus and blur listeners.
     */
    focusTarget?: FocusTarget | null;
};
export type HerdViewState = 'attaching' | 'attached' | 'reconnecting' | 'closed' | 'detached' | 'error' | 'destroyed';
export type HerdViewStatusEvent = {
    state: HerdViewState;
    address: string | null;
    observe: boolean;
    terminal?: TerminalRecord;
    reason?: HerdCloseEvent | null;
    error?: unknown;
};
export type HerdViewTitleEvent = {
    title: string;
};
export type HerdViewResizeEvent = {
    cols: number;
    rows: number;
};
export type HerdViewFocusEvent = {
    focused: boolean;
};
export type HerdViewEventMap = {
    /**
     * View lifecycle state changed.
     */
    status: HerdViewStatusEvent;
    /**
     * The terminal OSC title changed.
     */
    title: HerdViewTitleEvent;
    /**
     * The attached terminal closed.
     */
    closed: HerdCloseEvent;
    /**
     * The renderer dimensions changed.
     */
    resize: HerdViewResizeEvent;
    /**
     * Viewer focus was reported.
     */
    focus: HerdViewFocusEvent;
    /**
     * Automatic reattachment failed.
     */
    error: HerdErrorEvent;
};
declare class Emitter {
    /** @type {Map<string, Set<(detail: any) => void>>} */
    listeners: Map<string, Set<(detail: any) => void>>;
    constructor();
    /**
     * @template T
     * @param {string} type
     * @param {(detail: T) => void} listener
     * @returns {() => void}
     */
    on<T>(type: string, listener: (detail: T) => void): () => void;
    /** @param {string} type @param {any} detail */
    emit(type: string, detail: any): void;
    clear(): void;
}
/**
 * Create an incremental UTF-8 JSON-lines parser.
 * @param {(line: string) => void} onLine Callback for each complete JSON line.
 * @returns {(chunk: BinaryInput) => void} A function that accepts binary chunks.
 */
export declare function createJsonLineParser(onLine: (line: string) => void): (chunk: BinaryInput) => void;
/**
 * @param {number} channel
 * @param {number} kind
 * @param {BinaryInput} [payload]
 * @returns {Uint8Array}
 */
export declare function encodeFrame(channel: number, kind: number, payload?: BinaryInput): Uint8Array;
/**
 * @param {BinaryInput} input
 * @returns {DecodedFrame | null}
 */
export declare function decodeFrame(input: BinaryInput): DecodedFrame | null;
/** @param {number} bytes @returns {Uint8Array} */
export declare function encodeCredit(bytes: number): Uint8Array;
/** @param {number} cols @param {number} rows @returns {Uint8Array} */
export declare function encodeResize(cols: number, rows: number): Uint8Array;
/**
 * Decode a core-to-viewer RESIZE payload (uint16 LE columns, then rows).
 */
export declare function decodeResize(payload: BinaryInput): {
    cols: number;
    rows: number;
} | null;
/**
 * @param {string | URL} url
 * @param {string | null} [token]
 * @returns {string}
 */
export declare function webSocketUrl(url: string | URL, token?: string | null): string;
export declare class HerdConnection {
    url: string;
    token: string | undefined;
    /** @type {HerdConnectionState} */
    state: HerdConnectionState;
    reconnect: boolean;
    reconnectDelay: number;
    maxReconnectDelay: number;
    rpcTimeout: number;
    WebSocketClass: WebSocketConstructor;
    emitter: Emitter;
    /** @type {Map<string, TerminalRecord>} */
    records: Map<string, TerminalRecord>;
    /** @type {Map<number, any>} */
    pending: Map<number, any>;
    /** @type {Map<number, HerdAttachment>} */
    attachments: Map<number, HerdAttachment>;
    /** @type {Map<number, (chunk: BinaryInput) => void>} */
    parsers: Map<number, (chunk: BinaryInput) => void>;
    nextId: number;
    /** @type {WebSocketLike | null} */
    socket: WebSocketLike | null;
    gatewayReady: boolean;
    started: boolean;
    destroyed: boolean;
    attempt: number;
    /** @type {ReturnType<typeof setTimeout> | null} */
    reconnectTimer: ReturnType<typeof setTimeout> | null;
    /** @type {number | null} */
    eventsChannel: number | null;
    firstReady: {
        promise: Promise<boolean>;
        resolve: (value: boolean | PromiseLike<boolean>) => void;
        reject: (reason?: unknown) => void;
    };
    cycle: {
        promise: Promise<boolean>;
        resolve: (value: boolean | PromiseLike<boolean>) => void;
        reject: (reason?: unknown) => void;
    };
    constructor(options: HerdConnectionOptions);
    /**
     * Subscribe to a connection event.
     * @template {keyof HerdConnectionEventMap} T
     * @param {T} type
     * @param {(detail: HerdConnectionEventMap[T]) => void} listener
     * @returns {() => void} Unsubscribe function.
     */
    on<T extends keyof HerdConnectionEventMap>(type: T, listener: (detail: HerdConnectionEventMap[T]) => void): () => void;
    /** @returns {TerminalRecord[]} */
    get terminals(): TerminalRecord[];
    /** @param {string} address @returns {TerminalRecord | undefined} */
    getTerminal(address: string): TerminalRecord | undefined;
    /**
     * Connect and wait for the first successful initialization.
     * @returns {Promise<boolean>}
     * @fires HerdConnection#status
     * @fires HerdConnection#ready
     * @fires HerdConnection#terminals
     * @fires HerdConnection#error
     */
    connect(): Promise<boolean>;
    /** @returns {Promise<boolean>} Whether the current connection cycle initialized. */
    whenReady(): Promise<boolean>;
    /** @private @param {HerdConnectionState} state @param {Object} [detail] */
    private setState;
    /** @private */
    private openSocket;
    /** @private @param {WebSocketLike} socket @param {string} text */
    private handleText;
    /** @private @param {WebSocketLike} socket */
    private initialize;
    /** @private @param {WebSocketLike} socket @param {Partial<Pick<CloseEvent, 'code' | 'reason'>>} [event] */
    private handleClose;
    /** @private @param {Object} [detail] */
    private scheduleReconnect;
    /** @private @param {Error} error */
    private rejectPending;
    /** @private */
    private dropAttachments;
    /**
     * Call a herdr RPC method after the connection is ready.
     * @template T
     * @param {string} method
     * @param {Record<string, unknown>} [params]
     * @returns {Promise<T>}
     */
    rpc<T>(method: string, params?: Record<string, unknown>): Promise<T>;
    /**
     * @private
     * @template T
     * @param {string} method
     * @param {Record<string, unknown>} params
     * @returns {Promise<T>}
     */
    private rpcNow;
    /** @private @param {WebSocketLike} socket @param {BinaryInput} input */
    private handleBinary;
    /** @private @param {string} line */
    private handleJsonLine;
    /** @private @param {any} result */
    private rememberResult;
    /** @private @param {any} message */
    private handleNotification;
    /** @private @param {TerminalRecord[]} terminals @param {boolean} [notify] */
    private replaceTerminals;
    /** @private @param {HerdTerminalEvent} event */
    private applyEvent;
    /**
     * Refresh and return the current terminal records.
     * @param {HerdListTerminalsOptions} [options]
     * @returns {Promise<TerminalRecord[]>}
     * @fires HerdConnection#terminals
     */
    listTerminals({ all, labels }?: HerdListTerminalsOptions): Promise<TerminalRecord[]>;
    /**
     * Send a binary frame on the active socket.
     * @param {number} channel
     * @param {number} kind
     * @param {BinaryInput} [payload]
     * @param {WebSocketLike | null} [socket]
     * @returns {boolean} Whether the frame was sent.
     */
    sendFrame(channel: number, kind: number, payload?: BinaryInput, socket?: WebSocketLike | null): boolean;
    /**
     * Attach to a terminal and create its binary channel.
     * @param {HerdAttachmentOptions} options
     * @returns {Promise<HerdAttachment>}
     */
    openAttachment({ terminal, cols, rows, history, observe, onData, onResize, onClose, onDisconnect }: HerdAttachmentOptions): Promise<HerdAttachment>;
    /**
     * Stop reconnecting, close streams, and release listeners.
     * @returns {void}
     * @fires HerdConnection#status
     */
    destroy(): void;
}
export declare class HerdView {
    connection: HerdConnection;
    terminalOptions: import("ghostty-web").ITerminalOptions;
    history: number;
    autoFocus: boolean;
    autoResize: boolean;
    focusTarget: FocusTarget | null;
    emitter: Emitter;
    /** @type {HTMLElement | null} */
    container: HTMLElement | null;
    /** @type {string | null} */
    address: string | null;
    observe: boolean;
    /** @type {HerdAttachment | null} */
    attachment: HerdAttachment | null;
    /** @type {Terminal | null} */
    terminal: Terminal | null;
    /** @type {FitAddon | null} */
    fit: FitAddon | null;
    /** @type {Array<{ dispose: () => void }>} */
    disposables: Array<{
        dispose: () => void;
    }>;
    generation: number;
    wantsAttach: boolean;
    reconnectNeeded: boolean;
    destroyed: boolean;
    handleWindowFocus: () => boolean;
    handleWindowBlur: () => boolean;
    offConnection: () => void;
    /**
     * @param {HerdConnection} connection
     * @param {HerdViewOptions} [options]
     */
    constructor(connection: HerdConnection, { terminalOptions, history, autoFocus, autoResize, focusTarget, }?: HerdViewOptions);
    /**
     * Subscribe to a view event.
     * @template {keyof HerdViewEventMap} T
     * @param {T} type
     * @param {(detail: HerdViewEventMap[T]) => void} listener
     * @returns {() => void} Unsubscribe function.
     */
    on<T extends keyof HerdViewEventMap>(type: T, listener: (detail: HerdViewEventMap[T]) => void): () => void;
    /** @returns {boolean} */
    get active(): boolean;
    /**
     * Set the element owned by this view while attached.
     * @param {HTMLElement} element
     * @returns {this}
     */
    mount(element: HTMLElement): this;
    /** @private @param {HerdViewState} state @param {Object} [detail] */
    private emitStatus;
    /**
     * Attach and render first paint plus live output.
     * @param {string} address Terminal address.
     * @param {{ observe?: boolean }} [options]
     * @returns {Promise<this>}
     * @fires HerdView#status
     * @fires HerdView#title
     * @fires HerdView#closed
     * @fires HerdView#resize
     */
    attach(address: string, { observe }?: {
        observe?: boolean;
    }): Promise<this>;
    /**
     * Reattach in viewer or observer mode.
     * @param {boolean} observe
     * @returns {Promise<this>}
     * @fires HerdView#status
     */
    setObserve(observe: boolean): Promise<this>;
    /**
     * Send keyboard-equivalent input.
     * @param {string | BinaryInput} data
     * @returns {boolean} `false` in observer mode or while inactive.
     */
    write(data: string | BinaryInput): boolean;
    /**
     * Focus the terminal and report focus for a viewer.
     * @returns {boolean} Whether focus was reported.
     * @fires HerdView#focus
     */
    focus(): boolean;
    /** @private @param {boolean} focused @returns {boolean} */
    private reportFocus;
    /**
     * Close the attachment and dispose the renderer.
     * @returns {void}
     * @fires HerdView#status
     */
    detach(): void;
    /** @private */
    private disposeTerminal;
    /**
     * Permanently release the view and its listeners.
     * @returns {void}
     * @fires HerdView#status
     */
    destroy(): void;
}
export {};
