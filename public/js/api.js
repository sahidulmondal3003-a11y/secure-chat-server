/**
 * api.js - thin fetch wrapper shared by every page.
 * Handles JSON, credentials (httpOnly cookies), and CSRF token header.
 */
const Api = (() => {
  let csrfToken = null;

  function getCookie(name) {
    const match = document.cookie.match(new RegExp('(?:^|; )' + name + '=([^;]*)'));
    return match ? decodeURIComponent(match[1]) : null;
  }

  async function ensureCsrf() {
    csrfToken = getCookie('csrf_token');
    if (csrfToken) return csrfToken;
    const res = await fetch('/api/auth/csrf-token', { credentials: 'include' });
    const data = await res.json();
    csrfToken = data.csrfToken;
    return csrfToken;
  }

  async function request(method, url, body, opts = {}) {
    const headers = { ...(opts.headers || {}) };
    let payload = body;

    if (!(body instanceof FormData)) {
      headers['Content-Type'] = 'application/json';
      payload = body ? JSON.stringify(body) : undefined;
    }

    if (method !== 'GET') {
      await ensureCsrf();
      headers['X-CSRF-Token'] = csrfToken;
    }

    const res = await fetch(url, {
      method,
      headers,
      body: payload,
      credentials: 'include',
    });

    let data;
    try {
      data = await res.json();
    } catch (e) {
      data = { success: res.ok, message: res.statusText };
    }

    if (!res.ok) {
      const err = new Error(data.message || 'Request failed');
      err.status = res.status;
      err.data = data;
      throw err;
    }
    return data;
  }

  return {
    get: (url) => request('GET', url),
    post: (url, body) => request('POST', url, body),
    put: (url, body) => request('PUT', url, body),
    patch: (url, body) => request('PATCH', url, body),
    del: (url, body) => request('DELETE', url, body),
    ensureCsrf,
  };
})();
