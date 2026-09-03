const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const http = require('node:http');
const { createAuthenticatedWorkbench } = require('../fixtures/authenticated-workbench');

const silentLogger = { log() {}, error() {} };

async function createFixture(t, options = {}) {
  const fixture = await createAuthenticatedWorkbench(t, {
    logger: silentLogger,
    fetchAllowedHosts: options.fetchAllowedHosts,
    urlFetchOptions: options.urlFetchOptions,
    fetchAllowedTextImpl: options.fetchAllowedTextImpl
  });
  const authenticatedFetch = (url, options = {}) => {
    const headers = new Headers(options.headers);
    headers.set('cookie', fixture.admin.cookie);
    headers.set('x-csrf-token', fixture.admin.csrfToken);
    return fetch(url, { ...options, headers });
  };
  return {
    ...fixture,
    knowledgeDir: fixture.config.knowledgeDir,
    solutionsDir: fixture.config.solutionsDir,
    skillsDir: fixture.config.skillsDir,
    uploadTempDir: fixture.config.uploadTempDir,
    privateKnowledgeDir: path.join(fixture.config.knowledgeDir, '.private', 'user-admin'),
    fetch: authenticatedFetch
  };
}

async function jsonResponse(response) {
  const text = await response.text();
  return text ? JSON.parse(text) : null;
}

async function startLocalServer(t, handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  t.after(() => new Promise((resolve) => server.close(resolve)));
  return `http://127.0.0.1:${server.address().port}`;
}

test('article routes allow safe Markdown and reject traversal, absolute, NUL, and symlink escapes', async (t) => {
  const fixture = await createFixture(t);
  const gpuDir = path.join(fixture.knowledgeDir, 'gpu');
  fs.mkdirSync(gpuDir);
  fs.writeFileSync(path.join(gpuDir, 'guide.md'), '# GPU\n\n安全正文');
  const siblingSecret = path.join(fixture.root, 'secret.md');
  fs.writeFileSync(siblingSecret, '不得泄露');
  fs.symlinkSync(siblingSecret, path.join(fixture.knowledgeDir, 'linked.md'));

  const safe = await fixture.fetch(`${fixture.origin}/api/knowledge/article?path=gpu%2Fguide.md`);
  assert.equal(safe.status, 200);
  assert.equal((await jsonResponse(safe)).content, '# GPU\n\n安全正文');

  for (const candidate of ['../secret.md', '..\\secret.md', '/etc/passwd', 'gpu/evil\0.md', 'linked.md']) {
    const response = await fixture.fetch(
      `${fixture.origin}/api/knowledge/article?path=${encodeURIComponent(candidate)}`
    );
    const body = await jsonResponse(response);
    assert.equal(response.status, 400, candidate);
    assert.equal(body.error.code, 'UNSAFE_PATH');
    assert.equal(typeof body.error.requestId, 'string');
    assert.equal(JSON.stringify(body).includes(fixture.root), false);
    assert.equal(JSON.stringify(body).includes('不得泄露'), false);
  }

  const save = await fixture.fetch(`${fixture.origin}/api/knowledge/article`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ filePath: '../escape.md', content: 'escape' })
  });
  assert.equal(save.status, 400);
  assert.equal(fs.existsSync(path.join(fixture.root, 'escape.md')), false);

  const create = await fixture.fetch(`${fixture.origin}/api/knowledge/article/new`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: '../../escape', content: 'escape' })
  });
  assert.equal(create.status, 400);

  const outside = path.join(fixture.root, 'preserve.md');
  fs.writeFileSync(outside, 'preserve');
  const remove = await fixture.fetch(
    `${fixture.origin}/api/knowledge/article?path=${encodeURIComponent(outside)}`,
    { method: 'DELETE' }
  );
  assert.equal(remove.status, 400);
  assert.equal(fs.readFileSync(outside, 'utf8'), 'preserve');
});

test('tree and search skip escaping symlinks and never disclose sibling contents', async (t) => {
  const fixture = await createFixture(t);
  fs.writeFileSync(path.join(fixture.knowledgeDir, 'normal.md'), '# Normal\n\nteam content');
  const secret = path.join(fixture.root, 'outside-secret.md');
  fs.writeFileSync(secret, '# Secret\n\nunique-private-marker');
  fs.symlinkSync(secret, path.join(fixture.knowledgeDir, 'linked.md'));

  const tree = await jsonResponse(await fixture.fetch(`${fixture.origin}/api/knowledge/tree`));
  assert.deepEqual(tree.map((item) => item.path), ['normal.md']);

  const results = await jsonResponse(await fixture.fetch(
    `${fixture.origin}/api/knowledge/search?q=unique-private-marker`
  ));
  assert.deepEqual(results, []);
});

