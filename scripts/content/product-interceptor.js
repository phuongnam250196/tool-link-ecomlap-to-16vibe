/**
 * 16vibe Assistant - Product Interceptor & Synchronizer
 * 
 * Captures products from the current page (ecomlap.com / localhost:3000):
 * 1. Injects page script to hook window.fetch & XMLHttpRequest for /api/products
 * 2. Proactively fetches /api/products using active session credentials
 * 3. Scrapes DOM products or reads Next.js state as fallback
 * 4. Normalizes products and updates Zustand store & chrome.storage.local
 */

(function () {
    'use strict';

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
        if (typeof p.thumbnail === 'string') imageUrl = p.thumbnail;
        else if (typeof p.image === 'string') imageUrl = p.image;
        else if (typeof p.featured_image === 'string') imageUrl = p.featured_image;
        else if (Array.isArray(p.images) && p.images.length > 0) {
            imageUrl = typeof p.images[0] === 'string' ? p.images[0] : (p.images[0]?.url || p.images[0]?.src || '');
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
            raw: p
        };
    }

    /**
     * 4. Save to chrome.storage and broadcast to Product Manager store
     */
    function saveAndSyncProducts(normalizedList) {
        if (!Array.isArray(normalizedList) || normalizedList.length === 0) return;

        console.log(`[16vibe] Đồng bộ thành công ${normalizedList.length} sản phẩm từ trang hiện tại`);

        // Save to chrome.storage.local
        chrome.storage.local.set({
            ecomlap_products: normalizedList,
            last_products_sync: Date.now()
        });

        // Trigger custom event for gemini-content.js listener
        window.dispatchEvent(new CustomEvent('16vibe-sync-products', { detail: normalizedList }));

        // Directly update Zustand store if accessible
        try {
            if (window.__16vibe_store && typeof window.__16vibe_store.setState === 'function') {
                window.__16vibe_store.setState({
                    ideas: normalizedList,
                    stats: {
                        total: normalizedList.length,
                        used: normalizedList.filter(p => p.is_used).length,
                        unused: normalizedList.filter(p => !p.is_used).length
                    },
                    pagination: {
                        current_page: 1,
                        last_page: 1,
                        total: normalizedList.length,
                        limit: normalizedList.length
                    }
                });
            }
        } catch (e) {
            console.warn('[16vibe] Could not update __16vibe_store directly:', e);
        }
    }

    /**
     * 5. Active fetch from page /api/products
     */
    async function fetchProductsFromCurrentSite() {
        const origin = window.location.origin;
        const isTargetSite = origin.includes('ecomlap.com') || origin.includes('localhost') || origin.includes('127.0.0.1');
        if (!isTargetSite) return [];

        try {
            const res = await fetch('/api/products', {
                method: 'GET',
                headers: {
                    'Accept': 'application/json'
                },
                credentials: 'include'
            });

            if (res.ok) {
                const json = await res.json();
                const list = extractProductList(json);
                if (list.length > 0) {
                    const normalized = list.map(normalizeProduct);
                    saveAndSyncProducts(normalized);
                    return normalized;
                }
            }
        } catch (e) {
            console.log('[16vibe] Direct fetch /api/products error:', e);
        }

        // Try DOM scraping fallback if network fetch was empty
        const domList = scrapeDomProducts();
        if (domList.length > 0) {
            saveAndSyncProducts(domList);
            return domList;
        }

        return [];
    }

    /**
     * 6. DOM Scraper Fallback (for product tables or grids)
     */
    function scrapeDomProducts() {
        const products = [];
        try {
            // Find product rows in table
            const rows = document.querySelectorAll('table tbody tr');
            if (rows.length > 0) {
                rows.forEach((row, idx) => {
                    const titleEl = row.querySelector('a[href*="/product"], .product-title, .title, td:nth-child(2), td:nth-child(3)');
                    const imgEl = row.querySelector('img');
                    if (titleEl || imgEl) {
                        const title = titleEl ? titleEl.textContent.trim() : `Sản phẩm #${idx + 1}`;
                        const imgSrc = imgEl ? (imgEl.src || imgEl.getAttribute('data-src') || '') : '';
                        const priceEl = row.querySelector('.price, [class*="price"], td:nth-child(4)');
                        const price = priceEl ? priceEl.textContent.trim() : 0;
                        if (title && title.length > 1) {
                            products.push({
                                _id: `dom_${idx + 1}`,
                                id: `dom_${idx + 1}`,
                                name: title,
                                image_url: imgSrc,
                                tags: ['Page'],
                                price: price,
                                createdAt: new Date().toISOString(),
                                is_used: false,
                                is_skipped: false
                            });
                        }
                    }
                });
            }

            // Find product cards in grid
            if (products.length === 0) {
                const cards = document.querySelectorAll('.product-card, .product-item, [data-product-id]');
                cards.forEach((card, idx) => {
                    const titleEl = card.querySelector('.title, .product-title, h3, h4, a');
                    const imgEl = card.querySelector('img');
                    if (titleEl && imgEl) {
                        products.push({
                            _id: card.getAttribute('data-product-id') || `dom_card_${idx + 1}`,
                            id: card.getAttribute('data-product-id') || `dom_card_${idx + 1}`,
                            name: titleEl.textContent.trim(),
                            image_url: imgEl.src || '',
                            tags: ['Page'],
                            price: 0,
                            createdAt: new Date().toISOString(),
                            is_used: false,
                            is_skipped: false
                        });
                    }
                });
            }
        } catch (e) {
            console.warn('[16vibe] DOM scraping error:', e);
        }
        return products;
    }

    /**
     * 7. Initialize
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

        // Expose manual trigger function on window
        window.__16vibe_fetch_products = fetchProductsFromCurrentSite;

        // Proactive fetch after page stabilizes
        setTimeout(() => {
            fetchProductsFromCurrentSite();
        }, 1200);

        // Also check if we have stored products to initialize store
        chrome.storage.local.get(['ecomlap_products'], (res) => {
            if (res && Array.isArray(res.ecomlap_products) && res.ecomlap_products.length > 0) {
                setTimeout(() => {
                    window.dispatchEvent(new CustomEvent('16vibe-sync-products', { detail: res.ecomlap_products }));
                }, 500);
            }
        });

        // Listen for messages from background/popup
        chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
            if (msg.action === 'syncProductsFromPage') {
                fetchProductsFromCurrentSite().then(prods => {
                    sendResponse({ success: !0, count: prods.length });
                });
                return true;
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
