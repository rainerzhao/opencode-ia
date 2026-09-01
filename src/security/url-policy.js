const dns = require('node:dns');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const { domainToASCII } = require('node:url');

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

function urlError(code, message, status = 403) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

function normalizedHostname(hostname) {
  const unwrapped = hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
  if (net.isIP(unwrapped)) return unwrapped.toLowerCase();
  const ascii = domainToASCII(unwrapped).toLowerCase().replace(/\.$/, '');
  if (!ascii) throw urlError('URL_INVALID', 'URL hostname is invalid', 400);
  return ascii;
}

function formatHost(hostname, port) {
  const formatted = net.isIP(hostname) === 6 ? `[${hostname}]` : hostname;
  return port ? `${formatted}:${port}` : formatted;
}

function normalizeAllowedHost(entry) {
  if (typeof entry !== 'string' || !entry.trim() || entry.includes('/') || entry.includes('@')) {
    return null;
  }
  const value = entry.trim();
  let hostname = value;
  let port = '';

  if (value.startsWith('[')) {
    const close = value.indexOf(']');
    if (close === -1) return null;
    hostname = value.slice(1, close);
    const suffix = value.slice(close + 1);
    if (suffix) {
      if (!/^:\d+$/.test(suffix)) return null;
      port = suffix.slice(1);
    }
  } else {
    const colon = value.lastIndexOf(':');
    if (colon !== -1) {
      if (value.indexOf(':') !== colon || !/^\d+$/.test(value.slice(colon + 1))) return null;
      hostname = value.slice(0, colon);
      port = value.slice(colon + 1);
    }
  }

  if (port && (Number(port) < 1 || Number(port) > 65535)) return null;
  try {
    return formatHost(normalizedHostname(hostname), port ? String(Number(port)) : '');
  } catch {
    return null;
  }
}

function assertAllowedFetchUrl(rawUrl, allowedHosts = []) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw urlError('URL_INVALID', 'URL is invalid', 400);
  }

  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw urlError('URL_PROTOCOL_NOT_ALLOWED', 'URL protocol is not allowed', 400);
  }
  if (parsed.username || parsed.password) {
    throw urlError('URL_CREDENTIALS_NOT_ALLOWED', 'URL credentials are not allowed', 400);
  }

  const hostname = normalizedHostname(parsed.hostname);
  const candidate = formatHost(hostname, parsed.port);
  const normalizedAllowed = new Set(
    (Array.isArray(allowedHosts) ? allowedHosts : [])
      .map(normalizeAllowedHost)
      .filter(Boolean)
  );

  if (!normalizedAllowed.has(candidate)) {
    throw urlError('URL_HOST_NOT_ALLOWED', 'URL host is not allowed');
  }
  return parsed;
}

function ipv4Number(address) {
  const parts = address.split('.').map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) {
    return null;
  }
  return (((parts[0] * 256 + parts[1]) * 256 + parts[2]) * 256 + parts[3]) >>> 0;
}

function inIpv4Range(value, base, bits) {
  const baseValue = ipv4Number(base);
  const divisor = 2 ** (32 - bits);
  return Math.floor(value / divisor) === Math.floor(baseValue / divisor);
}

function isForbiddenIpv4(address) {
  const value = ipv4Number(address);
  if (value === null) return true;
  return [
    ['0.0.0.0', 8],
    ['10.0.0.0', 8],
    ['100.64.0.0', 10],
    ['127.0.0.0', 8],
    ['169.254.0.0', 16],
    ['172.16.0.0', 12],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['192.168.0.0', 16],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
    ['224.0.0.0', 4],
    ['240.0.0.0', 4]
  ].some(([base, bits]) => inIpv4Range(value, base, bits));
}

function ipv6BigInt(address) {
  let source = address.toLowerCase();
  const zoneIndex = source.indexOf('%');
  if (zoneIndex !== -1) return null;

  const dottedIndex = source.lastIndexOf(':');
  if (source.includes('.')) {
    const dotted = source.slice(dottedIndex + 1);
    const v4 = ipv4Number(dotted);
    if (v4 === null) return null;
    source = `${source.slice(0, dottedIndex)}:${(v4 >>> 16).toString(16)}:${(v4 & 0xffff).toString(16)}`;
  }

  const halves = source.split('::');
  if (halves.length > 2) return null;
  const left = halves[0] ? halves[0].split(':') : [];
  const right = halves.length === 2 && halves[1] ? halves[1].split(':') : [];
  const missing = 8 - left.length - right.length;
  if ((halves.length === 1 && missing !== 0) || missing < 0) return null;
  const groups = [...left, ...Array(missing).fill('0'), ...right];
  if (groups.length !== 8 || groups.some((group) => !/^[0-9a-f]{1,4}$/.test(group))) return null;
  return groups.reduce((value, group) => (value << 16n) | BigInt(`0x${group}`), 0n);
}

