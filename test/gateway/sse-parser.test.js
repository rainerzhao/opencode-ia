'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { parseSseStream } = require('../../src/gateway/sse-parser');

function streamFromChunks(chunks) {
  return new ReadableStream({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      controller.close();
    }
  });
}

test('parses JSON SSE events split across chunks and a UTF-8 boundary', async () => {
  const bytes = Buffer.from(
    ': keep-alive\n' +
    'event: message\n' +
    'data: {"type":"message.part.updated",\n' +
    'data: "text":"你好"}\n\n' +
    'data: {"type":"session.idle"}\n\n'
  );
  const splitInsideChinese = bytes.indexOf(Buffer.from('你')) + 1;
  const chunks = [
    bytes.subarray(0, 9),
    bytes.subarray(9, splitInsideChinese),
    bytes.subarray(splitInsideChinese, splitInsideChinese + 1),
    bytes.subarray(splitInsideChinese + 1)
  ];
  const events = [];

  await parseSseStream(streamFromChunks(chunks), (event) => events.push(event));

  assert.deepEqual(events, [
    { type: 'message.part.updated', text: '你好' },
    { type: 'session.idle' }
  ]);
});

test('ignores malformed frames without losing the next valid event', async () => {
  const events = [];
  const stream = streamFromChunks([
    Buffer.from('data: not-json\n\ndata: {"type":"server.connected"}\n\n')
  ]);

  await parseSseStream(stream, (event) => events.push(event));

  assert.deepEqual(events, [{ type: 'server.connected' }]);
});

test('propagates consumer callback errors instead of treating them as malformed JSON', async () => {
  const stream = streamFromChunks([
    Buffer.from('data: {"type":"server.connected"}\n\n')
  ]);

  await assert.rejects(
    parseSseStream(stream, () => { throw new SyntaxError('consumer failed'); }),
    /consumer failed/
  );
});

test('stops reading when the caller aborts', async () => {
  const controller = new AbortController();
  const stream = new ReadableStream({
    start(streamController) {
      streamController.enqueue(Buffer.from('data: {"type":"first"}\n\n'));
    },
    cancel() {}
  });

  await assert.rejects(
    parseSseStream(stream, () => controller.abort(), controller.signal),
    (error) => error.code === 'OPENCODE_EVENT_STREAM_ABORTED'
  );
});

test('rejects an event that exceeds the configured byte limit', async () => {
  const stream = streamFromChunks([
    Buffer.from(`data: {"text":"${'x'.repeat(80)}"}\n\n`)
  ]);

  await assert.rejects(
    parseSseStream(stream, () => {}, undefined, { maxEventBytes: 32 }),
    (error) => error.code === 'OPENCODE_EVENT_LIMIT'
  );
});
