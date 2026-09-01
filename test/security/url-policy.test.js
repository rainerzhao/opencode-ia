const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');

const {
  assertAllowedFetchUrl,
  fetchAllowedText
} = require('../../src/security/url-policy');

function publicResolver(addresses = ['93.184.216.34']) {
  return async () => addresses.map((address) => ({
    address,
    family: address.includes(':') ? 6 : 4
  }));
}

async function startServer(handler) {
  const server = http.createServer(handler);
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolve);
  });
  return {
    server,
    origin: `http://127.0.0.1:${server.address().port}`,
    close: () => new Promise((resolve) => server.close(resolve))
  };
}

function routeThrough(origin) {
  return (url, options) => {
    const target = new URL(url);
    const transport = new URL(`${target.pathname}${target.search}`, origin);
    return fetch(transport, options);
  };
}

test('allows only exact normalized HTTP or HTTPS hosts', () => {
  assert.throws(() => assertAllowedFetchUrl('http://127.0.0.1/admin', []), /not allowed/i);
  assert.throws(() => assertAllowedFetchUrl('file:///etc/passwd', ['docs.example.com']), /protocol/i);
  assert.throws(() => assertAllowedFetchUrl('https://evil.example/', ['docs.example.com']), /not allowed/i);
  assert.equal(
    assertAllowedFetchUrl('https://docs.example.com/guide', ['docs.example.com']).hostname,
    'docs.example.com'
  );
  assert.throws(
    () => assertAllowedFetchUrl('https://sub.docs.example.com/', ['docs.example.com']),
    /not allowed/i
  );
});

test('rejects credentials and non-default ports without an exact host-port entry', () => {
  assert.throws(
    () => assertAllowedFetchUrl('https://user:pass@docs.example.com/', ['docs.example.com']),
    /credentials/i
  );
  assert.throws(
    () => assertAllowedFetchUrl('https://docs.example.com:8443/', ['docs.example.com']),
    /not allowed/i
  );
  assert.equal(
    assertAllowedFetchUrl('https://docs.example.com:8443/', ['docs.example.com:8443']).host,
    'docs.example.com:8443'
  );
});

test('rejects loopback, private, link-local, metadata, and IPv4-mapped IPv6 addresses after resolution', async () => {
  const cases = [
    ['127.0.0.1'],
    ['10.0.0.1'],
    ['169.254.169.254'],
    ['192.168.1.10'],
    ['::1'],
    ['fe80::1'],
    ['fc00::1'],
    ['::ffff:127.0.0.1'],
    ['::ffff:7f00:1']
  ];

  for (const addresses of cases) {
    await assert.rejects(
      fetchAllowedText('https://docs.example.com/', {
        allowedHosts: ['docs.example.com'],
        resolver: publicResolver(addresses),
        fetchImpl: async () => { throw new Error('network must not be reached'); }
      }),
      (error) => error.code === 'URL_ADDRESS_NOT_ALLOWED'
    );
  }
});

test('rejects a hostname if any returned DNS address is unsafe', async () => {
  await assert.rejects(
    fetchAllowedText('https://docs.example.com/', {
      allowedHosts: ['docs.example.com'],
      resolver: publicResolver(['93.184.216.34', '127.0.0.1']),
      fetchImpl: async () => { throw new Error('network must not be reached'); }
    }),
    (error) => error.code === 'URL_ADDRESS_NOT_ALLOWED'
  );
});

test('validates every redirect before issuing the next request', async (t) => {
  let secondRequestCount = 0;
  const local = await startServer((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: 'https://localhost/secret' });
      res.end();
      return;
    }
    secondRequestCount += 1;
    res.end('must not be reached');
  });
  t.after(local.close);

  await assert.rejects(
    fetchAllowedText('https://docs.example.com/start', {
      allowedHosts: ['docs.example.com'],
      resolver: publicResolver(),
      fetchImpl: routeThrough(local.origin)
    }),
    (error) => error.code === 'URL_HOST_NOT_ALLOWED'
  );
  assert.equal(secondRequestCount, 0);
});

test('follows a relative redirect and returns bounded text from a real HTTP server', async (t) => {
  const local = await startServer((req, res) => {
    if (req.url === '/start') {
      res.writeHead(302, { location: '/final' });
      res.end();
      return;
    }
    res.setHeader('content-type', 'text/plain; charset=utf-8');
    res.end('安全内容');
  });
  t.after(local.close);

  const result = await fetchAllowedText('https://docs.example.com/start', {
    allowedHosts: ['docs.example.com'],
    resolver: publicResolver(),
    fetchImpl: routeThrough(local.origin)
  });
  assert.equal(result.finalUrl, 'https://docs.example.com/final');
  assert.equal(result.text, '安全内容');
});

test('enforces redirect, response-size, and timeout limits with safe errors', async () => {
  const redirectResponse = {
    status: 302,
    headers: new Headers({ location: '/again' }),
    body: null
  };
  await assert.rejects(
    fetchAllowedText('https://docs.example.com/start', {
      allowedHosts: ['docs.example.com'],
      resolver: publicResolver(),
      fetchImpl: async () => redirectResponse,
      maxRedirects: 1
    }),
    (error) => error.code === 'URL_REDIRECT_LIMIT'
  );

  await assert.rejects(
    fetchAllowedText('https://docs.example.com/large', {
      allowedHosts: ['docs.example.com'],
      resolver: publicResolver(),
      fetchImpl: async () => new Response('123456', { status: 200 }),
      maxResponseBytes: 5
    }),
    (error) => error.code === 'URL_RESPONSE_TOO_LARGE'
  );

  await assert.rejects(
    fetchAllowedText('https://docs.example.com/slow', {
      allowedHosts: ['docs.example.com'],
      resolver: publicResolver(),
      fetchImpl: async (_url, { signal }) => new Promise((_resolve, reject) => {
        signal.addEventListener('abort', () => reject(signal.reason), { once: true });
      }),
      timeoutMs: 20
    }),
    (error) => error.code === 'URL_FETCH_TIMEOUT'
  );
});

test('rejects missing and malformed redirect targets with safe errors', async () => {
  for (const location of [null, 'http://[invalid']) {
    await assert.rejects(
      fetchAllowedText('https://docs.example.com/start', {
        allowedHosts: ['docs.example.com'],
        resolver: publicResolver(),
        fetchImpl: async () => ({
          status: 302,
          headers: new Headers(location === null ? {} : { location }),
          body: null
        })
      }),
      (error) => error.code === 'URL_REDIRECT_INVALID' && !error.message.includes('http://')
    );
  }
});

test('timeout and caller cancellation also settle while DNS resolution is pending', async () => {
  const neverResolving = async () => new Promise(() => {});
  await assert.rejects(
    fetchAllowedText('https://docs.example.com/slow-dns', {
      allowedHosts: ['docs.example.com'],
      resolver: neverResolving,
      timeoutMs: 20
    }),
    (error) => error.code === 'URL_FETCH_TIMEOUT'
  );

  const controller = new AbortController();
  const pending = fetchAllowedText('https://docs.example.com/cancel-dns', {
    allowedHosts: ['docs.example.com'],
    resolver: neverResolving,
    signal: controller.signal,
    timeoutMs: 1000
  });
  controller.abort();
  await assert.rejects(pending, (error) => error.code === 'URL_FETCH_ABORTED');
});
