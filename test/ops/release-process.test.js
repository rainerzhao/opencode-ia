'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const net = require('node:net');
const { startRelease } = require('../fixtures/release-process');

async function fixture(t, code) {
  const releaseDir = fs.mkdtempSync(path.join(os.tmpdir(), 'release-process-'));
  t.after(() => fs.rmSync(releaseDir, { recursive: true, force: true }));
  fs.mkdirSync(path.join(releaseDir, 'scripts'));
  fs.writeFileSync(path.join(releaseDir, 'scripts/start-production.js'), code);
  const server = net.createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return { releaseDir, port, env: { ...process.env, PRIVATE_CANARY: 'never-in-argv' }, startupTimeoutMs: 1500, shutdownTimeoutMs: 150 };
}
const healthy = `require('node:http').createServer((req,res) => {
  res.setHeader('Content-Type','application/json'); res.end(JSON.stringify({status:'healthy',database:'healthy',gateway:'healthy'}));
}).listen(Number(process.env.PORT), '127.0.0.1');`;

test('starts own release with isolated cwd and env; stops idempotently', async t => {
  const options = await fixture(t, `
    if (process.cwd() !== require('node:fs').realpathSync(process.env.WORKBENCH_ROOT) || process.env.WEB_DIST_DIR !== process.env.WORKBENCH_ROOT + '/dist/web' ||
        process.argv.length !== 2 || process.env.PRIVATE_CANARY !== 'never-in-argv') process.exit(4);
    ${healthy}
  `);
  const running = await startRelease(options);
  t.after(() => running.stop());
  assert.equal((await fetch(running.baseUrl + '/healthz')).status, 200);
  await running.stop();
  await running.stop();
  await assert.rejects(fetch(running.baseUrl + '/healthz'));
});

test('early exit returns a safe error without leaking child stderr', async t => {
  const options = await fixture(t, "console.error(process.env.PRIVATE_CANARY); process.exit(8);");
  await assert.rejects(startRelease(options), { message: 'RELEASE_PROCESS_EXITED', code: 'RELEASE_PROCESS_EXITED' });
});

test('unhealthy process times out and releases its listening port', async t => {
  const options = await fixture(t, healthy.replace("status:'healthy'", "status:'degraded'"));
  options.startupTimeoutMs = 450;
  await assert.rejects(startRelease(options), { code: 'RELEASE_PROCESS_TIMEOUT' });
  await assert.rejects(fetch(`http://127.0.0.1:${options.port}/healthz`));
});

test('stop kills a process that ignores SIGTERM within a bounded deadline', async t => {
  const options = await fixture(t, `process.on('SIGTERM', () => {}); ${healthy}`);
  const running = await startRelease(options);
  t.after(() => running.stop());
  const before = Date.now();
  await running.stop();
  assert.ok(Date.now() - before < 2500);
  await assert.rejects(fetch(running.baseUrl + '/healthz'));
});

test('stop reaps a same-group descendant even when parent exits gracefully', async t => {
  const options = await fixture(t, `
    require('node:child_process').spawn(process.execPath, ['-e', "process.on('SIGTERM',()=>{}); setInterval(()=>{},1000)"], {stdio:'ignore'});
    process.on('SIGTERM', () => process.exit(0)); ${healthy}
  `);
  const running = await startRelease(options);
  t.after(() => running.stop());
  await running.stop();
  assert.throws(() => process.kill(-running.pid, 0), { code: 'ESRCH' });
});

test('refuses an occupied port without touching the existing listener', async t => {
  const options = await fixture(t, healthy);
  const server = net.createServer(socket => socket.end());
  await new Promise(resolve => server.listen(options.port, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  await assert.rejects(startRelease(options), { code: 'RELEASE_PROCESS_PORT_UNAVAILABLE' });
  assert.equal(server.listening, true);
});

test('health body that never finishes cannot bypass startup deadline', async t => {
  const options = await fixture(t, `require('node:http').createServer((req,res)=> {
    res.writeHead(200, {'Content-Type':'application/json'}); res.write('{');
  }).listen(Number(process.env.PORT), '127.0.0.1');`);
  options.startupTimeoutMs = 450;
  const before = Date.now();
  await assert.rejects(startRelease(options), { code: 'RELEASE_PROCESS_TIMEOUT' });
  assert.ok(Date.now() - before < 2500);
  await assert.rejects(fetch(`http://127.0.0.1:${options.port}/healthz`));
});

test('SIGTERM gives the child a chance to flush before escalation', async t => {
  const options = await fixture(t, `process.on('SIGTERM',()=> {
    require('node:fs').writeFileSync('graceful-stop', 'flushed'); process.exit(0);
  }); ${healthy}`);
  const running = await startRelease(options);
  t.after(() => running.stop());
  await running.stop();
  assert.equal(fs.readFileSync(path.join(options.releaseDir, 'graceful-stop'), 'utf8'), 'flushed');
});

test('invalid input fails with a safe code before spawning', async t => {
  const options = await fixture(t, healthy);
  for (const change of [{ port: 0 }, { releaseDir: '.' }, { startupTimeoutMs: 0 }, { shutdownTimeoutMs: -1 }]) {
    await assert.rejects(startRelease({ ...options, ...change }), { code: 'RELEASE_PROCESS_INVALID' });
  }
});
