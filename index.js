import { init, Terminal, FitAddon } from 'ghostty-web';

/** @typedef {ArrayBuffer | ArrayBufferView} BinaryInput */

/**
 * @typedef {Object} DecodedFrame
 * @property {number} channel
 * @property {number} kind
 * @property {Uint8Array} payload
 */

/**
 * @typedef {{
 *   address: string,
 *   name?: string,
 *   state?: string,
 *   title?: string,
 *   labels?: Record<string, string>,
 *   cols?: number,
 *   rows?: number,
 *   exit_code?: number,
 *   [key: string]: unknown,
 * }} TerminalRecord
 */

/**
 * @typedef {Object} WebSocketLike
 * @property {string} binaryType
 * @property {number} readyState
 * @property {((event: Event) => void) | null} onopen
 * @property {((event: Event) => void) | null} onerror
 * @property {((event: MessageEvent) => void) | null} onmessage
 * @property {((event: CloseEvent) => void) | null} onclose
 * @property {(data: string | ArrayBuffer | ArrayBufferView) => void} send
 * @property {() => void} close
 */

/** @typedef {new (url: string) => WebSocketLike} WebSocketConstructor */

/**
 * @typedef {Object} HerdConnectionOptions
 * @property {string} url WebSocket endpoint for the herdr gateway.
 * @property {string} [token] Authentication token added to the WebSocket URL.
 * @property {WebSocketConstructor} [WebSocket] WebSocket implementation, useful for non-browser hosts and tests.
 * @property {boolean} [reconnect=true] Whether to reconnect after a disconnect.
 * @property {number} [reconnectDelay=500] Initial reconnect delay in milliseconds.
 * @property {number} [maxReconnectDelay=10000] Maximum reconnect delay in milliseconds.
 * @property {number} [rpcTimeout=20000] RPC timeout in milliseconds.
 */

/** @typedef {'idle' | 'connecting' | 'connected' | 'ready' | 'disconnected' | 'reconnecting' | 'destroyed'} HerdConnectionState */

/**
 * @typedef {Object} HerdConnectionStatusEvent
 * @property {HerdConnectionState} state
 * @property {number} attempt
 * @property {number} [code]
 * @property {string} [reason]
 * @property {number} [delay]
 */

/**
 * @typedef {Object} HerdTerminalsEvent
 * @property {TerminalRecord[]} terminals
 */

/**
 * @typedef {Object} HerdTerminalEvent
 * @property {string} type
 * @property {string} terminal
 * @property {Record<string, unknown>} [data]
 */

/**
 * @typedef {Object} HerdMissedEvent
 * @property {TerminalRecord[]} terminals
 */

/**
 * @typedef {Object} HerdErrorEvent
 * @property {unknown} error
 */

/**
 * @typedef {Object} HerdConnectionEventMap
 * @property {HerdConnectionStatusEvent} status Connection lifecycle state changed.
 * @property {HerdTerminalsEvent} ready Initialization completed.
 * @property {HerdTerminalsEvent} terminals The terminal snapshot changed.
 * @property {HerdTerminalEvent} event A terminal event notification arrived.
 * @property {HerdMissedEvent} missed Events were missed and the snapshot was replaced.
 * @property {HerdErrorEvent} error A socket or initialization error occurred.
 */

/**
 * @typedef {Object} HerdListTerminalsOptions
 * @property {boolean} [all=true]
 * @property {Record<string, string>} [labels]
 */

/** @typedef {{ reason?: string, exit_code?: number, [key: string]: unknown }} HerdCloseEvent */

/**
 * @typedef {Object} HerdAttachmentOptions
 * @property {string} terminal Terminal address.
 * @property {number} cols Initial column count.
 * @property {number} rows Initial row count.
 * @property {number} [history=500] Number of history bytes to request.
 * @property {boolean} [observe=false] Whether to attach in observer mode.
 * @property {(bytes: Uint8Array) => void} onData Terminal output callback.
 * @property {(reason: HerdCloseEvent | null) => void} [onClose] Close callback.
 * @property {() => void} [onDisconnect] Disconnect callback.
 */

/**
 * @typedef {Object} HerdAttachmentResult
 * @property {number} channel
 * @property {TerminalRecord} terminal
 */

/**
 * @typedef {Object} HerdAttachment
 * @property {number} channel
 * @property {HerdAttachmentResult} result
 * @property {WebSocketLike} socket
 * @property {boolean} open
 * @property {(bytes: Uint8Array) => void} onData
 * @property {((reason: HerdCloseEvent | null) => void) | undefined} onClose
 * @property {(() => void) | undefined} onDisconnect
 * @property {(data: string | BinaryInput) => boolean} write
 * @property {(cols: number, rows: number) => boolean} resize
 * @property {(focused: boolean) => boolean} focus
 * @property {() => void} close
 */