function hasIpv6Prefix(value, prefix, bits) {
  const prefixValue = ipv6BigInt(prefix);
  return (value >> BigInt(128 - bits)) === (prefixValue >> BigInt(128 - bits));
}

function isForbiddenIpv6(address) {
  const value = ipv6BigInt(address);
  if (value === null || value === 0n || value === 1n) return true;

  // IPv4-compatible and IPv4-mapped IPv6 forms inherit the embedded IPv4 policy.
  const high96 = value >> 32n;
  if (high96 === 0n || high96 === 0xffffn) {
    const embedded = Number(value & 0xffffffffn);
    const dotted = [24, 16, 8, 0].map((shift) => (embedded >>> shift) & 0xff).join('.');
    return isForbiddenIpv4(dotted);
  }

  if (hasIpv6Prefix(value, '64:ff9b::', 96)) {
    const embedded = Number(value & 0xffffffffn);
    const dotted = [24, 16, 8, 0].map((shift) => (embedded >>> shift) & 0xff).join('.');
    return isForbiddenIpv4(dotted);
  }

  return [
    ['64:ff9b:1::', 48],
    ['100::', 64],
    ['2001:2::', 48],
    ['2001:db8::', 32],
    ['fc00::', 7],
    ['fe80::', 10],
    ['ff00::', 8]
  ].some(([prefix, bits]) => hasIpv6Prefix(value, prefix, bits));
}

function isForbiddenAddress(address) {
  const family = net.isIP(address);
  if (family === 4) return isForbiddenIpv4(address);
  if (family === 6) return isForbiddenIpv6(address);
  return true;
}

function raceWithSignal(promise, signal) {
  if (signal.aborted) return Promise.reject(signal.reason || new Error('aborted'));
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      cleanup();
      reject(signal.reason || new Error('aborted'));
    };
    const cleanup = () => signal.removeEventListener('abort', onAbort);
    signal.addEventListener('abort', onAbort, { once: true });
    Promise.resolve(promise).then(
      (value) => { cleanup(); resolve(value); },
      (error) => { cleanup(); reject(error); }
    );
  });
}

async function resolvePublicAddresses(hostname, resolver, signal) {
  let records;
  if (net.isIP(hostname)) {
    records = [{ address: hostname, family: net.isIP(hostname) }];
  } else {
    try {
      records = await raceWithSignal(
        resolver(hostname, { all: true, verbatim: true }),
        signal
      );
    } catch (error) {
      if (signal.aborted) throw error;
      throw urlError('URL_DNS_FAILED', 'URL hostname could not be resolved', 502);
    }
  }

  if (!Array.isArray(records)) records = records ? [records] : [];
  const normalized = records.map((record) => typeof record === 'string'
    ? { address: record, family: net.isIP(record) }
    : { address: record.address, family: record.family || net.isIP(record.address) });
  if (!normalized.length || normalized.some(({ address, family }) => !family || isForbiddenAddress(address))) {
    throw urlError('URL_ADDRESS_NOT_ALLOWED', 'URL address is not allowed');
  }
  return normalized;
}

function pinnedFetch(url, { signal, validatedAddresses }) {
  return new Promise((resolve, reject) => {
    const parsed = new URL(url);
    const transport = parsed.protocol === 'https:' ? https : http;
    const addresses = validatedAddresses.slice();
    const request = transport.request(parsed, {
      method: 'GET',
      headers: { accept: 'text/*, application/json, application/xhtml+xml, application/xml;q=0.9, */*;q=0.1' },
      signal,
      autoSelectFamily: false,
      lookup(_hostname, options, callback) {
        if (options && options.all) {
          callback(null, addresses);
          return;
        }
        const selected = addresses[0];
        callback(null, selected.address, selected.family);
      }
    }, (response) => {
      resolve({
        status: response.statusCode,
        headers: new Headers(response.headers),
        body: response
      });
    });
    request.once('error', reject);
    request.end();
  });
}

