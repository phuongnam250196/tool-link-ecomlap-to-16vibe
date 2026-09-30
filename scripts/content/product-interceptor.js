/**
 * 16vibe Assistant - Product Interceptor & Synchronizer
 * 
 * Passively intercepts products when the page calls /api/products:
 * 1. Injects page script to hook window.fetch & XMLHttpRequest for /api/products
 * 2. Extracts and normalizes valid products (ensuring image_url exists)
 * 3. Does NOT perform fake DOM scraping or overwrite valid store data
 */

(function () {
    'use strict';

    // Clear any previously corrupted ecomlap_products that had empty images
    try {
        chrome.storage.local.get(['ecomlap_products'], (res) => {
            if (res && Array.isArray(res.ecomlap_products)) {
                const hasInvalid = res.ecomlap_products.some(p => !p.image_url || p.image_url.trim() === '');
                if (hasInvalid) {
                    chrome.storage.local.remove(['ecomlap_products', 'last_products_sync']);
                    console.log('[16vibe] Cleaned corrupted product cache with empty images');
                }
            }
        });
    } catch (e) {}

    /**
     * 1. Inject In-Page Network Interceptor into page context
     */
    function injectNetworkHook() {
        try {
            const script = document.createElement('script');
            script.textContent = `
                (function() {
                    const TARGET_PATH = '/api/products';
                    const TARGET_FULL = 'ecomlap.com/api/products';

                    function isTarget(url) {
                        if (!url || typeof url !== 'string') return false;
                        return url.includes(TARGET_PATH) || url.includes(TARGET_FULL);
                    }

                    // Monkey-patch window.fetch
                    const originalFetch = window.fetch;
                    window.fetch = async function(...args) {
                        const input = args[0];
                        let url = '';
                        if (typeof input === 'string') {
                            url = input;
                        } else if (input && input.url) {
                            url = input.url;
                        }

                        const response = await originalFetch.apply(this, args);

                        if (isTarget(url) && response && response.ok) {
                            try {
                                const clone = response.clone();
                                clone.json().then(data => {
                                    window.dispatchEvent(new CustomEvent('16vibe-products-captured', {
                                        detail: { products: data, url, source: 'fetch', time: Date.now() }
                                    }));
                                }).catch(() => {});
                            } catch(e) {}
                        }

                        return response;
                    };

                    // Monkey-patch XMLHttpRequest
                    const originalOpen = XMLHttpRequest.prototype.open;
                    const originalSend = XMLHttpRequest.prototype.send;

                    XMLHttpRequest.prototype.open = function(method, url) {
                        this._16vibeUrl = url;
                        return originalOpen.apply(this, arguments);
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
                })();
            `;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
        } catch (e) {
            console.warn('[16vibe] Could not inject network hook:', e);
        }
    }

    /**
     * 2. Extract product array from various response formats
     */
    function extractProductList(json) {
        if (!json) return [];
        if (Array.isArray(json)) return json;
        if (json.data && Array.isArray(json.data)) return json.data;
        if (json.data && Array.isArray(json.data.products)) return json.data.products;
        if (json.data && Array.isArray(json.data.items)) return json.data.items;
        if (json.data && Array.isArray(json.data.docs)) return json.data.docs;
        if (Array.isArray(json.products)) return json.products;
        if (Array.isArray(json.items)) return json.items;
        if (Array.isArray(json.docs)) return json.docs;
        if (json.result && Array.isArray(json.result)) return json.result;
        return [];
    }

    /**
     * 3. Normalize single product into widget item schema
     */
    function normalizeProduct(p, idx) {
        const id = String(p._id || p.id || p.product_id || p.sku || ('prod_' + (idx + 1)));
        const name = p.title || p.name || p.product_name || p.handle || ('Sản phẩm #' + (idx + 1));
        
        let imageUrl = '';
        if (typeof p.thumbnail === 'string' && p.thumbnail.trim()) imageUrl = p.thumbnail.trim();
        else if (typeof p.image_url === 'string' && p.image_url.trim()) imageUrl = p.image_url.trim();
        else if (typeof p.image === 'string' && p.image.trim()) imageUrl = p.image.trim();
        else if (typeof p.featured_image === 'string' && p.featured_image.trim()) imageUrl = p.featured_image.trim();
        else if (Array.isArray(p.images) && p.images.length > 0) {
            const first = p.images[0];
            imageUrl = typeof first === 'string' ? first : (first?.url || first?.src || '');
        } else if (p.image && typeof p.image === 'object') {
            imageUrl = p.image.url || p.image.src || '';
        }

        let tags = [];
        if (Array.isArray(p.tags)) {
            tags = p.tags.map(t => typeof t === 'string' ? t : (t.name || t.title || ''));
        } else if (typeof p.tags === 'string') {
            tags = p.tags.split(',').map(s => s.trim()).filter(Boolean);
        } else if (p.category) {
            tags = [typeof p.category === 'string' ? p.category : (p.category.name || '')].filter(Boolean);
        }

        return {
            _id: id,
            id: id,
            name: name,
            image_url: imageUrl,
            tags: tags,
            price: p.price || p.regular_price || 0,
            createdAt: p.createdAt || p.created_at || new Date().toISOString(),
            is_used: Boolean(p.is_used),
            is_skipped: Boolean(p.is_skipped),
            prompt: p.prompt || '',
            raw: p
        };
    }

    /**
     * 4. Save to chrome.storage and broadcast to Product Manager store
     */
    function saveAndSyncProducts(normalizedList) {
        // Only accept if list has items with VALID images
        if (!Array.isArray(normalizedList) || normalizedList.length === 0) return;
        const validList = normalizedList.filter(p => p.image_url && p.image_url.length > 5);
        if (validList.length === 0) return;

        console.log(`[16vibe] Đã bắt được ${validList.length} sản phẩm có hình ảnh từ API trang`);

        // Save to chrome.storage.local
        chrome.storage.local.set({
            ecomlap_products: validList,
            last_products_sync: Date.now()
        });

        // Trigger custom event for gemini-content.js listener
        window.dispatchEvent(new CustomEvent('16vibe-sync-products', { detail: validList }));

        // Directly update Zustand store if accessible
        try {
            if (window.__16vibe_store && typeof window.__16vibe_store.setState === 'function') {
                window.__16vibe_store.setState({
                    ideas: validList,
                    stats: {
                        total: validList.length,
                        used: validList.filter(p => p.is_used).length,
                        unused: validList.filter(p => !p.is_used).length
                    },
                    pagination: {
                        current_page: 1,
                        last_page: 1,
                        total: validList.length,
                        limit: validList.length
                    }
                });
            }
        } catch (e) {
            console.warn('[16vibe] Could not update __16vibe_store directly:', e);
        }
    }

    /**
     * 5. Initialize
     */
    function init() {
        injectNetworkHook();

        // Listen for intercepted products from in-page script
        window.addEventListener('16vibe-products-captured', (e) => {
            const detail = e.detail;
            if (detail && detail.products) {
                const list = extractProductList(detail.products);
                if (list.length > 0) {
                    const normalized = list.map(normalizeProduct);
                    saveAndSyncProducts(normalized);
                }
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