/** @typedef {import('ghostty-web').ITerminalOptions} HerdTerminalOptions */

/**
 * @typedef {Object} FocusTarget
 * @property {(type: string, listener: EventListener) => void} [addEventListener]
 * @property {(type: string, listener: EventListener) => void} [removeEventListener]
 */

/**
 * @typedef {Object} HerdViewOptions
 * @property {HerdTerminalOptions} [terminalOptions] Options passed to the ghostty-web terminal.
 * @property {number} [history=500] Number of history bytes to request on attach.
 * @property {boolean} [autoFocus=true] Whether to focus after attaching as a viewer.
 * @property {boolean} [autoResize=true] Whether to observe the container size.
 * @property {FocusTarget | null} [focusTarget=globalThis.window] Target for focus and blur listeners.
 */

/** @typedef {'attaching' | 'attached' | 'reconnecting' | 'closed' | 'detached' | 'error' | 'destroyed'} HerdViewState */

/**
 * @typedef {Object} HerdViewStatusEvent
 * @property {HerdViewState} state
 * @property {string | null} address
 * @property {boolean} observe
 * @property {TerminalRecord} [terminal]
 * @property {HerdCloseEvent | null} [reason]
 * @property {unknown} [error]
 */

/** @typedef {{ title: string }} HerdViewTitleEvent */
/** @typedef {{ cols: number, rows: number }} HerdViewResizeEvent */
/** @typedef {{ focused: boolean }} HerdViewFocusEvent */

/**
 * @typedef {Object} HerdViewEventMap
 * @property {HerdViewStatusEvent} status View lifecycle state changed.
 * @property {HerdViewTitleEvent} title The terminal OSC title changed.
 * @property {HerdCloseEvent} closed The attached terminal closed.
 * @property {HerdViewResizeEvent} resize The renderer dimensions changed.
 * @property {HerdViewFocusEvent} focus Viewer focus was reported.
 * @property {HerdErrorEvent} error Automatic reattachment failed.
 */

const DATA = 0;
const CREDIT = 1;
const CLOSE = 2;
const RESIZE = 3;
const FOCUS = 4;
const EMPTY = new Uint8Array(0);
const encoder = new TextEncoder();
const decoder = new TextDecoder();

class Emitter {
  constructor() {
    /** @type {Map<string, Set<(detail: any) => void>>} */
    this.listeners = new Map();
  }

  /**
   * @template T
   * @param {string} type
   * @param {(detail: T) => void} listener
   * @returns {() => void}
   */
  on(type, listener) {
    if (typeof listener !== 'function') throw new TypeError('listener must be a function');
    let listeners = this.listeners.get(type);
    if (!listeners) {
      listeners = new Set();
      this.listeners.set(type, listeners);
    }
    listeners.add(listener);
    return () => {
      listeners.delete(listener);
      if (!listeners.size) this.listeners.delete(type);
    };
  }

  /** @param {string} type @param {any} detail */
  emit(type, detail) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(detail);
  }

  clear() {
    this.listeners.clear();
  }
}

/**
 * @returns {{
 *   promise: Promise<boolean>,
 *   resolve: (value: boolean | PromiseLike<boolean>) => void,
 *   reject: (reason?: unknown) => void,
 * }}
 */
const deferred = () => {
  let resolve;
  let reject;
  /** @type {Promise<boolean>} */
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

/**
 * @param {BinaryInput} value
 * @returns {Uint8Array}
 */
const asBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('expected an ArrayBuffer or typed array');
};

/**
 * Resynchronize the arbitrarily sliced history payload at an explicit escape
 * boundary. Printable bytes before that boundary might be OSC/DCS payload, so
 * feeding them to a fresh parser can render fragments as terminal text.
 *
 * Only the first non-empty payload is replay; later live output must pass
 * through unchanged, including plain text without any escape sequences.
 *
 * @param {(bytes: Uint8Array) => void} onData
 * @returns {(bytes: Uint8Array) => void}
 */
const createHistoryReplayHandler = (onData) => {
  let replay = true;
  return (bytes) => {
    if (!replay) {
      onData(bytes);
      return;
    }
    if (bytes.byteLength === 0) return;
    replay = false;
    const start = bytes.indexOf(0x1b);
    if (start !== -1) onData(bytes.subarray(start));
  };
};

