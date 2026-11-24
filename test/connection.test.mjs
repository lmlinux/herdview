import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Ghostty } from 'ghostty-web';
import { decodeFrame, decodeResize, encodeFrame, encodeResize, HerdConnection, HerdView } from '../index.js';

const encode = (text) => new TextEncoder().encode(text);
const decode = (bytes) => new TextDecoder().decode(bytes);
const tick = () => new Promise((resolve) => setImmediate(resolve));

class FakeWebSocket {
  static instances = [];

  constructor(url) {
    this.url = url;
    this.readyState = 0;
    this.sent = [];
    this.autoRespond = true;
    this.attachSeq = 20;
    this.remoteSize = { cols: 200, rows: 120 };
    FakeWebSocket.instances.push(this);
  }

  send(data) {
    this.sent.push(data);
    if (typeof data !== 'string' || !this.autoRespond) return;
    const request = JSON.parse(data);
    queueMicrotask(() => {
      let result = {};
      if (request.method === 'events.subscribe') {
        result = { channel: 7, terminals: [{ address: 't1', name: 'demo', state: 'running' }] };
      } else if (request.method === 'terminal.list') {
        result = { terminals: [...this.terminalSnapshot || [{ address: 't1', name: 'demo', state: 'running' }]] };
      } else if (request.method === 'terminal.attach') {
        const size = request.params.observe
          ? this.remoteSize
          : { cols: request.params.cols, rows: request.params.rows };
        this.remoteSize = size;
        result = {
          channel: ++this.attachSeq,
          terminal: { address: request.params.terminal, name: request.params.terminal, ...size },
          resize_notifications: Boolean(request.params.observe && request.params.resize_notifications),
        };
      }
      this.receive(encodeFrame(0, 0, encode(JSON.stringify({ id: request.id, result }))));
    });
  }

  open() {
    this.readyState = 1;
    this.onopen?.();
  }

  gatewayReady() {
    this.receive(JSON.stringify({ type: 'gateway', event: 'ready' }));
  }

  receive(data) {
    this.onmessage?.({ data });
  }

  close() {
    if (this.readyState === 3) return;
    this.readyState = 3;
    this.onclose?.({ code: 1000, reason: '' });
  }

  serverClose() {
    this.readyState = 3;
    this.onclose?.({ code: 1006, reason: 'test reconnect' });
  }

  requests(method) {
    return this.sent
      .filter((message) => typeof message === 'string')
      .map((message) => JSON.parse(message))
      .filter((message) => message.method === method);
  }

  frames(channel, kind) {
    return this.sent
      .filter((message) => typeof message !== 'string')
      .map((message) => decodeFrame(message))
      .filter((frame) => frame && (channel == null || frame.channel === channel) && (kind == null || frame.kind === kind));
  }
}

