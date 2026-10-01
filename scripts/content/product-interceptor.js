/**
 * 16vibe Assistant - Product Interceptor & Synchronizer
 * 
 * Intercepts products from ecomlap.com / localhost:3000:
 * 1. Prioritizes main_image_url for product images
 * 2. Captures authentication headers/tokens to reliably fetch all items (including 100+ per page)
 * 3. Never overwrites valid image URLs with empty DOM-scraped placeholders
 * 4. Resolves all image URLs to absolute HTTPS URLs
 * 5. Broadcasts to Zustand store and persists to chrome.storage.local
 */

(function () {
    'use strict';

    // Global in-memory cache of valid product images
    const imageCache = new Map(); // id or name -> valid imageUrl

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
                if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD') && !resolved.includes('placeholder')) return resolved;
            }
            if (item && typeof item === 'object') {
                const nested = item.main_image_url || item.url || item.src || item.file_url || item.path || item.thumbnail;
                if (typeof nested === 'string' && nested.trim()) {
                    const resolved = resolveUrl(nested.trim());
                    if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD') && !resolved.includes('placeholder')) return resolved;
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
                        if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD') && !resolved.includes('placeholder')) return resolved;
                    }
                    if (item && typeof item === 'object') {
                        const nested = item.main_image_url || item.url || item.src || item.file_url || item.path;
                        if (typeof nested === 'string' && nested.trim()) {
                            const resolved = resolveUrl(nested.trim());
                            if (resolved && !resolved.includes('data:image/gif;base64,R0lGOD') && !resolved.includes('placeholder')) return resolved;
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
        let imageUrl = resolveUrl(rawImg);

        // Fallback to cache if image is missing/empty
        if (!imageUrl || imageUrl.includes('placeholder')) {
            const cached = imageCache.get(id) || imageCache.get(name);
            if (cached) {
                imageUrl = cached;
            }
        } else {
            // Save valid image into cache
            imageCache.set(id, imageUrl);
            imageCache.set(name, imageUrl);
        }

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
    function saveAndSyncProducts(normalizedList, allowEmpty) {
        if (!Array.isArray(normalizedList)) return;
        if (normalizedList.length === 0 && !allowEmpty) return;

        // Populate image cache
        normalizedList.forEach(p => {
            if (p.main_image_url && !p.main_image_url.includes('placeholder')) {
                imageCache.set(p._id, p.main_image_url);
                imageCache.set(p.name, p.main_image_url);
            }
        });

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
     * Get Authentication Headers (captured from network hook or localStorage)
     */
    function getAuthHeaders() {
        const headers = {
            'Accept': 'application/json'
        };

        // 1. From captured hook
        if (window.__16vibe_auth_token) {
            const token = window.__16vibe_auth_token;
            headers['Authorization'] = token.startsWith('Bearer ') ? token : 'Bearer ' + token;
            return headers;
        }

        // 2. From localStorage / sessionStorage
        try {
            const tokenKeys = ['token', 'auth_token', 'accessToken', 'access_token', 'jwt', 'hmt-token', 'user_token'];
            for (const k of tokenKeys) {
                const val = localStorage.getItem(k) || sessionStorage.getItem(k);
                if (val && typeof val === 'string' && val.length > 15) {
                    headers['Authorization'] = val.startsWith('Bearer ') ? val : 'Bearer ' + val;
                    return headers;
                }
            }
            for (let i = 0; i < localStorage.length; i++) {
                const key = localStorage.key(i);
                const val = localStorage.getItem(key);
                if (val && val.startsWith('{') && val.includes('token')) {
                    try {
                        const parsed = JSON.parse(val);
                        const t = parsed.token || parsed.accessToken || parsed.access_token || (parsed.user && parsed.user.token);
                        if (t && typeof t === 'string' && t.length > 15) {
                            headers['Authorization'] = t.startsWith('Bearer ') ? t : 'Bearer ' + t;
                            return headers;
                        }
                    } catch (e) {}
                }
            }
        } catch (e) {}

        return headers;
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
     * Check if a URL strictly targets the product list API (excludes /ai-status, /status, etc.)
     */
    function isProductListUrl(url) {
        if (!url) return false;
        const str = typeof url === 'string' ? url : (url.href || url.url || String(url));
        if (str.includes('/ai-status') || str.includes('/status') || str.includes('/analytics')) return false;
        try {
            const base = typeof window !== 'undefined' && window.location ? window.location.origin : 'https://ecomlap.com';
            const u = new URL(str, base);
            const cleanPath = u.pathname.replace(/\/+$/, '');
            return cleanPath === '/api/products';
        } catch (e) {
            return /\/api\/products(?:\/)?(?:\?|#|$)/.test(str);
        }
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
                    if (name && isProductListUrl(name)) {
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
                    const candidates = [
                        img.getAttribute('data-src'),
                        img.getAttribute('data-original'),
                        img.getAttribute('data-lazy-src'),
                        img.getAttribute('data-lazy'),
                        img.getAttribute('data-url'),
                        img.getAttribute('data-image'),
                        img.getAttribute('data-img'),
                        img.currentSrc,
                        img.src
                    ];
                    for (const c of candidates) {
                        if (c && typeof c === 'string' && c.trim()) {
                            const s = c.trim();
                            if (!s.includes('data:image/gif;base64,R0lGOD') && !s.includes('placeholder')) {
                                return resolveUrl(s);
                            }
                        }
                    }
                    const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
                    if (srcset) {
                        const parts = srcset.split(',').map(s => s.trim().split(' ')[0]);
                        for (const p of parts) {
                            if (p && !p.includes('data:image/gif;base64,R0lGOD') && !p.includes('placeholder')) {
                                return resolveUrl(p);
                            }
                        }
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
                    let imgSrc = getImageSrc(row);
                    const priceEl = row.querySelector('.price, [class*="price"], td:nth-child(4), td:nth-child(5)');
                    const price = priceEl ? priceEl.textContent.trim() : '';
                    const skuEl = row.querySelector('.sku, [class*="sku"]');
                    const sku = skuEl ? skuEl.textContent.trim() : '';

                    if (title && title.length > 1 && !title.toLowerCase().includes('select all')) {
                        const tags = [];
                        if (price) tags.push(price);
                        if (sku) tags.push(`SKU: ${sku}`);
                        if (tags.length === 0) tags.push('Product');

                        const id = row.getAttribute('data-id') || row.getAttribute('data-product-id') || `dom_${idx + 1}`;
                        
                        // Check if we have cached image for this product
                        if (!imgSrc && (imageCache.has(id) || imageCache.has(title))) {
                            imgSrc = imageCache.get(id) || imageCache.get(title);
                        }

                        products.push({
                            _id: id,
                            id: id,
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
                    let imgSrc = getImageSrc(card);
                    const priceEl = card.querySelector('.price, [class*="price"]');
                    const price = priceEl ? priceEl.textContent.trim() : '';

                    if (title && title.length > 1) {
                        const tags = [];
                        if (price) tags.push(price);
                        if (tags.length === 0) tags.push('Product');

                        const id = card.getAttribute('data-product-id') || card.getAttribute('data-id') || `card_${idx + 1}`;
                        if (!imgSrc && (imageCache.has(id) || imageCache.has(title))) {
                            imgSrc = imageCache.get(id) || imageCache.get(title);
                        }

                        products.push({
                            _id: id,
                            id: id,
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

        // 2. If not found in resource timings, build query matching current page filters
        if (!targetUrl) {
            const urlParams = new URLSearchParams(window.location.search);
            const category = detectCategoryFromPage();
            const params = new URLSearchParams({
                page: urlParams.get('page') || '1',
                limit: urlParams.get('limit') || '30',
                sort_name: urlParams.get('sort_name') || 'createdAt',
                sort_target: urlParams.get('sort_target') || 'desc',
                with_total: 'true'
            });
            if (category) {
                params.set('category', category);
            }
            const search = urlParams.get('search') || urlParams.get('q') || urlParams.get('keyword');
            if (search) {
                params.set('search', search);
            }
            // Check active search input in DOM
            try {
                const searchInput = document.querySelector('input[type="search"], input[name="search"], input[name="q"], input[placeholder*="Tìm"], input[placeholder*="search" i]');
                if (searchInput && searchInput.value && searchInput.value.trim() && !params.has('search')) {
                    params.set('search', searchInput.value.trim());
                }
            } catch (e) {}

            targetUrl = `/api/products?${params.toString()}`;
        }

        console.log('[16vibe] Đang lấy danh sách sản phẩm từ URL:', targetUrl);

        try {
            const headers = getAuthHeaders();
            const res = await fetch(targetUrl, {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });

            if (res.ok) {
                const json = await res.json();
                const list = extractProductList(json);
                const normalized = list.map(normalizeProduct);
                saveAndSyncProducts(normalized, true);
                return normalized;
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
                    saveAndSyncProducts(normalized, true);
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

                    // Listen for personalization config requests from extension
                    window.addEventListener('16vibe-fetch-personalization', async function() {
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
                                window.dispatchEvent(new CustomEvent('16vibe-personalization-response', { detail: { success: true, data: data } }));
                            } else {
                                const errTxt = await res.text().catch(function() { return ''; });
                                console.warn('[16vibe in-page] Personalization HTTP error:', res.status, errTxt);
                                window.dispatchEvent(new CustomEvent('16vibe-personalization-response', { detail: { success: false, status: res.status, error: errTxt } }));
                            }
                        } catch(err) {
                            console.error('[16vibe in-page] Personalization fetch failed:', err);
                            window.dispatchEvent(new CustomEvent('16vibe-personalization-response', { detail: { success: false, error: err.message } }));
                        }
                    });
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
                console.log(`[16vibe] Bắt được ${list.length} sản phẩm từ mạng:`, detail.url);
                const normalized = list.map(normalizeProduct);
                saveAndSyncProducts(normalized, true);
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
        window.__16vibe_getAuthHeaders = getAuthHeaders;

        // Proactive sync on target page after load
        setTimeout(() => {
            fetchProductsFromCurrentSite();
        }, 1200);

        // Also check if we have stored products to initialize store
        chrome.storage.local.get(['ecomlap_products'], (res) => {
            if (res && Array.isArray(res.ecomlap_products) && res.ecomlap_products.length > 0) {
                // Populate imageCache from stored items
                res.ecomlap_products.forEach(p => {
                    if (p.main_image_url && !p.main_image_url.includes('placeholder')) {
                        imageCache.set(p._id, p.main_image_url);
                        imageCache.set(p.name, p.main_image_url);
                    }
                });
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