/**
 * Create an incremental UTF-8 JSON-lines parser.
 * @param {(line: string) => void} onLine Callback for each complete JSON line.
 * @returns {(chunk: BinaryInput) => void} A function that accepts binary chunks.
 */
export function createJsonLineParser(onLine) {
  const textDecoder = new TextDecoder();
  let pending = '';

  return (chunk) => {
    pending += textDecoder.decode(chunk, { stream: true });
    let newline;
    while ((newline = pending.indexOf('\n')) !== -1) {
      const line = pending.slice(0, newline);
      if (line.trim()) onLine(line);
      pending = pending.slice(newline + 1);
    }
    if (pending.trim()) {
      try {
        JSON.parse(pending);
        onLine(pending);
        pending = '';
      } catch {}
    }
  };
}

/**
 * @param {number} channel
 * @param {number} kind
 * @param {BinaryInput} [payload]
 * @returns {Uint8Array}
 */
export function encodeFrame(channel, kind, payload = EMPTY) {
  const bytes = asBytes(payload);
  const output = new Uint8Array(9 + bytes.byteLength);
  const view = new DataView(output.buffer);
  view.setUint32(0, channel, true);
  view.setUint8(4, kind);
  view.setUint32(5, bytes.byteLength, true);
  output.set(bytes, 9);
  return output;
}

/**
 * @param {BinaryInput} input
 * @returns {DecodedFrame | null}
 */
export function decodeFrame(input) {
  const bytes = asBytes(input);
  if (bytes.byteLength < 9) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const length = view.getUint32(5, true);
  if (length !== bytes.byteLength - 9) return null;
  return {
    channel: view.getUint32(0, true),
    kind: view.getUint8(4),
    payload: bytes.subarray(9),
  };
}

/** @param {number} bytes @returns {Uint8Array} */
export function encodeCredit(bytes) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, bytes, true);
  return output;
}

/** @param {number} cols @param {number} rows @returns {Uint8Array} */
export function encodeResize(cols, rows) {
  const output = new Uint8Array(4);
  const view = new DataView(output.buffer);
  view.setUint16(0, cols, true);
  view.setUint16(2, rows, true);
  return output;
}

/**
 * @param {string | URL} url
 * @param {string | null} [token]
 * @returns {string}
 */
export function webSocketUrl(url, token) {
  const result = new URL(url, globalThis.location?.origin);
  if (token != null) result.searchParams.set('token', token);
  return result.href;
}

/** @param {Uint8Array} payload @returns {HerdCloseEvent | null} */
const closeReason = (payload) => {
  if (!payload.byteLength) return null;
  try {
    return JSON.parse(decoder.decode(payload));
  } catch {
    return { reason: decoder.decode(payload) };
  }
};

/** @param {any} result @returns {TerminalRecord[]} */
const terminalArray = (result) => {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.terminals) ? result.terminals : [];
};

export class HerdConnection {
  /**
   * @overload
   * @param {HerdConnectionOptions} options
   * @returns {HerdConnection}
   */
  /**
   * @param {HerdConnectionOptions} options
   */
  constructor({
    url,
    token,
    WebSocket: WebSocketClass = globalThis.WebSocket,
    reconnect = true,
    reconnectDelay = 500,
    maxReconnectDelay = 10000,
    rpcTimeout = 20000,
  } = {}) {
    if (!url) throw new TypeError('url is required');
    if (!WebSocketClass) throw new TypeError('WebSocket is unavailable');
    this.url = url;
    this.token = token;
    /** @type {HerdConnectionState} */
    this.state = 'idle';
    this.reconnect = reconnect;
    this.reconnectDelay = reconnectDelay;
    this.maxReconnectDelay = maxReconnectDelay;
    this.rpcTimeout = rpcTimeout;
    this.WebSocketClass = WebSocketClass;
    this.emitter = new Emitter();
    /** @type {Map<string, TerminalRecord>} */
    this.records = new Map();
    /** @type {Map<number, any>} */
    this.pending = new Map();
    /** @type {Map<number, HerdAttachment>} */
    this.attachments = new Map();
    /** @type {Map<number, (chunk: BinaryInput) => void>} */
    this.parsers = new Map();
    this.nextId = 1;
    /** @type {WebSocketLike | null} */
    this.socket = null;
    this.gatewayReady = false;
    this.started = false;
    this.destroyed = false;
    this.attempt = 0;
    /** @type {ReturnType<typeof setTimeout> | null} */
    this.reconnectTimer = null;
    /** @type {number | null} */
    this.eventsChannel = null;
    this.firstReady = deferred();
    this.cycle = deferred();
  }

