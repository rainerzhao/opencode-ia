(function initAuthClient(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  if (root) root.WorkbenchAuth = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function buildAuthClient() {
  'use strict';

  const UNSAFE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

  function getCookieValue(cookieHeader, name) {
    if (typeof cookieHeader !== 'string' || !name) return null;
    const matches = cookieHeader
      .split(';')
      .map((part) => part.trim())
      .filter((part) => part.startsWith(`${name}=`));
    if (matches.length !== 1) return null;
    try {
      return decodeURIComponent(matches[0].slice(name.length + 1));
    } catch (_error) {
      return null;
    }
  }

  async function responseBody(response) {
    if (response.status === 204) return null;
    const text = await response.text();
    if (!text) return null;
    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      try {
        return JSON.parse(text);
      } catch (_error) {
        throw new Error('服务器返回了无效的 JSON 响应');
      }
    }
    return text;
  }

  function createAuthClient({
    fetchImpl = globalThis.fetch,
    readCookie = () => (typeof document === 'undefined' ? '' : document.cookie),
    baseOrigin = globalThis.location?.origin || 'http://workbench.local'
  } = {}) {
    if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
    const trustedOrigin = new URL(baseOrigin).origin;

    async function request(url, options = {}) {
      let target;
      try {
        target = new URL(url, trustedOrigin);
      } catch (_error) {
        const error = new Error('请求地址无效');
        error.code = 'INVALID_REQUEST_URL';
        throw error;
      }
      if (target.origin !== trustedOrigin) {
        const error = new Error('拒绝向工作台之外的地址发送认证请求');
        error.code = 'CROSS_ORIGIN_REQUEST';
        throw error;
      }
      const method = String(options.method || 'GET').toUpperCase();
      const headers = new Headers(options.headers || {});
      if (UNSAFE_METHODS.has(method) && target.pathname !== '/api/auth/login') {
        const csrfToken = getCookieValue(readCookie(), 'workbench_csrf');
        if (!csrfToken) {
          const error = new Error('安全校验信息缺失，请重新登录');
          error.code = 'CSRF_MISSING';
          throw error;
        }
        headers.set('x-csrf-token', csrfToken);
      }

      const response = await fetchImpl(url, {
        ...options,
        method,
        headers,
        credentials: 'same-origin'
      });
      const body = await responseBody(response);
      if (!response.ok) {
        const error = new Error(body?.error?.message || `请求失败（HTTP ${response.status}）`);
        error.status = response.status;
        error.code = body?.error?.code || 'REQUEST_FAILED';
        error.details = body?.error?.details;
        throw error;
      }
      return body;
    }

    return {
      request,
      login(username, password) {
        return request('/api/auth/login', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ username, password })
        });
      },
      me() {
        return request('/api/auth/me');
      },
      logout() {
        return request('/api/auth/logout', { method: 'POST' });
      }
    };
  }

  return { createAuthClient, getCookieValue };
});