const waitFor = async (predicate, message) => {
  for (let count = 0; count < 100; count += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail(message);
};

const createConnection = async (options = {}) => {
  const connection = new HerdConnection({
    url: 'ws://example.test/ws',
    token: 'secret',
    WebSocket: FakeWebSocket,
    reconnectDelay: 1,
    maxReconnectDelay: 2,
    ...options,
  });
  const ready = connection.connect();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.gatewayReady();
  assert.equal(await ready, true);
  await tick();
  return { connection, socket };
};

const ghosttyModule = await WebAssembly.compile(await readFile(
  new URL('../node_modules/ghostty-web/ghostty-vt.wasm', import.meta.url),
));

const createHeadlessTerminal = async () => {
  const instance = await WebAssembly.instantiate(ghosttyModule, { env: { log() {} } });
  return new Ghostty(instance).createTerminal(40, 5);
};

const screenLines = (terminal) => Array.from({ length: terminal.rows }, (_, y) => (
  (terminal.getLine(y) || [])
    .map((cell) => cell.codepoint ? String.fromCodePoint(cell.codepoint) : '')
    .join('')
    .trimEnd()
));

test.beforeEach(() => {
  FakeWebSocket.instances.length = 0;
});

test('connection subscribes, lists all terminals, and credits JSON channels', async () => {
  const { connection, socket } = await createConnection();
  assert.deepEqual(socket.requests('events.subscribe').map((request) => request.params), [{}]);
  assert.deepEqual(socket.requests('terminal.list').map((request) => request.params), [{ all: true }]);
  assert.equal(connection.getTerminal('t1').name, 'demo');
  assert.equal(socket.frames(0, 1).length, 2);

  const events = [];
  connection.on('event', (event) => events.push(event));
  const notification = encode(JSON.stringify({
    method: 'event',
    params: { type: 'title', terminal: 't1', data: { title: 'renamed' } },
  }) + '\n');
  socket.receive(encodeFrame(7, 0, notification.subarray(0, 9)));
  assert.equal(connection.getTerminal('t1').title, undefined);
  socket.receive(encodeFrame(7, 0, notification.subarray(9)));
  assert.equal(connection.getTerminal('t1').title, 'renamed');
  assert.equal(events.length, 1);
  const credits = socket.frames(7, 1).map((frame) => new DataView(
    frame.payload.buffer,
    frame.payload.byteOffset,
    frame.payload.byteLength,
  ).getUint32(0, true));
  assert.deepEqual(credits, [9, notification.length - 9]);
  connection.destroy();
});

test('one connection routes and credits multiple independent attachments', async () => {
  const { connection, socket } = await createConnection();
  const first = [];
  const second = [];
  const closed = [];
  const attachment1 = await connection.openAttachment({
    terminal: 't1', cols: 80, rows: 24, history: 0, onData: (bytes) => first.push(decode(bytes)),
  });
  const attachment2 = await connection.openAttachment({
    terminal: 't2', cols: 100, rows: 30, history: 0, onData: (bytes) => second.push(decode(bytes)),
    onClose: (reason) => closed.push(reason),
  });
  assert.notEqual(attachment1.channel, attachment2.channel);
  socket.receive(encodeFrame(attachment1.channel, 0, encode('first')));
  socket.receive(encodeFrame(attachment2.channel, 0, encode('second')));
  assert.deepEqual(first, ['first']);
  assert.deepEqual(second, ['second']);
  const firstCredit = socket.frames(attachment1.channel, 1)[0].payload;
  const secondCredit = socket.frames(attachment2.channel, 1)[0].payload;
  assert.equal(new DataView(firstCredit.buffer, firstCredit.byteOffset, 4).getUint32(0, true), 5);
  assert.equal(new DataView(secondCredit.buffer, secondCredit.byteOffset, 4).getUint32(0, true), 6);

  attachment1.resize(90, 25);
  const viewerResize = socket.frames(attachment1.channel, 3)[0];
  assert.deepEqual(decodeResize(viewerResize.payload), { cols: 90, rows: 25 });

  attachment1.close();
  socket.receive(encodeFrame(attachment2.channel, 2, encode('{"reason":"exited","exit_code":0}')));
  assert.deepEqual(closed, [{ reason: 'exited', exit_code: 0 }]);
  assert.equal(socket.frames(attachment1.channel, 2).length, 1);
  connection.destroy();
});

test('missed notifications replace snapshots and foreground events keep their shape', async () => {
  const { connection, socket } = await createConnection();
  socket.receive(encodeFrame(7, 0, encode(JSON.stringify({
    method: 'event',
    params: { type: 'foreground', terminal: 't1', data: { pid: 42, name: 'bash' } },
  }))));
  assert.deepEqual(connection.getTerminal('t1').foreground, { pid: 42, name: 'bash' });
  socket.receive(encodeFrame(7, 0, encode(JSON.stringify({
    method: 'missed', params: { terminals: [{ address: 't9', state: 'running' }] },
  }))));
  assert.deepEqual(connection.terminals.map((terminal) => terminal.address), ['t9']);
  connection.destroy();
});

test('closed sockets reconnect and resubscribe automatically', async () => {
  const { connection, socket } = await createConnection();
  const states = [];
  connection.on('status', ({ state }) => states.push(state));
  socket.serverClose();
  await waitFor(() => FakeWebSocket.instances.length === 2, 'reconnect was not attempted');
  const replacement = FakeWebSocket.instances[1];
  replacement.open();
  replacement.gatewayReady();
  await waitFor(() => connection.state === 'ready', 'replacement connection did not initialize');
  assert.equal(replacement.requests('events.subscribe').length, 1);
  assert.equal(replacement.requests('terminal.list').length, 1);
  assert.ok(states.includes('disconnected'));
  assert.ok(states.includes('reconnecting'));
  connection.destroy();
});

test('initial connection failure settles connect when reconnect is disabled', async () => {
  const connection = new HerdConnection({
    url: 'ws://example.test/ws',
    WebSocket: FakeWebSocket,
    reconnect: false,
  });
  const ready = connection.connect();
  const socket = FakeWebSocket.instances.at(-1);
  socket.open();
  socket.serverClose();
  assert.equal(await ready, false);
  assert.equal(connection.state, 'disconnected');
  connection.destroy();
});

test('successful reconnects reset exponential backoff', async () => {
  const { connection, socket } = await createConnection({
    reconnectDelay: 1,
    maxReconnectDelay: 100,
  });
  const delays = [];
  connection.on('status', ({ state, delay }) => {
    if (state === 'reconnecting' && delay != null) delays.push(delay);
  });

  socket.serverClose();
  await waitFor(() => FakeWebSocket.instances.length === 2, 'first reconnect was not attempted');
  const replacement = FakeWebSocket.instances[1];
  replacement.open();
  replacement.gatewayReady();
  await waitFor(() => connection.state === 'ready', 'first reconnect did not initialize');

  replacement.serverClose();
  await waitFor(() => FakeWebSocket.instances.length === 3, 'second reconnect was not attempted');
  assert.deepEqual(delays, [1, 1]);
  connection.destroy();
});

test('JSON channels return CREDIT when a user listener throws', async () => {
  const { connection, socket } = await createConnection();
  connection.on('event', () => {
    throw new Error('listener failure');
  });
  const notification = encode(JSON.stringify({
    method: 'event',
    params: { type: 'title', terminal: 't1', data: { title: 'renamed' } },
  }) + '\n');
  assert.throws(() => socket.receive(encodeFrame(7, 0, notification)), /listener failure/);
  assert.equal(socket.frames(7, 1).length, 1);
  connection.destroy();
});

test('attachment channels return CREDIT when the data callback throws', async () => {
  const { connection, socket } = await createConnection();
  const attachment = await connection.openAttachment({
    terminal: 't1',
    cols: 80,
    rows: 24,
    history: 0,
    onData: () => {
      throw new Error('renderer failure');
    },
  });
  assert.throws(
    () => socket.receive(encodeFrame(attachment.channel, 0, encode('output'))),
    /renderer failure/,
  );
  assert.equal(socket.frames(attachment.channel, 1).length, 1);
  connection.destroy();
});

test('resize decoder reads uint16 little-endian columns and rows at byte offsets', () => {
  const wrapped = Uint8Array.of(99, 200, 0, 120, 0, 88);
  assert.deepEqual(decodeResize(wrapped.subarray(1, 5)), { cols: 200, rows: 120 });
  assert.equal(decodeResize(Uint8Array.of(200, 0, 120)), null);
  assert.equal(decodeResize(Uint8Array.of(200, 0, 120, 0, 0)), null);
});

test('attachment channels dispatch remote resizes and preserve DATA flow control', async () => {
  const { connection, socket } = await createConnection();
  const sizes = [];
  const output = [];
  const attachment = await connection.openAttachment({
    terminal: 't1',
    cols: 40,
    rows: 5,
    history: 0,
    observe: true,
    onData: (bytes) => output.push(decode(bytes)),
    onResize: (cols, rows) => sizes.push({ cols, rows }),
  });

  socket.receive(encodeFrame(attachment.channel, 3, encodeResize(200, 120)));
  socket.receive(encodeFrame(attachment.channel, 3, Uint8Array.of(200, 0, 120)));
  assert.deepEqual(sizes, [{ cols: 200, rows: 120 }]);
  assert.equal(
    socket.requests('terminal.attach')[0].params.resize_notifications,
    true,
  );

  socket.receive(encodeFrame(attachment.channel, 0, encode('replacement paint')));
  assert.deepEqual(output, ['replacement paint']);
  assert.equal(socket.frames(attachment.channel, 1).length, 1);
  connection.destroy();
});

test('observer grids follow the attach size and later remote resizes', async () => {
  const terminal = await createHeadlessTerminal();
  const view = Object.assign(Object.create(HerdView.prototype), {
    observe: true,
    observeScaleToFit: false,
    terminal,
  });
  try {
    view.resizeObserverGrid(200, 120);
    assert.equal(terminal.cols, 200);
    assert.equal(terminal.rows, 120);

    view.resizeObserverGrid(66, 25);
    assert.equal(terminal.cols, 66);
    assert.equal(terminal.rows, 25);

    terminal.write(encode('x'.repeat(60)));
    assert.equal(screenLines(terminal)[0], 'x'.repeat(60));
  } finally {
    terminal.free();
  }
});

test('remote grid updates cannot resize a non-observe terminal', async () => {
  const terminal = await createHeadlessTerminal();
  const view = Object.assign(Object.create(HerdView.prototype), {
    observe: false,
    observeScaleToFit: true,
    terminal,
  });
  try {
    view.resizeObserverGrid(200, 120);
    assert.equal(terminal.cols, 40);
    assert.equal(terminal.rows, 5);
  } finally {
    terminal.free();
  }
});

test('observer scaling preserves aspect ratio and only scales down', () => {
  const canvas = { style: {} };
  const view = Object.assign(Object.create(HerdView.prototype), {
    observe: true,
    observeScaleToFit: true,
    container: { clientWidth: 390, clientHeight: 844 },
    terminal: {
      cols: 200,
      rows: 120,
      renderer: {
        getCanvas: () => canvas,
        getMetrics: () => ({ width: 10, height: 20 }),
      },
    },
  });
  view.updateObserverScale();
  assert.equal(canvas.style.transformOrigin, 'top left');
  assert.equal(canvas.style.transform, 'scale(0.195)');

  view.container = { clientWidth: 3000, clientHeight: 3000 };
  view.updateObserverScale();
  assert.equal(canvas.style.transform, '');

  const previousGetComputedStyle = globalThis.getComputedStyle;
  try {
    globalThis.getComputedStyle = () => ({
      getPropertyValue: (property) => ({
        'padding-left': '10px',
        'padding-right': '10px',
        'padding-top': '10px',
        'padding-bottom': '10px',
      })[property] || '0px',
    });
    view.container = { clientWidth: 410, clientHeight: 864 };
    view.updateObserverScale();
    assert.equal(canvas.style.transform, 'scale(0.195)');
  } finally {
    if (previousGetComputedStyle) globalThis.getComputedStyle = previousGetComputedStyle;
    else delete globalThis.getComputedStyle;
  }
});

test('HerdView.attach follows remote and local sizing across its public lifecycle', async () => {
  const grids = await Promise.all(Array.from({ length: 4 }, () => createHeadlessTerminal()));

  class HeadlessTerminal {
    constructor() {
      this.grid = grids.shift();
      if (!this.grid) throw new Error('no headless grid prepared');
      this.cols = this.grid.cols;
      this.rows = this.grid.rows;
      this.renderer = null;
      this.wasmTerm = null;
      this.options = { fontSize: 15, fontFamily: 'monospace' };
      this.onTitleChange = null;
      this.resizeListeners = new Set();
    }

    loadAddon(addon) {
      addon.activate(this);
    }

    open(element) {
      this.element = element;
    }

    onData() {
      return { dispose() {} };
    }

    onResize(listener) {
      this.resizeListeners.add(listener);
      return { dispose: () => this.resizeListeners.delete(listener) };
    }

    write(bytes) {
      this.grid.write(bytes);
    }

    resize(cols, rows) {
      if (cols === this.cols && rows === this.rows) return;
      this.grid.resize(cols, rows);
      this.cols = cols;
      this.rows = rows;
      for (const listener of [...this.resizeListeners]) listener({ cols, rows });
    }

    focus() {}

    dispose() {
      this.grid.free();
      this.resizeListeners.clear();
    }
  }

  class HeadlessFitAddon {
    activate(terminal) {
      this.terminal = terminal;
      this.fitCalls = 0;
      this.observeResizeCalls = 0;
    }

    fit() {
      this.fitCalls += 1;
      this.terminal.resize(66, 25);
    }

    observeResize() {
      this.observeResizeCalls += 1;
    }

    dispose() {}
  }

  const importLine = "import { init, Terminal, FitAddon } from 'ghostty-web';";
  const originalSource = await readFile(new URL('../index.js', import.meta.url), 'utf8');
  const source = originalSource.replace(
    importLine,
    'const { init, Terminal, FitAddon } = globalThis.__herdviewHeadlessGhostty;',
  );
  assert.notEqual(source, originalSource);
  globalThis.__herdviewHeadlessGhostty = {
    init: async () => {},
    Terminal: HeadlessTerminal,
    FitAddon: HeadlessFitAddon,
  };
  let HeadlessHerdView;
  try {
    const url = `data:text/javascript;base64,${Buffer.from(source).toString('base64')}`;
    ({ HerdView: HeadlessHerdView } = await import(url));
  } finally {
    delete globalThis.__herdviewHeadlessGhostty;
  }

  const { connection, socket } = await createConnection();
  const container = {
    style: { overflow: 'auto' },
    clientWidth: 390,
    clientHeight: 844,
    replaceChildren() {},
  };
  const view = new HeadlessHerdView(connection, {
    history: 0,
    autoFocus: false,
    observeScaleToFit: false,
    focusTarget: null,
  });
  const size = () => ({ cols: view.terminal.cols, rows: view.terminal.rows });
  try {
    view.mount(container);
    await view.attach('t1', { observe: true });
    assert.deepEqual(size(), { cols: 200, rows: 120 });
    assert.equal(view.fit.fitCalls, 0);
    assert.equal(view.fit.observeResizeCalls, 0);
    assert.equal(view.attachment.result.resize_notifications, true);

    socket.receive(encodeFrame(view.attachment.channel, 3, encodeResize(90, 40)));
    assert.deepEqual(size(), { cols: 90, rows: 40 });
    socket.receive(encodeFrame(view.attachment.channel, 0, encode('x'.repeat(60))));
    assert.equal(screenLines(view.terminal.grid)[0], 'x'.repeat(60));

    await view.setObserve(false);
    assert.deepEqual(size(), { cols: 66, rows: 25 });
    assert.equal(view.fit.fitCalls, 1);
    assert.equal(view.fit.observeResizeCalls, 1);
    assert.equal(view.attachment.result.resize_notifications, false);
    const viewerAttachment = view.attachment;
    view.terminal.resize(67, 26);
    const viewerResize = socket.frames(viewerAttachment.channel, 3)[0];
    assert.deepEqual(decodeResize(viewerResize.payload), { cols: 67, rows: 26 });

    socket.remoteSize = { cols: 67, rows: 26 };
    await view.setObserve(true);
    assert.deepEqual(size(), { cols: 67, rows: 26 });
    assert.equal(view.fit.fitCalls, 0);
    assert.equal(view.fit.observeResizeCalls, 0);

    socket.serverClose();
    await waitFor(() => FakeWebSocket.instances.length === 2, 'view did not reconnect');
    const replacement = FakeWebSocket.instances[1];
    replacement.remoteSize = { cols: 200, rows: 120 };
    replacement.open();
    replacement.gatewayReady();
    await waitFor(
      () => view.active && view.attachment?.socket === replacement,
      'view did not reattach after reconnect',
    );
    assert.deepEqual(size(), { cols: 200, rows: 120 });
    assert.equal(replacement.requests('terminal.attach').length, 1);
    assert.equal(replacement.requests('terminal.attach')[0].params.observe, true);
  } finally {
    view.destroy();
    connection.destroy();
    for (const grid of grids) grid.free();
  }
});

test('attach history recovers when the server cuts inside escape sequences', async (t) => {
  const historyText = '\x1b[2J\x1b[H\x1b[31mRED\x1b[0m\r\n'
    + '\x1b]0;busy agent\x07\x1b[1;32mREADY\x1b[0m\r\n'
    + '\x1b[34mEND\x1b[0m';
  const history = encode(historyText);
  const cases = [
    {
      name: 'complete sequence boundary',
      offset: 0,
      expected: ['RED', 'READY', 'END', '', ''],
    },
    {
      name: 'CSI cursor movement',
      offset: historyText.indexOf('[H') + 1,
      expected: ['RED', 'READY', 'END', '', ''],
    },
    {
      name: 'SGR parameters',
      offset: historyText.indexOf('[31m') + 2,
      expected: ['', 'READY', 'END', '', ''],
    },
    {
      name: 'OSC title',
      offset: historyText.indexOf('busy agent') + 2,
      expected: ['READY', 'END', '', '', ''],
    },
  ];

  for (const { name, offset, expected } of cases) {
    await t.test(name, async () => {
      const { connection, socket } = await createConnection();
      const terminal = await createHeadlessTerminal();
      try {
        const attachment = await connection.openAttachment({
          terminal: 't1',
          cols: 40,
          rows: 5,
          history: history.length,
          onData: (bytes) => terminal.write(bytes),
        });
        socket.receive(encodeFrame(attachment.channel, 0, history.subarray(offset)));
        assert.deepEqual(screenLines(terminal), expected);
      } finally {
        connection.destroy();
        terminal.free();
      }
    });
  }
});

test('an empty first paint ends replay filtering', async () => {
  const { connection, socket } = await createConnection();
  const output = [];
  const attachment = await connection.openAttachment({
    terminal: 't1',
    cols: 80,
    rows: 24,
    history: 500,
    onData: (bytes) => output.push(decode(bytes)),
  });

  socket.receive(encodeFrame(attachment.channel, 0, new Uint8Array(0)));
  socket.receive(encodeFrame(attachment.channel, 0, encode('live output')));
  assert.deepEqual(output, ['live output']);
  connection.destroy();
});

test('a replay without escapes is discarded without swallowing live output', async () => {
  const { connection, socket } = await createConnection();
  const output = [];
  const attachment = await connection.openAttachment({
    terminal: 't1',
    cols: 80,
    rows: 24,
    history: 500,
    onData: (bytes) => output.push(decode(bytes)),
  });

  socket.receive(encodeFrame(attachment.channel, 0, encode('plain replay without escapes')));
  socket.receive(encodeFrame(attachment.channel, 0, encode('live output')));
  assert.deepEqual(output, ['live output']);
  connection.destroy();
});