  /**
   * Subscribe to a connection event.
   * @template {keyof HerdConnectionEventMap} T
   * @param {T} type
   * @param {(detail: HerdConnectionEventMap[T]) => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  on(type, listener) {
    return this.emitter.on(type, listener);
  }

  /** @returns {TerminalRecord[]} */
  get terminals() {
    return [...this.records.values()];
  }

  /** @param {string} address @returns {TerminalRecord | undefined} */
  getTerminal(address) {
    return this.records.get(address);
  }

  /**
   * Connect and wait for the first successful initialization.
   * @returns {Promise<boolean>}
   * @fires HerdConnection#status
   * @fires HerdConnection#ready
   * @fires HerdConnection#terminals
   * @fires HerdConnection#error
   */
  connect() {
    if (this.destroyed) return Promise.reject(new Error('connection destroyed'));
    if (!this.started) {
      this.started = true;
      this.openSocket();
    }
    return this.firstReady.promise;
  }

  /** @returns {Promise<boolean>} Whether the current connection cycle initialized. */
  whenReady() {
    if (this.state === 'ready') return Promise.resolve(true);
    return this.cycle.promise;
  }

  /** @private @param {HerdConnectionState} state @param {Object} [detail] */
  setState(state, detail = {}) {
    this.state = state;
    this.emitter.emit('status', { state, attempt: this.attempt, ...detail });
  }

  /** @private */
  openSocket() {
    if (!this.started || this.destroyed) return;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    const reconnecting = this.state === 'reconnecting';
    this.attempt += 1;
    this.cycle = deferred();
    this.gatewayReady = false;
    this.parsers.clear();
    this.eventsChannel = null;
    this.setState(reconnecting ? 'reconnecting' : 'connecting');

    let socket;
    try {
      socket = new this.WebSocketClass(webSocketUrl(this.url, this.token));
    } catch (error) {
      this.emitter.emit('error', { error });
      this.cycle.resolve(false);
      this.scheduleReconnect();
      return;
    }
    this.socket = socket;
    socket.binaryType = 'arraybuffer';
    socket.onopen = () => {
      if (this.socket === socket) this.setState('connected');
    };
    socket.onerror = (event) => {
      if (this.socket === socket) this.emitter.emit('error', { error: event });
    };
    socket.onmessage = (event) => {
      if (this.socket !== socket) return;
      if (typeof event.data === 'string') this.handleText(socket, event.data);
      else this.handleBinary(socket, event.data);
    };
    socket.onclose = (event) => {
      if (this.socket === socket) this.handleClose(socket, event);
    };
  }

  /** @private @param {WebSocketLike} socket @param {string} text */
  handleText(socket, text) {
    let message;
    try {
      message = JSON.parse(text);
    } catch {
      return;
    }
    if (message.type === 'gateway' && message.event === 'ready' && !this.gatewayReady) {
      this.gatewayReady = true;
      this.initialize(socket).catch((error) => {
        if (this.socket !== socket) return;
        this.emitter.emit('error', { error });
        socket.close();
      });
    }
  }

  /** @private @param {WebSocketLike} socket */
  async initialize(socket) {
    /** @type {{ channel?: number } | undefined} */
    const subscription = await this.rpcNow('events.subscribe', {});
    if (this.socket !== socket) return;
    this.eventsChannel = subscription?.channel ?? null;
    const listed = await this.rpcNow('terminal.list', { all: true });
    if (this.socket !== socket) return;
    this.replaceTerminals(terminalArray(listed), false);
    this.setState('ready');
    this.attempt = 0;
    this.cycle.resolve(true);
    this.firstReady.resolve(true);
    this.emitter.emit('terminals', { terminals: this.terminals });
    this.emitter.emit('ready', { terminals: this.terminals });
  }

  /** @private @param {WebSocketLike} socket @param {Partial<Pick<CloseEvent, 'code' | 'reason'>>} [event] */
  handleClose(socket, event = {}) {
    if (this.socket !== socket) return;
    this.socket = null;
    this.gatewayReady = false;
    this.eventsChannel = null;
    this.rejectPending(new Error('connection closed'));
    this.dropAttachments();
    this.cycle.resolve(false);
    const detail = { code: event.code, reason: event.reason || '' };
    this.setState('disconnected', detail);
    this.scheduleReconnect(detail);
  }

