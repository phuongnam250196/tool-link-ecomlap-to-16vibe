/**
 * 16vibe In-Page Interceptor & Token Bridge
 * Runs in MAIN world to intercept window.fetch & XMLHttpRequest and access page context
 * (Bypasses page CSP because it is registered natively via manifest.json with "world": "MAIN")
 */
(function() {
    'use strict';
    if (window.__16vibe_hook_installed) return;
    window.__16vibe_hook_installed = true;
    try {
        document.documentElement.setAttribute('data-16vibe-hook', 'ready');
    } catch(e) {}

    function isTarget(url) {
        if (!url) return false;
        const str = typeof url === 'string' ? url : (url.href || url.url || String(url));
        if (str.includes('/ai-status') || str.includes('/status') || str.includes('/analytics')) return false;
        try {
            const u = new URL(str, window.location.origin);
            const cleanPath = u.pathname.replace(/\/+$/, '');
            return cleanPath === '/api/products';
        } catch (e) {
            return /\/api\/products(?:\/)?(?:\?|#|$)/.test(str);
        }
    }

    // Monkey-patch window.fetch
    const originalFetch = window.fetch;
    window.fetch = async function(...args) {
        const input = args[0];
        const init = args[1];
        let url = '';
        if (typeof input === 'string') {
            url = input;
        } else if (input && typeof input === 'object') {
            url = input.url || input.href || String(input);
        }

        // Capture auth token if present
        try {
            if (init && init.headers) {
                const h = init.headers;
                let auth = '';
                if (typeof h.get === 'function') {
                    auth = h.get('authorization') || h.get('Authorization');
                } else if (typeof h === 'object') {
                    auth = h.authorization || h.Authorization;
                }
                if (auth) {
                    window.__16vibe_auth_token = auth;
                    try {
                        document.documentElement.setAttribute('data-16vibe-auth', auth);
                        window.dispatchEvent(new CustomEvent('16vibe-token-captured', { detail: { token: auth } }));
                    } catch(e) {}
                }
            }
        } catch(e) {}

        const response = await originalFetch.apply(this, args);

        if (isTarget(url) && response && response.ok) {
            try {
                const clone = response.clone();
                clone.json().then(data => {
                    window.dispatchEvent(new CustomEvent('16vibe-products-captured', {
                        detail: { products: data, url: url, source: 'fetch', time: Date.now() }
                    }));
                }).catch(() => {});
            } catch(e) {}
        }

        return response;
    };

    // Monkey-patch XMLHttpRequest
    const originalOpen = XMLHttpRequest.prototype.open;
    const originalSend = XMLHttpRequest.prototype.send;
    const originalSetHeader = XMLHttpRequest.prototype.setRequestHeader;

    XMLHttpRequest.prototype.open = function(method, url) {
        this._16vibeUrl = url;
        return originalOpen.apply(this, arguments);
    };

    XMLHttpRequest.prototype.setRequestHeader = function(header, value) {
        if (header && header.toLowerCase() === 'authorization' && value) {
            window.__16vibe_auth_token = value;
            try {
                document.documentElement.setAttribute('data-16vibe-auth', value);
                window.dispatchEvent(new CustomEvent('16vibe-token-captured', { detail: { token: value } }));
            } catch(e) {}
        }
        return originalSetHeader.apply(this, arguments);
    };

    XMLHttpRequest.prototype.send = function() {
        if (isTarget(this._16vibeUrl)) {
            this.addEventListener('load', () => {
                if (this.status >= 200 && this.status < 300) {
                    try {
                        const data = JSON.parse(this.responseText);
                        window.dispatchEvent(new CustomEvent('16vibe-products-captured', {
                            detail: { products: data, url: this._16vibeUrl, source: 'xhr', time: Date.now() }
                        }));
                    } catch(e) {}
                }
            });
        }
        return originalSend.apply(this, arguments);
    };

    // Intercept SPA navigation (pushState / replaceState)
    const originalPushState = history.pushState;
    history.pushState = function(...args) {
        const ret = originalPushState.apply(this, args);
        window.dispatchEvent(new CustomEvent('16vibe-route-changed', { detail: { url: window.location.href } }));
        return ret;
    };
    const originalReplaceState = history.replaceState;
    history.replaceState = function(...args) {
        const ret = originalReplaceState.apply(this, args);
        window.dispatchEvent(new CustomEvent('16vibe-route-changed', { detail: { url: window.location.href } }));
        return ret;
    };

    // Deep token searcher (JWT regex + keys + cookies + storage)
    function findTokenAnywhere() {
        if (window.__16vibe_auth_token && window.__16vibe_auth_token.length > 20) {
            return window.__16vibe_auth_token;
        }
        try {
            const domAuth = document.documentElement.getAttribute('data-16vibe-auth');
            if (domAuth && domAuth.length > 20) return domAuth;
        } catch(e) {}

        // 1. Literal keys in localStorage & sessionStorage
        const keys = ['token', 'auth_token', 'accessToken', 'access_token', 'jwt', 'hmt-token', 'user_token', 'auth', 'user', 'session'];
        for (const k of keys) {
            try {
                const v = localStorage.getItem(k) || sessionStorage.getItem(k);
                if (v) {
                    if (typeof v === 'string' && v.length > 20 && !v.startsWith('{')) {
                        return v.startsWith('Bearer ') ? v : 'Bearer ' + v;
                    }
                    if (v.startsWith('{')) {
                        const parsed = JSON.parse(v);
                        const t = parsed.token || parsed.accessToken || parsed.access_token || parsed.jwt || (parsed.user && parsed.user.token) || (parsed.data && parsed.data.token);
                        if (t && typeof t === 'string' && t.length > 15) {
                            return t.startsWith('Bearer ') ? t : 'Bearer ' + t;
                        }
                    }
                }
            } catch(e) {}
        }

        // 2. Scan ALL localStorage items for JWT token (contains eyJ...)
        try {
            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const val = localStorage.getItem(k);
                if (val && typeof val === 'string' && val.includes('eyJ')) {
                    const match = val.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
                    if (match) return 'Bearer ' + match[0];
                }
            }
        } catch(e) {}

        // 3. Scan document.cookie for JWT token
        try {
            const cookies = document.cookie.split(';');
            for (const c of cookies) {
                const trimmed = c.trim();
                if (trimmed.includes('eyJ')) {
                    const match = trimmed.match(/eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);
                    if (match) return 'Bearer ' + match[0];
                }
            }
        } catch(e) {}

        return '';
    }

    // Initial sync of token
    try {
        const initTok = findTokenAnywhere();
        if (initTok) {
            window.__16vibe_auth_token = initTok;
            document.documentElement.setAttribute('data-16vibe-auth', initTok);
        }
    } catch(e) {}

    // Listen for personalization config requests from extension (supports both CustomEvent and postMessage)
    async function handleFetchPersonalization(requestId) {
        try {
            let auth = findTokenAnywhere();
            const headers = { 'Accept': 'application/json' };
            if (auth) {
                headers['Authorization'] = auth.startsWith('Bearer ') ? auth : 'Bearer ' + auth;
            }
            console.log('[16vibe in-page] Calling /api/product-personalization-configs with auth:', auth ? (auth.slice(0, 25) + '...') : 'none');
            const res = await originalFetch('/api/product-personalization-configs?status=active&limit=100', {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });
            console.log('[16vibe in-page] Personalization response status:', res.status);
            if (res.ok) {
                const data = await res.json();
                console.log('[16vibe in-page] Personalization data received:', data);
                const items = Array.isArray(data) ? data : (data.docs || data.data || data.configs || data.items || []);
                window.dispatchEvent(new CustomEvent('16vibe-personalization-response', { detail: { success: true, data: data, items: items } }));
                if (requestId) {
                    window.postMessage({ type: '16VIBE_PERSONALIZATION_CONFIGS_RES', requestId: requestId, success: true, items: items, data: data }, '*');
                }
            } else {
                const errTxt = await res.text().catch(function() { return ''; });
                console.warn('[16vibe in-page] Personalization HTTP error:', res.status, errTxt);
                window.dispatchEvent(new CustomEvent('16vibe-personalization-response', { detail: { success: false, status: res.status, error: errTxt } }));
                if (requestId) {
                    window.postMessage({ type: '16VIBE_PERSONALIZATION_CONFIGS_RES', requestId: requestId, success: false, error: errTxt }, '*');
                }
            }
        } catch(err) {
            console.error('[16vibe in-page] Personalization fetch failed:', err);
            window.dispatchEvent(new CustomEvent('16vibe-personalization-response', { detail: { success: false, error: err.message } }));
            if (requestId) {
                window.postMessage({ type: '16VIBE_PERSONALIZATION_CONFIGS_RES', requestId: requestId, success: false, error: err.message }, '*');
            }
        }
    }

    window.addEventListener('16vibe-fetch-personalization', function(e) {
        const reqId = e.detail && e.detail.requestId;
        handleFetchPersonalization(reqId);
    });

    window.addEventListener('message', function(event) {
        if (event.source !== window || !event.data) return;
        if (event.data.type === '16VIBE_FETCH_PERSONALIZATION_CONFIGS_REQ') {
            handleFetchPersonalization(event.data.requestId);
        }
    });
})();
