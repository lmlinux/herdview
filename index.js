import { init, Terminal, FitAddon } from 'ghostty-web';

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
    this.listeners = new Map();
  }

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

  emit(type, detail) {
    for (const listener of [...(this.listeners.get(type) || [])]) listener(detail);
  }

  clear() {
    this.listeners.clear();
  }
}

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const asBytes = (value) => {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  throw new TypeError('expected an ArrayBuffer or typed array');
};

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

export function encodeCredit(bytes) {
  const output = new Uint8Array(4);
  new DataView(output.buffer).setUint32(0, bytes, true);
  return output;
}

export function encodeResize(cols, rows) {
  const output = new Uint8Array(4);
  const view = new DataView(output.buffer);
  view.setUint16(0, cols, true);
  view.setUint16(2, rows, true);
  return output;
}

export function webSocketUrl(url, token) {
  const result = new URL(url, globalThis.location?.origin);
  if (token != null) result.searchParams.set('token', token);
  return result.href;
}

const closeReason = (payload) => {
  if (!payload.byteLength) return null;
  try {
    return JSON.parse(decoder.decode(payload));
  } catch {
    return { reason: decoder.decode(payload) };
  }
};

const terminalArray = (result) => {
  if (Array.isArray(result)) return result;
  return Array.isArray(result?.terminals) ? result.terminals : [];
};

export class HerdConnection {
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
    this.state = 'idle';
    this.reconnect = reconnect;
    this.reconnectDelay = reconnectDelay;
    this.maxReconnectDelay = maxReconnectDelay;
    this.rpcTimeout = rpcTimeout;
    this.WebSocketClass = WebSocketClass;
    this.emitter = new Emitter();
    this.records = new Map();
    this.pending = new Map();
    this.attachments = new Map();
    this.parsers = new Map();
    this.nextId = 1;
    this.socket = null;
    this.gatewayReady = false;
    this.started = false;
    this.destroyed = false;
    this.attempt = 0;
    this.reconnectTimer = null;
    this.eventsChannel = null;
    this.firstReady = deferred();
    this.cycle = deferred();
  }

  on(type, listener) {
    return this.emitter.on(type, listener);
  }

  get terminals() {
    return [...this.records.values()];
  }

  getTerminal(address) {
    return this.records.get(address);
  }

  connect() {
    if (this.destroyed) return Promise.reject(new Error('connection destroyed'));
    if (!this.started) {
      this.started = true;
      this.openSocket();
    }
    return this.firstReady.promise;
  }

  whenReady() {
    if (this.state === 'ready') return Promise.resolve(true);
    return this.cycle.promise;
  }

  setState(state, detail = {}) {
    this.state = state;
    this.emitter.emit('status', { state, attempt: this.attempt, ...detail });
  }

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

  async initialize(socket) {
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

  rejectPending(error) {
    for (const request of this.pending.values()) {
      clearTimeout(request.timer);
      request.reject(error);
    }
    this.pending.clear();
  }

  dropAttachments() {
    const attachments = [...this.attachments.values()];
    this.attachments.clear();
    for (const attachment of attachments) {
      attachment.open = false;
      attachment.onDisconnect?.();
    }
  }

  async rpc(method, params = {}) {
    if (this.destroyed) throw new Error('connection destroyed');
    if (!this.started) this.connect();
    if (this.state !== 'ready') {
      const ready = await this.cycle.promise;
      if (!ready || this.state !== 'ready') throw new Error('connection is not ready');
    }
    return this.rpcNow(method, params);
  }

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

  rememberResult(result) {
    if (result?.address) this.records.set(result.address, result);
    if (result?.terminal?.address) this.records.set(result.terminal.address, result.terminal);
  }

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

  replaceTerminals(terminals, notify = true) {
    this.records.clear();
    for (const terminal of terminals) {
      if (terminal?.address) this.records.set(terminal.address, terminal);
    }
    if (notify) this.emitter.emit('terminals', { terminals: this.terminals });
  }

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

  async listTerminals({ all = true, labels = {} } = {}) {
    const result = await this.rpc('terminal.list', { all, labels });
    this.replaceTerminals(terminalArray(result));
    return this.terminals;
  }

  sendFrame(channel, kind, payload = EMPTY, socket = this.socket) {
    if (socket && socket === this.socket && socket.readyState === 1) {
      socket.send(encodeFrame(channel, kind, payload));
      return true;
    }
    return false;
  }

  async openAttachment({ terminal, cols, rows, history = 500, observe = false, onData, onClose, onDisconnect }) {
    const result = await this.rpc('terminal.attach', { terminal, cols, rows, history, observe });
    const socket = this.socket;
    if (!socket || socket.readyState !== 1) throw new Error('connection closed during attach');
    const attachment = {
      channel: result.channel,
      result,
      socket,
      open: true,
      onData,
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
const loadGhostty = () => {
  if (!ghosttyPromise) {
    ghosttyPromise = Promise.resolve(init()).catch((error) => {
      ghosttyPromise = null;
      throw error;
    });
  }
  return ghosttyPromise;
};

export class HerdView {
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
    this.container = null;
    this.address = null;
    this.observe = false;
    this.attachment = null;
    this.terminal = null;
    this.fit = null;
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

  on(type, listener) {
    return this.emitter.on(type, listener);
  }

  get active() {
    return Boolean(this.attachment?.open);
  }

  mount(element) {
    if (this.destroyed) throw new Error('view destroyed');
    if (!element) throw new TypeError('mount element is required');
    if (this.terminal) throw new Error('detach or destroy the view before remounting');
    this.container = element;
    return this;
  }

  emitStatus(state, detail = {}) {
    this.emitter.emit('status', {
      state,
      address: this.address,
      observe: this.observe,
      ...detail,
    });
  }

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
      try {
        fit.fit();
        if (this.autoResize) fit.observeResize();
      } catch {}
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

  setObserve(observe) {
    const next = Boolean(observe);
    if (this.wantsAttach && this.address) return this.attach(this.address, { observe: next });
    this.observe = next;
    return Promise.resolve(this);
  }

  write(data) {
    if (!this.active || this.observe) return false;
    return this.attachment.write(data);
  }

  focus() {
    if (!this.active || this.observe) return false;
    this.terminal?.focus();
    return this.reportFocus(true);
  }

  reportFocus(focused) {
    if (!this.active || this.observe) return false;
    this.emitter.emit('focus', { focused });
    return this.attachment.focus(focused);
  }

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