  /** @private @param {Object} [detail] */
  scheduleReconnect(detail = {}) {
    if (!this.started || this.destroyed) return;
    if (!this.reconnect) {
      this.firstReady.resolve(false);
      return;
    }
    const delay = Math.min(
      this.maxReconnectDelay,
      this.reconnectDelay * 2 ** Math.max(0, this.attempt - 1),
    );
    this.setState('reconnecting', { ...detail, delay });
    this.reconnectTimer = setTimeout(() => this.openSocket(), delay);
  }

  /** @private @param {Error} error */
  rejectPending(error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  /** @private */
  dropAttachments() {
    const attachments = [...this.attachments.values()];
    this.attachments.clear();
    for (const attachment of attachments) {
      attachment.open = false;
      attachment.onDisconnect?.();
    }
  }

  /**
   * Call a herdr RPC method after the connection is ready.
   * @template T
   * @param {string} method
   * @param {Record<string, unknown>} [params]
   * @returns {Promise<T>}
   */
  async rpc(method, params = {}) {
    if (this.destroyed) throw new Error('connection destroyed');
    if (!this.started) this.connect();
    if (this.state !== 'ready') {
      const ready = await this.cycle.promise;
      if (!ready || this.state !== 'ready') throw new Error('connection is not ready');
    }
    return this.rpcNow(method, params);
  }

  /**
   * @private
   * @template T
   * @param {string} method
   * @param {Record<string, unknown>} params
   * @returns {Promise<T>}
   */
  rpcNow(method, params) {
    const socket = this.socket;
    if (!socket || socket.readyState !== 1 || !this.gatewayReady) {
      return Promise.reject(new Error('connection is not ready'));
    }
    return new Promise((resolve, reject) => {
      const id = this.nextId++;
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`RPC timeout: ${method}`));
      }, this.rpcTimeout);
      this.pending.set(id, { resolve, reject, timer, method });
      try {
        socket.send(JSON.stringify({ jsonrpc: '2.0', id, method, params }));
      } catch (error) {
        clearTimeout(timer);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  /** @private @param {WebSocketLike} socket @param {BinaryInput} input */
  handleBinary(socket, input) {
    let frame;
    try {
      frame = decodeFrame(input);
    } catch {
      return;
    }
    if (!frame) return;
    const { channel, kind, payload } = frame;
    const attachment = this.attachments.get(channel);
    if (attachment) {
      if (kind === DATA) {
        try {
          attachment.onData(payload);
        } finally {
          this.sendFrame(channel, CREDIT, encodeCredit(payload.byteLength), socket);
        }
      } else if (kind === CLOSE) {
        this.attachments.delete(channel);
        attachment.open = false;
        attachment.onClose?.(closeReason(payload));
      }
      return;
    }
    if (kind !== DATA) return;
    let parse = this.parsers.get(channel);
    if (!parse) {
      parse = createJsonLineParser((line) => this.handleJsonLine(line));
      this.parsers.set(channel, parse);
    }
    try {
      parse(payload);
    } finally {
      this.sendFrame(channel, CREDIT, encodeCredit(payload.byteLength), socket);
    }
  }

  /** @private @param {string} line */
  handleJsonLine(line) {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (message.id != null) {
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) {
        request.reject(new Error(message.error.message || JSON.stringify(message.error)));
        return;
      }
      this.rememberResult(message.result);
      request.resolve(message.result);
      return;
    }
    if (message.method) this.handleNotification(message);
  }

  /** @private @param {any} result */
  rememberResult(result) {
    if (result?.address) this.records.set(result.address, result);
    if (result?.terminal?.address) this.records.set(result.terminal.address, result.terminal);
  }

  /** @private @param {any} message */
  handleNotification(message) {
    if (message.method === 'missed') {
      this.replaceTerminals(message.params?.terminals || []);
      this.emitter.emit('missed', message.params);
      return;
    }
    if (message.method !== 'event') return;
    this.applyEvent(message.params || {});
    this.emitter.emit('event', message.params);
  }

  /** @private @param {TerminalRecord[]} terminals @param {boolean} [notify] */
  replaceTerminals(terminals, notify = true) {
    this.records.clear();
    for (const terminal of terminals) {
      if (terminal?.address) this.records.set(terminal.address, terminal);
    }
    if (notify) this.emitter.emit('terminals', { terminals: this.terminals });
  }

