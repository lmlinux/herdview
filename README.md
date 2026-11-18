# herdview

`herdview` is a framework-independent ES module for embedding herdr terminals. It owns the WebSocket protocol and ghostty-web lifecycle; the host application owns all UI.

- `HerdConnection`: token-authenticated WebSocket, RPC, automatic reconnect, `terminal.list`, event subscription, incremental JSON-lines parsing, frame codec, and CREDIT backpressure.
- `HerdView`: one mountable terminal with attach, observe mode, keyboard input, resize/focus reporting, and lifecycle events.
- One connection can drive any number of views. No sidebar, terminal list, status indicator, or other application UI is included.

## Install

```sh
npm install herdview ghostty-web
```

Use a bundler with the bare `herdview` and `ghostty-web` imports, or serve both packages and provide an import map:

```html
<script type="importmap">
{
  "imports": {
    "herdview": "/node_modules/herdview/index.js",
    "ghostty-web": "/node_modules/ghostty-web/dist/ghostty-web.js"
  }
}
</script>
```

The ghostty WASM file must also be served at `/node_modules/ghostty-web/ghostty-vt.wasm` for that mapping.

## Minimal example

```js
import { HerdConnection, HerdView } from 'herdview';

const connection = new HerdConnection({
  url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/ws`,
  token: window.__TOKEN__,
});

const view = new HerdView(connection, {
  terminalOptions: { fontSize: 14, scrollback: 10000 },
  history: 500,
}).mount(document.querySelector('#terminal'));

view.on('title', ({ title }) => {
  document.title = title;
});
view.on('closed', ({ reason, exit_code }) => {
  console.log('terminal closed', reason, exit_code);
});

await connection.connect();
await view.attach('t1');
```

The mount element is owned by the view while attached. Mount before calling `attach()`.

## HerdConnection

```js
const connection = new HerdConnection({
  url: 'ws://localhost:8787/ws',
  token: 'secret',
  reconnect: true,
  reconnectDelay: 500,
  maxReconnectDelay: 10000,
  rpcTimeout: 20000,
});
```

`connect()` resolves after the gateway handshake, event subscription, and initial `terminal.list({ all: true })`. Reconnects automatically repeat that initialization. `whenReady()` waits for the current connection cycle.

- `terminals`: current terminal records as a new array.
- `getTerminal(address)`: one current record.
- `listTerminals({ all, labels })`: refresh and return terminal records.
- `rpc(method, params)`: call another herdr RPC method.
- `on(type, listener)`: subscribe; returns an unsubscribe function.
- `destroy()`: stop reconnecting, close streams, and release listeners.

Connection events:

- `status`: `{ state, attempt, ... }`, where state is `connecting`, `connected`, `ready`, `disconnected`, `reconnecting`, or `destroyed`.
- `ready`: `{ terminals }` after every successful initialization.
- `terminals`: `{ terminals }` after snapshots or terminal events.
- `event`: raw `event` notification params.
- `missed`: raw snapshot notification params after the local snapshot is replaced.
- `error`: `{ error }` for socket or initialization errors.

## HerdView

```js
const view = new HerdView(connection, {
  terminalOptions: {},
  history: 500,
  autoFocus: true,
  autoResize: true,
});
view.mount(element);
await view.attach(address, { observe: false });
```

- `attach(address, { observe })`: attach and render first paint plus live output. Active attachments are re-established after reconnect.
- `setObserve(value)`: reattach the current terminal in viewer or observer mode.
- `write(data)`: send keyboard-equivalent input; returns `false` in observe mode or while inactive.
- `focus()`: focus the terminal and report focus for a viewer.
- `detach()`: close the attachment and dispose the renderer without destroying the connection.
- `destroy()`: permanently release the view, renderer, connection listener, and window listeners.
- `on(type, listener)`: subscribe; returns an unsubscribe function.
- `active`, `address`, `observe`, `terminal`: current view state.

View events:

- `status`: `{ state, address, observe, ... }`; states include `attaching`, `attached`, `reconnecting`, `closed`, `detached`, `error`, and `destroyed`.
- `title`: `{ title }` from terminal OSC title changes.
- `closed`: decoded close payload, usually `{ reason, exit_code }`.
- `resize`: `{ cols, rows }` from ghostty-web.
- `focus`: `{ focused }` when a viewer reports focus or blur.
- `error`: `{ error }` if automatic reattachment fails.

Observers never send input, RESIZE, or FOCUS frames. DATA is credited only after it is delivered to the terminal renderer. All protocol framing and JSON-lines boundaries are handled internally.

## Development

```sh
npm test
npm run check
```

`test/browser-check.cjs` is an optional consumer smoke test for a running herdgate instance. It requires Playwright and uses `HERDVIEW_URL` (default `http://127.0.0.1:8795/`) and `HERDVIEW_SCREENSHOT`. Set `PLAYWRIGHT_MODULE` when Playwright is installed outside the project.
