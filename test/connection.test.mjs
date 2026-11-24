import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import { Ghostty } from 'ghostty-web';
import { decodeFrame, encodeFrame, HerdConnection } from '../index.js';

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
        result = {
          channel: ++this.attachSeq,
          terminal: { address: request.params.terminal, name: request.params.terminal },
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

test('history replay filtering ends after the first payload', async () => {
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
  socket.receive(encodeFrame(attachment.channel, 0, encode('plain replay without escapes')));
  socket.receive(encodeFrame(attachment.channel, 0, encode('live output')));
  assert.deepEqual(output, ['live output']);
  connection.destroy();
});