  /** @private @param {HerdTerminalEvent} event */
  applyEvent(event) {
    const terminal = this.records.get(event.terminal);
    const data = event.data || {};
    switch (event.type) {
      case 'created':
      case 'restarted':
        this.records.set(event.terminal, data);
        break;
      case 'removed':
        this.records.delete(event.terminal);
        break;
      case 'labels':
        if (terminal) {
          terminal.labels = data.labels;
          if (data.record) this.records.set(event.terminal, data.record);
        }
        break;
      case 'finished':
        if (terminal) Object.assign(terminal, data, { state: 'finished' });
        break;
      case 'lost':
      case 'keep':
      case 'status':
      case 'turn':
      case 'title':
      case 'size':
        if (terminal) Object.assign(terminal, data);
        break;
      case 'foreground':
        if (terminal) terminal.foreground = data;
        break;
    }
    this.emitter.emit('terminals', { terminals: this.terminals });
  }

  /**
   * Refresh and return the current terminal records.
   * @param {HerdListTerminalsOptions} [options]
   * @returns {Promise<TerminalRecord[]>}
   * @fires HerdConnection#terminals
   */
  async listTerminals({ all = true, labels = {} } = {}) {
    const result = await this.rpc('terminal.list', { all, labels });
    this.replaceTerminals(terminalArray(result));
    return this.terminals;
  }

  /**
   * Send a binary frame on the active socket.
   * @param {number} channel
   * @param {number} kind
   * @param {BinaryInput} [payload]
   * @param {WebSocketLike | null} [socket]
   * @returns {boolean} Whether the frame was sent.
   */
  sendFrame(channel, kind, payload = EMPTY, socket = this.socket) {
    if (socket && socket === this.socket && socket.readyState === 1) {
      socket.send(encodeFrame(channel, kind, payload));
      return true;
    }
    return false;
  }

  /**
   * Attach to a terminal and create its binary channel.
   * @param {HerdAttachmentOptions} options
   * @returns {Promise<HerdAttachment>}
   */
  async openAttachment({ terminal, cols, rows, history = 500, observe = false, onData, onClose, onDisconnect }) {
    /** @type {HerdAttachmentResult} */
    const result = await this.rpc('terminal.attach', { terminal, cols, rows, history, observe });
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) throw new Error('connection closed during attach');
    /** @type {HerdAttachment} */
    const attachment = {
      channel: result.channel,
      result,
      socket,
      open: true,
      onData: history > 0 ? createHistoryReplayHandler(onData) : onData,
      onClose,
      onDisconnect,
      write: (data) => this.sendFrame(
        result.channel,
        DATA,
        typeof data === 'string' ? encoder.encode(data) : asBytes(data),
        socket,
      ),
      resize: (nextCols, nextRows) => this.sendFrame(
        result.channel,
        RESIZE,
        encodeResize(nextCols, nextRows),
        socket,
      ),
      focus: (focused) => this.sendFrame(
        result.channel,
        FOCUS,
        Uint8Array.of(focused ? 1 : 0),
        socket,
      ),
      close: () => {
        if (!attachment.open) return;
        attachment.open = false;
        this.attachments.delete(result.channel);
        this.sendFrame(result.channel, CLOSE, EMPTY, socket);
      },
    };
    this.attachments.set(result.channel, attachment);
    return attachment;
  }

  /**
   * Stop reconnecting, close streams, and release listeners.
   * @returns {void}
   * @fires HerdConnection#status
   */
  destroy() {
    if (this.destroyed) return;
    this.destroyed = true;
    this.started = false;
    clearTimeout(this.reconnectTimer);
    this.reconnectTimer = null;
    this.rejectPending(new Error('connection destroyed'));
    this.dropAttachments();
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onclose = null;
      socket.onmessage = null;
      socket.onerror = null;
      socket.onopen = null;
      socket.close();
    }
    this.cycle.resolve(false);
    this.firstReady.resolve(false);
    this.setState('destroyed');
    this.emitter.clear();
  }
}

let ghosttyPromise;
/** @returns {Promise<void>} */
const loadGhostty = () => {
  if (!ghosttyPromise) {
    ghosttyPromise = Promise.resolve(init()).catch((error) => {
      ghosttyPromise = null;
      throw error;
    });
  }
  return ghosttyPromise;
};

const remeasureCjkFont = (terminal) => {
  const renderer = terminal.renderer;
  const context = globalThis.document?.createElement('canvas').getContext('2d');
  if (!renderer || !context) return;
  context.font = `${terminal.options.fontSize}px ${terminal.options.fontFamily}`;
  const cjkAdvance = context.measureText('\u6c38').width;
  if (!Number.isFinite(cjkAdvance) || cjkAdvance <= 0) return;
  renderer.remeasureFont();
  // The cell must fit BOTH the Latin font (ghostty-web measures it) and half the
  // CJK advance. On clients without a true dual-width CJK font, CJK falls back to
  // a proportional font whose advance is NOT 2x the Latin advance: taking only
  // ceil(cjkAdvance/2) made the cell NARROWER than the Latin glyphs (observed:
  // cell 7px vs Latin advance 7.83px -> adjacent Latin glyphs overlap).
  // CJK occupies 2 cells regardless; it only needs 2*cell >= its advance.
  renderer.metrics.width = Math.max(
    renderer.metrics.width || 0,
    Math.max(1, Math.ceil(cjkAdvance / 2)),
  );
};