test('URL import is default-deny and does not call DNS or the network', async (t) => {
  let resolverCalls = 0;
  let fetchCalls = 0;
  const fixture = await createFixture(t, {
    urlFetchOptions: {
      resolver: async () => { resolverCalls += 1; return [{ address: '93.184.216.34', family: 4 }]; },
      fetchImpl: async () => { fetchCalls += 1; return new Response('unexpected'); }
    }
  });

  const response = await fixture.fetch(`${fixture.origin}/api/knowledge/fetch-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://docs.example.com/guide' })
  });
  const body = await jsonResponse(response);
  assert.equal(response.status, 403);
  assert.equal(body.error.code, 'URL_HOST_NOT_ALLOWED');
  assert.equal(resolverCalls, 0);
  assert.equal(fetchCalls, 0);
});

test('allowed URL import uses the bounded policy and saves only a safe Markdown destination', async (t) => {
  const upstream = await startLocalServer(t, (_req, res) => {
    res.end('<html><script>hidden()</script><body><h1>Guide</h1><p>团队内容</p></body></html>');
  });
  const fixture = await createFixture(t, {
    fetchAllowedHosts: ['docs.example.com'],
    urlFetchOptions: {
      resolver: async () => [{ address: '93.184.216.34', family: 4 }],
      fetchImpl: (url, options) => {
        const source = new URL(url);
        return fetch(new URL(`${source.pathname}${source.search}`, upstream), options);
      }
    }
  });

  const response = await fixture.fetch(`${fixture.origin}/api/knowledge/fetch-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://docs.example.com/guide', category: 'gpu' })
  });
  const body = await jsonResponse(response);
  assert.equal(response.status, 200);
  assert.equal(body.path, 'gpu/guide.md');
  const saved = fs.readFileSync(path.join(fixture.privateKnowledgeDir, 'gpu', 'guide.md'), 'utf8');
  assert.match(saved, /团队内容/);
  assert.doesNotMatch(saved, /hidden\(\)/);
});

test('server shutdown aborts an in-flight policy fetch through the Task 3 controller', async (t) => {
  let observedSignal;
  const fixture = await createFixture(t, {
    fetchAllowedHosts: ['docs.example.com'],
    fetchAllowedTextImpl: async (_url, options) => {
      observedSignal = options.signal;
      await new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => reject(new Error('aborted')), { once: true });
      });
    }
  });

  const request = fixture.fetch(`${fixture.origin}/api/knowledge/fetch-url`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ url: 'https://docs.example.com/slow' })
  }).catch(() => null);
  for (let attempt = 0; attempt < 50 && !observedSignal; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.ok(observedSignal);
  await fixture.workbench.stop();
  assert.equal(observedSignal.aborted, true);
  await request;
});

test('upload promotes safe files from fixed temporary storage', async (t) => {
  const fixture = await createFixture(t);
  const form = new FormData();
  form.append('category', 'gpu');
  form.append('files', new Blob(['# Guide\n\ncontent'], { type: 'text/markdown' }), 'guide.md');

  const response = await fixture.fetch(`${fixture.origin}/api/knowledge/upload`, {
    method: 'POST',
    body: form
  });
  const body = await jsonResponse(response);
  assert.equal(response.status, 200);
  assert.deepEqual(body.files, [{ name: 'guide.md', path: 'gpu/guide.md' }]);
  assert.equal(fs.readFileSync(path.join(fixture.privateKnowledgeDir, 'gpu', 'guide.md'), 'utf8'), '# Guide\n\ncontent');
  assert.deepEqual(fs.readdirSync(fixture.uploadTempDir), []);
});

test('upload rejects traversal, separator-bearing names, symlink categories, and extensions', async (t) => {
  const fixture = await createFixture(t);
  const outsideDir = path.join(fixture.root, 'outside');
  fs.mkdirSync(outsideDir);
  fs.mkdirSync(fixture.privateKnowledgeDir, { recursive: true });
  fs.symlinkSync(outsideDir, path.join(fixture.privateKnowledgeDir, 'linked'));

  const cases = [
    { category: '../../outside', name: 'escape.md' },
    { category: '..\\outside', name: 'escape.md' },
    { category: '', name: '../escape.md' },
    { category: '', name: 'folder\\escape.md' },
    { category: 'linked', name: 'escape.md' },
    { category: '', name: 'malware.exe' }
  ];

  for (const item of cases) {
    const form = new FormData();
    form.append('category', item.category);
    form.append('files', new Blob(['blocked']), item.name);
    const response = await fixture.fetch(`${fixture.origin}/api/knowledge/upload`, {
      method: 'POST',
      body: form
    });
    const body = await jsonResponse(response);
    assert.equal(response.status, 400, `${item.category}:${item.name}:${JSON.stringify(body)}`);
    assert.equal(typeof body.error.requestId, 'string');
    assert.deepEqual(fs.readdirSync(fixture.uploadTempDir), []);
  }

  assert.deepEqual(fs.readdirSync(outsideDir), []);
  assert.equal(fs.existsSync(path.join(fixture.root, 'escape.md')), false);
});

test('failed multi-file upload leaves neither temporary nor partially promoted files', async (t) => {
  const fixture = await createFixture(t);
  const form = new FormData();
  form.append('category', 'gpu');
  form.append('files', new Blob(['valid']), 'guide.md');
  form.append('files', new Blob(['invalid']), 'blocked.exe');

  const response = await fixture.fetch(`${fixture.origin}/api/knowledge/upload`, {
    method: 'POST',
    body: form
  });
  assert.equal(response.status, 400);
  assert.equal(fs.existsSync(path.join(fixture.privateKnowledgeDir, 'gpu', 'guide.md')), false);
  assert.deepEqual(fs.readdirSync(fixture.uploadTempDir), []);
});
