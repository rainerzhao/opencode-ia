'use strict';

const SESSION_COOKIE = 'workbench_session';
const CSRF_COOKIE = 'workbench_csrf';

function readCookie(header, name) {
  if (typeof header !== 'string' || header.length > 16 * 1024) return null;
  const matches = [];
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator < 1) continue;
    if (part.slice(0, separator).trim() !== name) continue;
    try {
      const value = decodeURIComponent(part.slice(separator + 1).trim());
      if (!value || /[\u0000-\u001f\u007f]/.test(value)) return null;
      matches.push(value);
    } catch {
      return null;
    }
  }
  return matches.length === 1 ? matches[0] : null;
}

function serializeCookie(name, value, { maxAgeSeconds, secure, httpOnly }) {
  const attributes = [
    `${name}=${encodeURIComponent(value)}`,
    `Max-Age=${maxAgeSeconds}`,
    'Path=/',
    'SameSite=Lax'
  ];
  if (httpOnly) attributes.push('HttpOnly');
  if (secure) attributes.push('Secure');
  return attributes.join('; ');
}

function serializeAuthCookies({ token, csrfToken, maxAgeSeconds, secure }) {
  return [
    serializeCookie(SESSION_COOKIE, token, { maxAgeSeconds, secure, httpOnly: true }),
    serializeCookie(CSRF_COOKIE, csrfToken, { maxAgeSeconds, secure, httpOnly: false })
  ];
}

function serializeClearedAuthCookies({ secure }) {
  return [
    serializeCookie(SESSION_COOKIE, '', { maxAgeSeconds: 0, secure, httpOnly: true }),
    serializeCookie(CSRF_COOKIE, '', { maxAgeSeconds: 0, secure, httpOnly: false })
  ];
}

module.exports = {
  SESSION_COOKIE,
  CSRF_COOKIE,
  readCookie,
  serializeAuthCookies,
  serializeClearedAuthCookies
};