export class HerdView {
  /**
   * @param {HerdConnection} connection
   * @param {HerdViewOptions} [options]
   */
  constructor(connection, {
    terminalOptions = {},
    history = 500,
    autoFocus = true,
    autoResize = true,
    focusTarget = globalThis.window,
  } = {}) {
    if (!connection) throw new TypeError('connection is required');
    this.connection = connection;
    this.terminalOptions = terminalOptions;
    this.history = history;
    this.autoFocus = autoFocus;
    this.autoResize = autoResize;
    this.focusTarget = focusTarget;
    this.emitter = new Emitter();
    /** @type {HTMLElement | null} */
    this.container = null;
    /** @type {string | null} */
    this.address = null;
    this.observe = false;
    /** @type {HerdAttachment | null} */
    this.attachment = null;
    /** @type {Terminal | null} */
    this.terminal = null;
    /** @type {FitAddon | null} */
    this.fit = null;
    /** @type {Array<{ dispose: () => void }>} */
    this.disposables = [];
    this.generation = 0;
    this.wantsAttach = false;
    this.reconnectNeeded = false;
    this.destroyed = false;
    this.handleWindowFocus = () => this.reportFocus(true);
    this.handleWindowBlur = () => this.reportFocus(false);
    this.focusTarget?.addEventListener?.('focus', this.handleWindowFocus);
    this.focusTarget?.addEventListener?.('blur', this.handleWindowBlur);
    this.offConnection = connection.on('status', ({ state }) => {
      if (state === 'ready' && this.reconnectNeeded && this.wantsAttach && !this.destroyed) {
        this.reconnectNeeded = false;
        this.attach(this.address, { observe: this.observe }).catch((error) => {
          this.emitter.emit('error', { error });
        });
      }
    });
  }

  /**
   * Subscribe to a view event.
   * @template {keyof HerdViewEventMap} T
   * @param {T} type
   * @param {(detail: HerdViewEventMap[T]) => void} listener
   * @returns {() => void} Unsubscribe function.
   */
  on(type, listener) {
    return this.emitter.on(type, listener);
  }

  /** @returns {boolean} */
  get active() {
    return Boolean(this.attachment?.open);
  }

  /**
   * Set the element owned by this view while attached.
   * @param {HTMLElement} element
   * @returns {this}
   */
  mount(element) {
    if (this.destroyed) throw new Error('view destroyed');
    if (!element) throw new TypeError('mount element is required');
    if (this.terminal) throw new Error('detach or destroy the view before remounting');
    this.container = element;
    return this;
  }

