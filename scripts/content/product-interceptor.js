/**
 * 16vibe Assistant - Product Interceptor & Synchronizer
 * 
 * Intercepts products from ecomlap.com / localhost:3000:
 * 1. Prioritizes main_image_url for product images
 * 2. Accurately tracks category API queries (e.g. /api/products?page=1&limit=30&sort_name=createdAt&sort_target=desc&category=...&with_total=true)
 * 3. Intercepts in-page fetch/XHR network requests at document_start
 * 4. Resolves all image URLs to absolute HTTPS URLs
 * 5. Broadcasts to Zustand store and persists to chrome.storage.local
 */

(function () {
    'use strict';

    /**
     * Resolve any image URL (relative, protocol-relative, absolute) to full URL
     */
    function resolveUrl(url) {
        if (!url || typeof url !== 'string') return '';
        url = url.trim();
        if (!url) return '';
        if (url.startsWith('data:') || url.startsWith('blob:')) return url;
        if (url.startsWith('//')) return 'https:' + url;
        if (url.startsWith('http://') || url.startsWith('https://')) return url;

        const base = typeof window !== 'undefined' && window.location && window.location.origin && !window.location.origin.startsWith('chrome-extension')
            ? window.location.origin
            : 'https://ecomlap.com';

        if (url.startsWith('/')) {
            return base + url;
        }
        return base + '/' + url;
    }

    /**
     * Extract best available image URL from product object (Prioritizes main_image_url)
     */
    function extractProductImage(p) {
        if (!p || typeof p !== 'object') return '';

        // 1. Direct image properties - Priority to main_image_url as requested
        const candidates = [
            p.main_image_url,
            p.main_image,
            p.mainImageUrl,
            p.mainImage,
            p.image_url,
            p.imageUrl,
            p.thumbnail,
            p.image,
            p.featured_image,
            p.featuredImage,
            p.photo,
            p.picture,
            p.img,
            p.src,
            p.url,
            p.preview_image
        ];
        for (const item of candidates) {
            if (typeof item === 'string' && item.trim()) {
                const resolved = resolveUrl(item.trim());
                if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD')) return resolved;
            }
            if (item && typeof item === 'object') {
                const nested = item.main_image_url || item.url || item.src || item.file_url || item.path || item.thumbnail;
                if (typeof nested === 'string' && nested.trim()) {
                    const resolved = resolveUrl(nested.trim());
                    if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD')) return resolved;
                }
            }
        }

        // 2. Array properties: images, media, photos, gallery
        const arrays = [p.images, p.media, p.photos, p.pictures, p.gallery, p.image_urls];
        for (const arr of arrays) {
            if (Array.isArray(arr) && arr.length > 0) {
                for (const item of arr) {
                    if (typeof item === 'string' && item.trim()) {
                        const resolved = resolveUrl(item.trim());
                        if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD')) return resolved;
                    }
                    if (item && typeof item === 'object') {
                        const nested = item.main_image_url || item.url || item.src || item.file_url || item.path;
                        if (typeof nested === 'string' && nested.trim()) {
                            const resolved = resolveUrl(nested.trim());
                            if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD')) return resolved;
                        }
                    }
                }
            }
        }

        // 3. Variants
        if (Array.isArray(p.variants) && p.variants.length > 0) {
            for (const v of p.variants) {
                const vImg = extractProductImage(v);
                if (vImg) return vImg;
            }
        }

        return '';
    }

    /**
     * Extract rich, clean tags from product (Category, Price, SKU, Status, User tags)
     */
    function extractProductTags(p) {
        if (!p || typeof p !== 'object') return [];
        let tags = [];

        // Category
        if (p.category) {
            if (typeof p.category === 'string') tags.push(p.category);
            else if (p.category.name) tags.push(p.category.name);
            else if (p.category.title) tags.push(p.category.title);
        }
        if (p.category_name && typeof p.category_name === 'string') {
            tags.push(p.category_name);
        }
        if (Array.isArray(p.categories)) {
            p.categories.forEach(c => {
                if (typeof c === 'string') tags.push(c);
                else if (c && c.name) tags.push(c.name);
                else if (c && c.title) tags.push(c.title);
            });
        }

        // Price
        if (p.price != null && p.price !== '') {
            const priceStr = typeof p.price === 'number' ? `$${p.price.toFixed(2)}` : `${p.price}`;
            tags.push(priceStr);
        } else if (p.regular_price != null && p.regular_price !== '') {
            const priceStr = typeof p.regular_price === 'number' ? `$${p.regular_price.toFixed(2)}` : `${p.regular_price}`;
            tags.push(priceStr);
        }

        // SKU
        if (p.sku) {
            tags.push(`SKU: ${p.sku}`);
        }

        // Real tags
        if (Array.isArray(p.tags)) {
            p.tags.forEach(t => {
                if (typeof t === 'string') tags.push(t);
                else if (t && (t.name || t.value || t.tag || t.title)) {
                    tags.push(t.name || t.value || t.tag || t.title);
                }
            });
        } else if (typeof p.tags === 'string' && p.tags.trim()) {
            tags = tags.concat(p.tags.split(',').map(s => s.trim()).filter(Boolean));
        }

        // Deduplicate and filter out empty / generic tags
        const unique = [];
        tags.forEach(t => {
            const clean = String(t).trim();
            if (clean && clean !== 'Page' && !unique.includes(clean)) {
                unique.push(clean);
            }
        });

        return unique.length > 0 ? unique : ['Product'];
    }

    /**
     * Normalize single product into widget schema
     */
    function normalizeProduct(p, idx) {
        const id = String(p._id || p.id || p.product_id || p.sku || ('prod_' + (idx + 1)));
        const name = p.title || p.name || p.product_name || p.productTitle || p.handle || ('Sản phẩm #' + (idx + 1));
        
        // Priority to main_image_url
        const rawImg = p.main_image_url || p.main_image || p.mainImageUrl || p.mainImage || extractProductImage(p);
        const imageUrl = resolveUrl(rawImg);
        const tags = extractProductTags(p);

        // Date resolution
        let dateStr = new Date().toISOString();
        if (p.createdAt || p.created_at || p.date || p.updatedAt) {
            const parsed = new Date(p.createdAt || p.created_at || p.date || p.updatedAt);
            if (!isNaN(parsed.getTime())) {
                dateStr = parsed.toISOString();
            }
        }

        return {
            _id: id,
            id: id,
            name: name,
            image_url: imageUrl,
            main_image_url: imageUrl,
            tags: tags,
            price: p.price != null ? p.price : (p.regular_price || 0),
            createdAt: dateStr,
            is_used: Boolean(p.is_used),
            is_skipped: Boolean(p.is_skipped),
            prompt: p.prompt || p.description || name,
            raw: p
        };
    }

    /**
     * Extract product array from various response formats
     */
    function extractProductList(json) {
        if (!json) return [];
        if (Array.isArray(json)) return json;
        if (json.data) {
            if (Array.isArray(json.data)) return json.data;
            if (Array.isArray(json.data.products)) return json.data.products;
            if (Array.isArray(json.data.items)) return json.data.items;
            if (Array.isArray(json.data.docs)) return json.data.docs;
            if (Array.isArray(json.data.list)) return json.data.list;
            if (Array.isArray(json.data.results)) return json.data.results;
            if (Array.isArray(json.data.data)) return json.data.data;
            if (Array.isArray(json.data.rows)) return json.data.rows;
        }
        if (Array.isArray(json.products)) return json.products;
        if (Array.isArray(json.items)) return json.items;
        if (Array.isArray(json.docs)) return json.docs;
        if (Array.isArray(json.result)) return json.result;
        if (Array.isArray(json.list)) return json.list;
        if (Array.isArray(json.rows)) return json.rows;
        return [];
    }

    /**
     * Save to chrome.storage and broadcast to Product Manager store
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
     * Detect category ID from current page URL, query params, or DOM
     */
    function detectCategoryFromPage() {
        try {
            // 1. URL search params (e.g. ?category=6a53cad5edb60a74ce6a0f0e)
            const searchParams = new URLSearchParams(window.location.search);
            if (searchParams.get('category')) return searchParams.get('category');
            if (searchParams.get('categoryId')) return searchParams.get('categoryId');
            if (searchParams.get('category_id')) return searchParams.get('category_id');
            if (searchParams.get('cat')) return searchParams.get('cat');

            // 2. Pathname (e.g. /category/6a53cad5edb60a74ce6a0f0e or /categories/6a53cad5edb60a74ce6a0f0e)
            const path = window.location.pathname;
            const catMatch = path.match(/\/(?:category|categories|danh-muc|collection|collections)\/([a-f0-9]{24}|[a-zA-Z0-9_-]+)/i);
            if (catMatch && catMatch[1]) return catMatch[1];

            // 3. Match 24-character hex MongoDB ObjectId anywhere in path
            const mongoIdMatch = path.match(/\/([a-f0-9]{24})(?:\/|$)/i);
            if (mongoIdMatch && mongoIdMatch[1]) return mongoIdMatch[1];

            // 4. Hash params (e.g. #category=... or #/category/...)
            const hash = window.location.hash;
            if (hash) {
                const hashParams = new URLSearchParams(hash.replace(/^[#/?]+/, ''));
                if (hashParams.get('category')) return hashParams.get('category');
                const hashMatch = hash.match(/(?:category|categories)\/([a-f0-9]{24}|[a-zA-Z0-9_-]+)/i);
                if (hashMatch && hashMatch[1]) return hashMatch[1];
            }

            // 5. Next.js state if present
            if (window.__NEXT_DATA__ && window.__NEXT_DATA__.query) {
                const q = window.__NEXT_DATA__.query;
                if (q.category) return q.category;
                if (q.id && /^[a-f0-9]{24}$/i.test(q.id)) return q.id;
            }

            // 6. Active category element in DOM
            const activeEl = document.querySelector('[data-category-id], [data-category], .active[data-id], .category-active');
            if (activeEl) {
                const cid = activeEl.getAttribute('data-category-id') || activeEl.getAttribute('data-category') || activeEl.getAttribute('data-id');
                if (cid) return cid;
            }
        } catch (e) {}

        return null;
    }

    /**
     * Look up the most recent URL called by the page matching /api/products
     */
    function findRecentProductsApiUrl() {
        try {
            if (typeof performance !== 'undefined' && typeof performance.getEntriesByType === 'function') {
                const entries = performance.getEntriesByType('resource');
                for (let i = entries.length - 1; i >= 0; i--) {
                    const name = entries[i].name;
                    if (name && (name.includes('/api/products') || name.includes('ecomlap.com/api/products'))) {
                        return name;
                    }
                }
            }
        } catch (e) {}
        return null;
    }

    /**
     * DOM Scraper fallback with high-fidelity image resolution
     */
    function scrapeDomProducts() {
        const products = [];
        try {
            function getImageSrc(el) {
                if (!el) return '';
                const img = el.querySelector('img') || (el.tagName === 'IMG' ? el : null);
                if (img) {
                    const src = img.currentSrc || img.src || img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('data-lazy-src') || '';
                    if (src && !src.includes('data:image/gif;base64,R0lGOD')) {
                        return resolveUrl(src);
                    }
                    const srcset = img.getAttribute('srcset');
                    if (srcset) {
                        const parts = srcset.split(',').map(s => s.trim().split(' ')[0]);
                        if (parts.length > 0 && parts[0]) return resolveUrl(parts[0]);
                    }
                }
                const bgEl = el.querySelector('[style*="background-image"]') || (el.style && el.style.backgroundImage ? el : null);
                if (bgEl && bgEl.style && bgEl.style.backgroundImage) {
                    const match = bgEl.style.backgroundImage.match(/url\(['"]?(.*?)['"]?\)/);
                    if (match && match[1]) return resolveUrl(match[1]);
                }
                return '';
            }

            // 1. Scan table rows
            const rows = document.querySelectorAll('table tbody tr');
            if (rows.length > 0) {
                rows.forEach((row, idx) => {
                    const titleEl = row.querySelector('a[href*="/product"], .product-title, .title, td:nth-child(2), td:nth-child(3)');
                    const title = titleEl ? titleEl.textContent.trim() : '';
                    const imgSrc = getImageSrc(row);
                    const priceEl = row.querySelector('.price, [class*="price"], td:nth-child(4), td:nth-child(5)');
                    const price = priceEl ? priceEl.textContent.trim() : '';
                    const skuEl = row.querySelector('.sku, [class*="sku"]');
                    const sku = skuEl ? skuEl.textContent.trim() : '';

                    if (title && title.length > 1 && !title.toLowerCase().includes('select all')) {
                        const tags = [];
                        if (price) tags.push(price);
                        if (sku) tags.push(`SKU: ${sku}`);
                        if (tags.length === 0) tags.push('Product');

                        products.push({
                            _id: `dom_${idx + 1}`,
                            id: `dom_${idx + 1}`,
                            name: title,
                            image_url: imgSrc,
                            main_image_url: imgSrc,
                            tags: tags,
                            price: price,
                            createdAt: new Date().toISOString(),
                            is_used: false,
                            is_skipped: false,
                            prompt: title
                        });
                    }
                });
            }

            // 2. Scan product cards / grid
            if (products.length === 0) {
                const cards = document.querySelectorAll('.product-card, .product-item, [data-product], [data-product-id]');
                cards.forEach((card, idx) => {
                    const titleEl = card.querySelector('.title, .product-title, h3, h4, h5, a');
                    const title = titleEl ? titleEl.textContent.trim() : '';
                    const imgSrc = getImageSrc(card);
                    const priceEl = card.querySelector('.price, [class*="price"]');
                    const price = priceEl ? priceEl.textContent.trim() : '';

                    if (title && title.length > 1) {
                        const tags = [];
                        if (price) tags.push(price);
                        if (tags.length === 0) tags.push('Product');

                        products.push({
                            _id: card.getAttribute('data-product-id') || `card_${idx + 1}`,
                            id: card.getAttribute('data-product-id') || `card_${idx + 1}`,
                            name: title,
                            image_url: imgSrc,
                            main_image_url: imgSrc,
                            tags: tags,
                            price: price,
                            createdAt: new Date().toISOString(),
                            is_used: false,
                            is_skipped: false,
                            prompt: title
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
     * Active fetch from current site with exact parameters
     */
    async function fetchProductsFromCurrentSite() {
        const origin = window.location.origin;
        const isTargetSite = origin.includes('ecomlap.com') || origin.includes('localhost') || origin.includes('127.0.0.1');
        if (!isTargetSite) return [];

        // 1. Try to use the exact URL that the page recently requested
        let targetUrl = findRecentProductsApiUrl();

        // 2. If not found in resource timings, build query matching ecomlap specification
        if (!targetUrl) {
            const category = detectCategoryFromPage();
            const params = new URLSearchParams({
                page: '1',
                limit: '30',
                sort_name: 'createdAt',
                sort_target: 'desc',
                with_total: 'true'
            });
            if (category) {
                params.set('category', category);
            }
            targetUrl = `/api/products?${params.toString()}`;
        }

        console.log('[16vibe] Đang lấy danh sách sản phẩm từ URL:', targetUrl);

        try {
            const res = await fetch(targetUrl, {
                method: 'GET',
                headers: { 'Accept': 'application/json' },
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
            } else {
                console.warn('[16vibe] API fetch returned status:', res.status);
            }
        } catch (e) {
            console.warn('[16vibe] Error fetching products:', e);
        }

        // Fallback to Next.js hydrated state if available
        try {
            if (window.__NEXT_DATA__ && window.__NEXT_DATA__.props && window.__NEXT_DATA__.props.pageProps) {
                const pp = window.__NEXT_DATA__.props.pageProps;
                const nextList = pp.products || pp.items || (pp.data && pp.data.products);
                if (Array.isArray(nextList) && nextList.length > 0) {
                    const normalized = nextList.map(normalizeProduct);
                    saveAndSyncProducts(normalized);
                    return normalized;
                }
            }
        } catch (e) {}

        // Fallback to high-fidelity DOM scraper
        const domList = scrapeDomProducts();
        if (domList.length > 0) {
            saveAndSyncProducts(domList);
            return domList;
        }

        return [];
    }

    /**
     * Inject In-Page Network Interceptor into page context
     */
    function injectNetworkHook() {
        if (window.__16vibe_network_hook_injected) return;
        window.__16vibe_network_hook_injected = true;

        try {
            const script = document.createElement('script');
            script.textContent = `
                (function() {
                    if (window.__16vibe_hook_installed) return;
                    window.__16vibe_hook_installed = true;

                    const TARGET_PATH = '/api/products';
                    const TARGET_FULL = 'ecomlap.com/api/products';

                    function isTarget(url) {
                        if (!url) return false;
                        const str = typeof url === 'string' ? url : (url.href || url.url || String(url));
                        return str.includes(TARGET_PATH) || str.includes(TARGET_FULL);
                    }

                    // Monkey-patch window.fetch
                    const originalFetch = window.fetch;
                    window.fetch = async function(...args) {
                        const input = args[0];
                        let url = '';
                        if (typeof input === 'string') {
                            url = input;
                        } else if (input && typeof input === 'object') {
                            url = input.url || input.href || String(input);
                        }

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
                })();
            `;
            const parent = document.head || document.documentElement;
            if (parent) {
                parent.appendChild(script);
                script.remove();
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    (document.head || document.documentElement).appendChild(script);
                    script.remove();
                });
            }
        } catch (e) {
            console.warn('[16vibe] Could not inject network hook:', e);
        }
    }

    /**
     * Initialize
     */
    function init() {
        injectNetworkHook();

        // Listen for intercepted products from in-page script
        window.addEventListener('16vibe-products-captured', (e) => {
            const detail = e.detail;
            if (detail && detail.products) {
                const list = extractProductList(detail.products);
                if (list.length > 0) {
                    console.log(`[16vibe] Bắt được ${list.length} sản phẩm từ mạng:`, detail.url);
                    const normalized = list.map(normalizeProduct);
                    saveAndSyncProducts(normalized);
                }
            }
        });

        // Listen for SPA route changes
        window.addEventListener('16vibe-route-changed', () => {
            setTimeout(fetchProductsFromCurrentSite, 400);
        });
        window.addEventListener('popstate', () => {
            setTimeout(fetchProductsFromCurrentSite, 400);
        });

        // Expose manual trigger function on window
        window.__16vibe_fetch_products = fetchProductsFromCurrentSite;

        // Proactive sync on target page after load
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
                    sendResponse({ success: true, count: prods.length });
                });
                return true;
            }
        });
    }

    // Run network hook injection immediately at document_start
    injectNetworkHook();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
