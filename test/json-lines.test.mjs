import assert from 'node:assert/strict';
import test from 'node:test';
import { createJsonLineParser } from '../json-lines.js';

test('JSON lines survive arbitrary frame and UTF-8 boundaries', () => {
  const lines = [];
  const parse = createJsonLineParser((line) => lines.push(line));
  const input = new TextEncoder().encode('{"text":"你好"}\n{"ok":true}\n{"partial":');
  for (const byte of input) parse(Uint8Array.of(byte));
  assert.deepEqual(lines, ['{"text":"你好"}', '{"ok":true}']);
  parse(new TextEncoder().encode('1}\n'));
  assert.equal(lines.at(-1), '{"partial":1}');
  parse(new TextEncoder().encode('{"frameEnd":true}'));
  assert.equal(lines.at(-1), '{"frameEnd":true}');
});

test('parsers keep independent channel state and skip blank lines', () => {
  const first = [];
  const second = [];
  const parseFirst = createJsonLineParser((line) => first.push(line));
  const parseSecond = createJsonLineParser((line) => second.push(line));
  const encode = (text) => new TextEncoder().encode(text);
  parseFirst(encode('{"id":'));
  parseSecond(encode('\n{"id":2}\n'));
  parseFirst(encode('1}\n'));
  assert.deepEqual(first, ['{"id":1}']);
  assert.deepEqual(second, ['{"id":2}']);
});

test('complete JSON without a trailing newline is emitted at frame end', () => {
  const lines = [];
  const parse = createJsonLineParser((line) => lines.push(line));
  const encode = (text) => new TextEncoder().encode(text);
  parse(encode('{"id":'));
  assert.deepEqual(lines, []);
  parse(encode('1}'));
  assert.deepEqual(lines, ['{"id":1}']);
});

test('split surrogate pairs and malformed trailing JSON remain pending', () => {
  const lines = [];
  const parse = createJsonLineParser((line) => lines.push(line));
  const bytes = new TextEncoder().encode('{"emoji":"😀"}');
  parse(bytes.subarray(0, 11));
  assert.deepEqual(lines, []);
  parse(bytes.subarray(11));
  assert.deepEqual(lines, ['{"emoji":"😀"}']);
  parse(new TextEncoder().encode('{"still":'));
  assert.equal(lines.length, 1);
});
