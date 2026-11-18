import assert from 'node:assert/strict';
import test from 'node:test';
import {
  decodeFrame,
  encodeCredit,
  encodeFrame,
  encodeResize,
  webSocketUrl,
} from '../index.js';

test('frames round-trip binary payloads and respect typed-array offsets', () => {
  const wrapped = Uint8Array.of(99, 1, 2, 3, 88);
  const encoded = encodeFrame(0x12345678, 4, wrapped.subarray(1, 4));
  const decoded = decodeFrame(encoded);
  assert.equal(decoded.channel, 0x12345678);
  assert.equal(decoded.kind, 4);
  assert.deepEqual([...decoded.payload], [1, 2, 3]);
});

test('frame decoder rejects truncated and length-mismatched input', () => {
  assert.equal(decodeFrame(Uint8Array.of(1, 2, 3)), null);
  const encoded = encodeFrame(1, 0, Uint8Array.of(1, 2));
  assert.equal(decodeFrame(encoded.subarray(0, encoded.length - 1)), null);
  assert.equal(decodeFrame(Uint8Array.of(...encoded, 0)), null);
});

test('control payloads use little-endian sizes and credits', () => {
  assert.deepEqual([...encodeCredit(0x12345678)], [0x78, 0x56, 0x34, 0x12]);
  assert.deepEqual([...encodeResize(110, 32)], [110, 0, 32, 0]);
});

test('WebSocket URLs preserve existing parameters and encode tokens', () => {
  assert.equal(
    webSocketUrl('ws://example.test/ws?scope=one', 'a b/c'),
    'ws://example.test/ws?scope=one&token=a+b%2Fc',
  );
});