async function cancelBody(response) {
  try {
    await response.body?.cancel?.();
  } catch {}
  response.body?.destroy?.();
}

async function readBoundedBody(response, maxResponseBytes) {
  const declaredLength = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxResponseBytes) {
    await cancelBody(response);
    throw urlError('URL_RESPONSE_TOO_LARGE', 'URL response exceeded the size limit', 413);
  }

  if (!response.body) return '';
  const chunks = [];
  let total = 0;
  for await (const chunk of response.body) {
    const buffer = Buffer.from(chunk);
    total += buffer.length;
    if (total > maxResponseBytes) {
      await cancelBody(response);
      throw urlError('URL_RESPONSE_TOO_LARGE', 'URL response exceeded the size limit', 413);
    }
    chunks.push(buffer);
  }
  return Buffer.concat(chunks).toString('utf8');
}

async function fetchAllowedText(rawUrl, options = {}) {
  const {
    allowedHosts = [],
    fetchImpl = pinnedFetch,
    resolver = dns.promises.lookup,
    maxRedirects = 5,
    maxResponseBytes = 2 * 1024 * 1024,
    timeoutMs = 10000,
    signal
  } = options;

  if (!Number.isInteger(maxRedirects) || maxRedirects < 0 ||
      !Number.isInteger(maxResponseBytes) || maxResponseBytes < 1 ||
      !Number.isInteger(timeoutMs) || timeoutMs < 1) {
    throw urlError('URL_POLICY_INVALID', 'URL fetch limits are invalid', 500);
  }

  const controller = new AbortController();
  let timedOut = false;
  const abortFromCaller = () => controller.abort(signal.reason);
  if (signal?.aborted) abortFromCaller();
  else signal?.addEventListener('abort', abortFromCaller, { once: true });
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);
  timer.unref?.();

  try {
    let current = assertAllowedFetchUrl(rawUrl, allowedHosts);
    let redirects = 0;

    while (true) {
      const hostname = normalizedHostname(current.hostname);
      const validatedAddresses = await resolvePublicAddresses(hostname, resolver, controller.signal);
      let response;
      try {
        response = await fetchImpl(current.href, {
          redirect: 'manual',
          signal: controller.signal,
          validatedAddresses
        });
      } catch (error) {
        if (controller.signal.aborted) {
          throw urlError(
            timedOut ? 'URL_FETCH_TIMEOUT' : 'URL_FETCH_ABORTED',
            timedOut ? 'URL fetch timed out' : 'URL fetch was cancelled',
            timedOut ? 504 : 499
          );
        }
        throw urlError('URL_FETCH_FAILED', 'URL fetch failed', 502);
      }

      if (REDIRECT_STATUSES.has(response.status)) {
        const location = response.headers?.get?.('location');
        await cancelBody(response);
        if (!location) throw urlError('URL_REDIRECT_INVALID', 'URL redirect target is invalid', 502);
        if (redirects >= maxRedirects) {
          throw urlError('URL_REDIRECT_LIMIT', 'URL redirect limit exceeded', 502);
        }
        let next;
        try {
          next = new URL(location, current);
        } catch {
          throw urlError('URL_REDIRECT_INVALID', 'URL redirect target is invalid', 502);
        }
        current = assertAllowedFetchUrl(next.href, allowedHosts);
        redirects += 1;
        continue;
      }

      if (response.status < 200 || response.status >= 300) {
        await cancelBody(response);
        throw urlError('URL_HTTP_ERROR', 'URL server returned an unsuccessful response', 502);
      }
      const text = await readBoundedBody(response, maxResponseBytes);
      return { finalUrl: current.href, text };
    }
  } catch (error) {
    if (controller.signal.aborted &&
        error.code !== 'URL_FETCH_TIMEOUT' && error.code !== 'URL_FETCH_ABORTED') {
      throw urlError(
        timedOut ? 'URL_FETCH_TIMEOUT' : 'URL_FETCH_ABORTED',
        timedOut ? 'URL fetch timed out' : 'URL fetch was cancelled',
        timedOut ? 504 : 499
      );
    }
    throw error;
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abortFromCaller);
  }
}

module.exports = {
  assertAllowedFetchUrl,
  fetchAllowedText,
  isForbiddenAddress
};