  /** @private @param {HerdViewState} state @param {Object} [detail] */
  emitStatus(state, detail = {}) {
    this.emitter.emit('status', {
      state,
      address: this.address,
      observe: this.observe,
      ...detail,
    });
  }

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
  async attach(address, { observe = this.observe } = {}) {
    if (this.destroyed) throw new Error('view destroyed');
    if (!this.container) throw new Error('mount the view before attaching');
    if (!address) throw new TypeError('terminal address is required');
    const generation = ++this.generation;
    this.wantsAttach = true;
    this.reconnectNeeded = false;
    this.address = address;
    this.observe = Boolean(observe);
    this.attachment?.close();
    this.attachment = null;
    this.disposeTerminal();
    this.container.replaceChildren();
    this.emitStatus('attaching');

    try {
      await loadGhostty();
      if (generation !== this.generation) return this;
      const terminal = new Terminal(this.terminalOptions);
      const fit = new FitAddon();
      this.terminal = terminal;
      this.fit = fit;
      terminal.loadAddon(fit);
      terminal.open(this.container);
      await globalThis.document?.fonts?.ready;
      if (generation !== this.generation) return this;
      remeasureCjkFont(terminal);
      try {
        fit.fit();
        if (this.autoResize) fit.observeResize();
      } catch {}
      if (terminal.renderer && terminal.wasmTerm) {
        terminal.renderer.resize(terminal.cols, terminal.rows);
        terminal.renderer.render(
          terminal.wasmTerm,
          true,
          terminal.viewportY,
          terminal,
          terminal.scrollbarOpacity,
        );
      }
      this.disposables.push(terminal.onData((data) => this.write(data)));
      this.disposables.push(terminal.onResize(({ cols, rows }) => {
        this.emitter.emit('resize', { cols, rows });
        if (this.active && !this.observe) this.attachment.resize(cols, rows);
      }));
      if (terminal.onTitleChange) {
        this.disposables.push(terminal.onTitleChange((title) => {
          if (!title || generation !== this.generation) return;
          this.emitter.emit('title', { title });
        }));
      }

      const attachment = await this.connection.openAttachment({
        terminal: address,
        cols: terminal.cols || 100,
        rows: terminal.rows || 30,
        history: this.history,
        observe: this.observe,
        onData: (bytes) => {
          if (generation === this.generation) terminal.write(bytes);
        },
        onClose: (reason) => {
          if (generation !== this.generation) return;
          this.attachment = null;
          this.wantsAttach = false;
          this.reconnectNeeded = false;
          this.emitter.emit('closed', reason || {});
          this.emitStatus('closed', { reason });
        },
        onDisconnect: () => {
          if (generation !== this.generation) return;
          this.attachment = null;
          this.reconnectNeeded = this.wantsAttach;
          if (this.reconnectNeeded) this.emitStatus('reconnecting');
        },
      });
      if (generation !== this.generation) {
        attachment.close();
        return this;
      }
      this.attachment = attachment;
      this.reconnectNeeded = false;
      this.emitStatus('attached', { terminal: attachment.result.terminal });
      if (!this.observe && this.autoFocus) this.focus();
      return this;
    } catch (error) {
      if (generation !== this.generation) return this;
      if (this.reconnectNeeded || this.connection.state === 'reconnecting') {
        this.reconnectNeeded = this.wantsAttach;
        this.emitStatus('reconnecting');
        return this;
      }
      this.wantsAttach = false;
      this.attachment = null;
      this.disposeTerminal();
      this.emitStatus('error', { error });
      throw error;
    }
  }

  /**
   * Reattach in viewer or observer mode.
   * @param {boolean} observe
   * @returns {Promise<this>}
   * @fires HerdView#status
   */
  setObserve(observe) {
    const next = Boolean(observe);
    if (this.wantsAttach && this.address) return this.attach(this.address, { observe: next });
    this.observe = next;
    return Promise.resolve(this);
  }

  /**
   * Send keyboard-equivalent input.
   * @param {string | BinaryInput} data
   * @returns {boolean} `false` in observer mode or while inactive.
   */
  write(data) {
    if (!this.active || this.observe) return false;
    return this.attachment.write(data);
  }

  /**
   * Focus the terminal and report focus for a viewer.
   * @returns {boolean} Whether focus was reported.
   * @fires HerdView#focus
   */
  focus() {
    if (!this.active || this.observe) return false;
    this.terminal?.focus();
    return this.reportFocus(true);
  }

  /** @private @param {boolean} focused @returns {boolean} */
  reportFocus(focused) {
    if (!this.active || this.observe) return false;
    this.emitter.emit('focus', { focused });
    return this.attachment.focus(focused);
  }

  /**
   * Close the attachment and dispose the renderer.
   * @returns {void}
   * @fires HerdView#status
   */
  detach() {
    if (this.destroyed) return;
    ++this.generation;
    this.wantsAttach = false;
    this.reconnectNeeded = false;
    this.attachment?.close();
    this.attachment = null;
    this.disposeTerminal();
    this.address = null;
    this.emitStatus('detached');
  }

  /** @private */
  disposeTerminal() {
    for (const disposable of this.disposables.splice(0)) {
      try {
        disposable?.dispose();
      } catch {}
    }
    try {
      this.fit?.dispose();
      this.terminal?.dispose();
    } catch {}
    this.fit = null;
    this.terminal = null;
  }

  /**
   * Permanently release the view and its listeners.
   * @returns {void}
   * @fires HerdView#status
   */
  destroy() {
    if (this.destroyed) return;
    ++this.generation;
    this.wantsAttach = false;
    this.reconnectNeeded = false;
    this.attachment?.close();
    this.attachment = null;
    this.disposeTerminal();
    this.offConnection?.();
    this.focusTarget?.removeEventListener?.('focus', this.handleWindowFocus);
    this.focusTarget?.removeEventListener?.('blur', this.handleWindowBlur);
    this.destroyed = true;
    this.emitStatus('destroyed');
    this.emitter.clear();
    this.container = null;
  }
}
