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

    if (typeof window !== 'undefined' && window.location && window.location.hostname && !window.location.hostname.includes('ecomlap.com')) {
        return;
    }

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
     * Accurately extract the true product name from all possible Ecomlap properties
     */
    function extractProductName(p, idx) {
        if (!p) return 'Sản phẩm #' + ((idx || 0) + 1);
        if (typeof p === 'string' && p.trim()) return p.trim();

        const raw = (p && typeof p.raw === 'object' && p.raw) ? p.raw : {};
        const candidates = [
            p.item_name,
            p.itemName,
            p.product_name,
            p.productName,
            p.name,
            p.title,
            p.product_title,
            p.productTitle,
            raw.item_name,
            raw.itemName,
            raw.product_name,
            raw.productName,
            raw.name,
            raw.title,
            raw.product_title,
            raw.productTitle,
            p.design_name,
            p.design_title,
            p.prompt,
            p.handle
        ];

        for (const c of candidates) {
            if (typeof c === 'string' && c.trim()) {
                const clean = c.trim();
                // Filter out placeholder names if real names exist
                if (!/^untitled|không tên|product$|^sản phẩm #\d+$/i.test(clean)) {
                    return clean;
                }
            }
        }

        for (const c of candidates) {
            if (typeof c === 'string' && c.trim()) {
                return c.trim();
            }
        }

        return 'Sản phẩm #' + ((idx || 0) + 1);
    }

    /**
     * Normalize single product into widget schema
     */
    function normalizeProduct(p, idx) {
        const id = String(p._id || p.id || p.product_id || p.sku || ('prod_' + (idx + 1)));
        const name = extractProductName(p, idx);
        
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
            title: name,
            item_name: name,
            product_name: name,
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
                const pageInfo = detectEcomlapPageInfo();
                const totalCount = pageInfo.totalItems || normalizedList.length;
                const totalPages = Math.max(pageInfo.totalPages, pageInfo.currentPage, 1);

                window.__16vibe_store.setState({
                    ideas: normalizedList,
                    stats: {
                        total: totalCount,
                        used: normalizedList.filter(p => p.is_used).length,
                        unused: normalizedList.filter(p => !p.is_used).length
                    },
                    pagination: {
                        current_page: pageInfo.currentPage,
                        last_page: totalPages,
                        total: totalCount,
                        limit: normalizedList.length || 20
                    }
                });
            }
        } catch (e) {
            console.warn('[16vibe] Could not update __16vibe_store directly:', e);
        }

        // Render / refresh Product Manager pagination controls
        try {
            renderProductManagerPagination();
        } catch (e) {}
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
                    const title = extractTitleFromRow(row);
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

                        const id = row.getAttribute('data-id') || row.getAttribute('data-product-id') || (sku ? `dom_${sku}` : `dom_${idx + 1}`);
                        
                        // Check if we have cached image for this product
                        if (!imgSrc && (imageCache.has(id) || imageCache.has(title))) {
                            imgSrc = imageCache.get(id) || imageCache.get(title);
                        }

                        products.push({
                            _id: id,
                            id: id,
                            name: title,
                            title: title,
                            item_name: title,
                            product_name: title,
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
                    const title = extractTitleFromRow(card);
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
                            title: title,
                            item_name: title,
                            product_name: title,
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

        // In MV3, in-page-interceptor.js runs natively in MAIN world via manifest.json
        // without inline script tags, preventing any CSP unsafe-inline violation.
        // As a fallback for older environments, inject via script.src (never inline textContent).
        try {
            if (document.documentElement.getAttribute('data-16vibe-hook') === 'ready') {
                return;
            }
            const script = document.createElement('script');
            script.src = chrome.runtime.getURL('scripts/content/in-page-interceptor.js');
            script.onload = function() {
                this.remove();
            };
            const parent = document.head || document.documentElement;
            if (parent) {
                parent.appendChild(script);
            } else {
                document.addEventListener('DOMContentLoaded', () => {
                    (document.head || document.documentElement).appendChild(script);
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
        chrome.storage.local.get(['ecomlap_products', 'linked_products_map'], (res) => {
            if (res && res.linked_products_map) {
                cachedLinkedMap = res.linked_products_map;
                renderLinkedBadgesAcrossPage(cachedLinkedMap);
            }
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
            if (msg.action === '16vibe_products_linked_updated') {
                if (msg.data && msg.data.linkedMap) {
                    cachedLinkedMap = msg.data.linkedMap;
                    renderLinkedBadgesAcrossPage(cachedLinkedMap);
                }
            }
        });

        // Listen for local custom events when products linked
        chrome.storage.onChanged.addListener((changes, area) => {
            if (area === 'local' && changes.linked_products_map) {
                cachedLinkedMap = changes.linked_products_map.newValue || {};
                renderLinkedBadgesAcrossPage(cachedLinkedMap);
            }
        });

        window.addEventListener('16vibe-products-linked-local', (e) => {
            if (e.detail && e.detail.linkedMap) {
                cachedLinkedMap = e.detail.linkedMap;
                renderLinkedBadgesAcrossPage(cachedLinkedMap);
            }
        });

        // Set up mutation observer to maintain badges during dynamic SPA render
        setupBadgeMutationObserver();
    }

    let cachedLinkedMap = {};
    let badgeObserver = null;
    let badgeDebounceTimer = null;

    function normalizeImageUrl(url) {
        if (!url || typeof url !== 'string') return '';
        try {
            return url.split('?')[0].split('#')[0].trim();
        } catch(e) {
            return url.trim();
        }
    }

    function isItemLinked(id, title, imgUrl, map) {
        if (!map || typeof map !== 'object') return false;

        // 1. Direct ID / SKU match
        if (id) {
            const strId = String(id).trim();
            // A known ID must not inherit another product's badge via shared images/title.
            return Boolean(map[strId]);
        }

        // 2. Image URL match (exact, clean, or by unique filename)
        if (imgUrl) {
            const rawUrl = String(imgUrl).trim();
            if (map[rawUrl]) return true;

            const cleanUrl = normalizeImageUrl(rawUrl);
            if (cleanUrl) {
                if (map[cleanUrl]) return true;
                const fn = cleanUrl.split('/').pop();
                if (fn && fn.length > 5 && map['fn:' + fn]) return true;
            }
        }

        // 3. Title match (case-insensitive)
        if (title) {
            const cleanTitle = String(title).toLowerCase().trim();
            if (cleanTitle && map['name:' + cleanTitle]) return true;
        }

        return false;
    }

    function createBadgeElement(titleText) {
        const badge = document.createElement('div');
        badge.className = 'vibe-linked-badge';
        badge.title = titleText || 'Đã liên kết với 16vibe';
        badge.setAttribute('data-vibe-badge', 'true');
        badge.style.cssText = `
            position: absolute !important;
            top: 4px !important;
            right: 4px !important;
            width: 22px !important;
            height: 22px !important;
            background: linear-gradient(135deg, #10b981 0%, #059669 100%) !important;
            color: #ffffff !important;
            border-radius: 50% !important;
            border: 2px solid #ffffff !important;
            box-shadow: 0 2px 6px rgba(0, 0, 0, 0.4) !important;
            display: flex !important;
            align-items: center !important;
            justify-content: center !important;
            z-index: 99999 !important;
            cursor: default !important;
            pointer-events: auto !important;
        `;
        badge.innerHTML = `
            <svg viewBox="0 0 24 24" style="width: 12px !important; height: 12px !important; fill: none !important; stroke: #ffffff !important; stroke-width: 3 !important; stroke-linecap: round !important; stroke-linejoin: round !important; display: block !important;">
                <polyline points="20 6 9 17 4 12"></polyline>
            </svg>
        `;
        return badge;
    }

    function extractTitleFromRow(container) {
        if (!container) return '';

        // 1. Check explicit title and name selectors
        const explicitSelectors = [
            '[data-field="item_name"]',
            '[data-field="product_name"]',
            '[data-field="name"]',
            '[data-field="title"]',
            '.item-name',
            '.product-name',
            '.item-title',
            '.product-title',
            '[class*="item-name"]',
            '[class*="product-name"]',
            '[class*="item_name"]',
            '[class*="product_name"]',
            '[class*="itemTitle"]',
            '[class*="productTitle"]',
            'a[href*="/product/"]',
            'a[href*="/products/"]',
            'a[href*="/item/"]',
            'a[href*="/items/"]'
        ];

        for (const sel of explicitSelectors) {
            const el = container.querySelector(sel);
            if (el) {
                const txt = el.textContent.trim();
                if (txt && txt.length > 2 && !/^(select all|chọn tất cả|hành động|action|sửa|xóa|view|edit)$/i.test(txt)) {
                    return txt;
                }
            }
        }

        // 2. Scan all cells if table row
        const cells = Array.from(container.querySelectorAll('td, th'));
        if (cells.length > 0) {
            const candidates = [];
            cells.forEach((td, cIdx) => {
                if (td.querySelector('input[type="checkbox"]')) return;
                const hasImg = td.querySelector('img');
                const txt = td.textContent.trim();
                if (hasImg && txt.length < 3) return;

                if (/^(\$|₫|USD|VND)?\s*\d+([.,]\d+)?\s*(\$|₫|USD|VND)?$/i.test(txt)) return;
                if (/^\d{1,2}[/-]\d{1,2}[/-]\d{2,4}/.test(txt)) return;
                if (/^(active|inactive|draft|published|pending|đã dùng|chưa dùng|đã xuất bản)$/i.test(txt)) return;
                if (/^(edit|delete|view|sửa|xóa|xem|link|chi tiết|action)$/i.test(txt)) return;

                const link = td.querySelector('a');
                if (link && link.textContent.trim().length > 3) {
                    candidates.push({ text: link.textContent.trim(), score: 50 + link.textContent.trim().length });
                    return;
                }

                if (txt.length > 3) {
                    candidates.push({ text: txt, score: txt.length });
                }
            });

            if (candidates.length > 0) {
                candidates.sort((a, b) => b.score - a.score);
                return candidates[0].text;
            }
        }

        // 3. Fallback for cards / grid
        const cardTitle = container.querySelector('.title, .name, h3, h4, h5, a');
        if (cardTitle && cardTitle.textContent.trim().length > 2) {
            return cardTitle.textContent.trim();
        }

        return '';
    }

    function renderLinkedBadgesAcrossPage(linkedMap) {
        if (!linkedMap || typeof linkedMap !== 'object') return;

        try {
            // 1. Table rows on Ecomlap (e.g. table tbody tr, .ant-table-row)
            const rows = document.querySelectorAll('table tbody tr, .ant-table-row, [role="row"]');
            rows.forEach((row, idx) => {
                const title = extractTitleFromRow(row);
                const id = row.getAttribute('data-id') 
                    || row.getAttribute('data-product-id') 
                    || row.getAttribute('data-row-key') 
                    || row.querySelector('input[type="checkbox"]')?.value 
                    || '';
                const img = row.querySelector('img');
                const imgSrc = img?.currentSrc || img?.src || img?.getAttribute('data-src') || '';

                if (isItemLinked(id, title, imgSrc, linkedMap)) {
                    row.classList.add('vibe-item-linked');
                    row.style.setProperty('background-color', '#f0fdf4', 'important');

                    const imgCell = (img && img.closest('td')) || (img && img.parentElement) || row.querySelector('td:nth-child(2), td:first-child');
                    if (imgCell) {
                        const targetWrapper = img?.parentElement || imgCell;
                        if (!targetWrapper.querySelector('.vibe-linked-badge')) {
                            const cs = window.getComputedStyle(targetWrapper);
                            if (cs.position === 'static') {
                                targetWrapper.style.position = 'relative';
                            }
                            targetWrapper.appendChild(createBadgeElement(`Đã liên kết với 16vibe: ${title || 'Sản phẩm'}`));
                        }
                    }
                } else if (row.classList.contains('vibe-item-linked')) {
                    row.classList.remove('vibe-item-linked');
                    if (row.style.backgroundColor === '#f0fdf4' || row.style.backgroundColor === 'rgb(240, 253, 244)') {
                        row.style.backgroundColor = '';
                    }
                    const badge = row.querySelector('.vibe-linked-badge');
                    if (badge) badge.remove();
                }
            });

            // 2. Product cards / grid items on Ecomlap
            const cards = document.querySelectorAll('.product-card, .product-item, [data-product], [data-product-id], .card, .ant-card, [class*="card"]');
            cards.forEach((card) => {
                // The extension gallery has its own stable-ID renderer below.
                if (card.closest('#ecomlap-manager-panel')) return;
                const title = extractTitleFromRow(card) || card.querySelector('.title, .name, [class*="title"], [class*="name"]')?.textContent?.trim() || '';
                const id = card.getAttribute('data-product-id') 
                    || card.getAttribute('data-id') 
                    || card.querySelector('input[type="checkbox"]')?.value 
                    || '';
                const img = card.querySelector('img');
                const imgSrc = img?.currentSrc || img?.src || img?.getAttribute('data-src') || '';

                if (isItemLinked(id, title, imgSrc, linkedMap)) {
                    card.classList.add('vibe-item-linked');
                    card.style.setProperty('background-color', '#f0fdf4', 'important');
                    card.style.setProperty('border-color', '#86efac', 'important');

                    const thumbWrapper = (img && img.closest('.image, .thumb, .product-thumb, .cover, .ant-card-cover, [class*="thumb"], [class*="image"]')) || (img && img.parentElement) || card;
                    if (thumbWrapper && !thumbWrapper.querySelector('.vibe-linked-badge')) {
                        const cs = window.getComputedStyle(thumbWrapper);
                        if (cs.position === 'static') {
                            thumbWrapper.style.position = 'relative';
                        }
                        thumbWrapper.appendChild(createBadgeElement(`Đã liên kết với 16vibe: ${title || 'Sản phẩm'}`));
                    }
                } else if (card.classList.contains('vibe-item-linked')) {
                    card.classList.remove('vibe-item-linked');
                    if (card.style.backgroundColor === '#f0fdf4' || card.style.backgroundColor === 'rgb(240, 253, 244)') {
                        card.style.backgroundColor = '';
                        card.style.borderColor = '';
                    }
                    const badge = card.querySelector('.vibe-linked-badge');
                    if (badge) badge.remove();
                }
            });

            // 3. Extension In-Page Gallery/Table items (#ecomlap-manager-panel)
            const galleryCards = document.querySelectorAll('#ecomlap-manager-panel .idea-card, #ecomlap-manager-panel .table-row');
            galleryCards.forEach((item) => {
                const title = item.querySelector('.idea-name')?.textContent || item.querySelector('.idea-title')?.textContent || '';
                const img = item.querySelector('img');
                const imgSrc = img?.currentSrc || img?.src || img?.getAttribute('data-src') || '';
                const id = item.dataset?.id || '';

                if (isItemLinked(id, title, imgSrc, linkedMap)) {
                    // Highlight linked item with soft green background and light green border
                    item.classList.add('vibe-item-linked');
                    item.style.setProperty('background-color', '#f0fdf4', 'important');
                    item.style.setProperty('border-color', '#86efac', 'important');

                    const thumb = item.querySelector('.idea-thumb, .td-image') || item;
                    if (thumb && !thumb.querySelector('.vibe-linked-badge')) {
                        const cs = window.getComputedStyle(thumb);
                        if (!cs.position || cs.position === 'static') {
                            thumb.style.position = 'relative';
                        }
                        thumb.appendChild(createBadgeElement(`Đã liên kết với 16vibe`));
                    }

                    // Add text badge "✓ Đã link"
                    if (item.classList.contains('idea-card')) {
                        const thumbEl = item.querySelector('.idea-thumb') || item;
                        if (!thumbEl.querySelector('.badge-linked-16vibe')) {
                            const badgeSpan = document.createElement('span');
                            badgeSpan.className = 'badge-linked-16vibe';
                            badgeSpan.style.cssText = 'position: absolute; bottom: 6px; left: 6px; background: #059669; color: white; padding: 3px 7px; border-radius: 4px; font-size: 12px; font-weight: 600; pointer-events: none;';
                            badgeSpan.innerHTML = '✓ Đã link';
                            thumbEl.appendChild(badgeSpan);
                        }
                    } else if (item.classList.contains('table-row')) {
                        const statusCol = item.querySelector('.td-status');
                        if (statusCol && !statusCol.querySelector('.badge-linked-16vibe')) {
                            const badgeSpan = document.createElement('span');
                            badgeSpan.className = 'badge badge-success badge-linked-16vibe';
                            badgeSpan.style.cssText = 'background: #10b981 !important; color: #ffffff !important; margin-left: 4px !important; font-weight: 600 !important;';
                            badgeSpan.innerHTML = '✓ Đã link';
                            statusCol.appendChild(badgeSpan);
                        }
                    }
                } else {
                    item.classList.remove('vibe-item-linked');
                    if (item.style.backgroundColor === '#f0fdf4' || item.style.backgroundColor === 'rgb(240, 253, 244)') {
                        item.style.backgroundColor = '';
                        item.style.borderColor = '';
                    }
                    const badges = item.querySelectorAll('.badge-linked-16vibe, .vibe-linked-badge');
                    badges.forEach(b => b.remove());
                }
            });
        } catch (e) {
            console.warn('[16vibe] Error rendering linked badges:', e);
        }
    }

    /**
     * Dispatch reliable click event to element
     */
    function simulateClick(el) {
        if (!el) return;
        const target = el.querySelector('button, a') || el;
        try {
            target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
            target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
            target.click();
        } catch (e) {
            try { target.click(); } catch (err) {}
        }
    }

    /**
     * Detect current pagination state from Ecomlap web page
     */
    function detectEcomlapPageInfo() {
        let currentPage = 1;
        let totalPages = 1;
        let totalItems = 0;
        let hasPrev = false;
        let hasNext = false;

        // 1. Ant Design pagination elements
        const activeItem = document.querySelector('.ant-pagination-item-active');
        if (activeItem) {
            const num = parseInt(activeItem.textContent.trim(), 10) || parseInt(activeItem.getAttribute('title'), 10);
            if (num) currentPage = num;
        }

        const items = document.querySelectorAll('.ant-pagination-item');
        if (items.length > 0) {
            const lastItem = items[items.length - 1];
            const num = parseInt(lastItem.textContent.trim(), 10) || parseInt(lastItem.getAttribute('title'), 10);
            if (num) totalPages = Math.max(currentPage, num);
        }

        const prevEl = document.querySelector('.ant-pagination-prev');
        if (prevEl) {
            hasPrev = !prevEl.classList.contains('ant-pagination-disabled') && prevEl.getAttribute('aria-disabled') !== 'true';
        } else {
            hasPrev = currentPage > 1;
        }

        const nextEl = document.querySelector('.ant-pagination-next');
        if (nextEl) {
            hasNext = !nextEl.classList.contains('ant-pagination-disabled') && nextEl.getAttribute('aria-disabled') !== 'true';
        } else {
            hasNext = currentPage < totalPages;
        }

        const totalEl = document.querySelector('.ant-pagination-total-text');
        if (totalEl) {
            const m = totalEl.textContent.match(/\d+/);
            if (m) totalItems = parseInt(m[0], 10);
        }

        // 2. Fallback to URL search params
        if (currentPage === 1) {
            try {
                const urlParams = new URLSearchParams(window.location.search);
                const p = parseInt(urlParams.get('page'), 10);
                if (p && p >= 1) currentPage = p;
            } catch (e) {}
        }

        // 3. Fallback to Zustand store
        try {
            if (window.__16vibe_store && typeof window.__16vibe_store.getState === 'function') {
                const st = window.__16vibe_store.getState();
                if (st && st.pagination) {
                    if (!totalItems && st.pagination.total) totalItems = st.pagination.total;
                    if (totalPages <= 1 && st.pagination.last_page) totalPages = st.pagination.last_page;
                }
            }
        } catch (e) {}

        return {
            currentPage,
            totalPages: Math.max(currentPage, totalPages),
            totalItems,
            hasPrev,
            hasNext
        };
    }

    /**
     * Trigger page change on Ecomlap page, synchronizing both Ecomlap and Product Manager
     */
    function triggerEcomlapPagination(direction) {
        console.log(`[16vibe] Chuyển trang: ${direction}`);
        let clicked = false;

        if (direction === 'next') {
            const nextBtn = document.querySelector('.ant-pagination-next:not(.ant-pagination-disabled) button, .ant-pagination-next:not(.ant-pagination-disabled) a, .ant-pagination-next:not(.ant-pagination-disabled), [aria-label="Next"], [aria-label="next"], .pagination-next, .btn-next');
            if (nextBtn) {
                simulateClick(nextBtn);
                clicked = true;
            } else {
                const activeItem = document.querySelector('.ant-pagination-item-active');
                if (activeItem && activeItem.nextElementSibling && activeItem.nextElementSibling.classList.contains('ant-pagination-item')) {
                    simulateClick(activeItem.nextElementSibling);
                    clicked = true;
                }
            }
        } else if (direction === 'prev') {
            const prevBtn = document.querySelector('.ant-pagination-prev:not(.ant-pagination-disabled) button, .ant-pagination-prev:not(.ant-pagination-disabled) a, .ant-pagination-prev:not(.ant-pagination-disabled), [aria-label="Previous"], [aria-label="prev"], .pagination-prev, .btn-prev');
            if (prevBtn) {
                simulateClick(prevBtn);
                clicked = true;
            } else {
                const activeItem = document.querySelector('.ant-pagination-item-active');
                if (activeItem && activeItem.previousElementSibling && activeItem.previousElementSibling.classList.contains('ant-pagination-item')) {
                    simulateClick(activeItem.previousElementSibling);
                    clicked = true;
                }
            }
        }

        // Fallback: If no DOM pagination button found, navigate URL and fetch
        if (!clicked) {
            const pageInfo = detectEcomlapPageInfo();
            const targetPage = direction === 'next' ? (pageInfo.currentPage + 1) : Math.max(1, pageInfo.currentPage - 1);
            if (targetPage !== pageInfo.currentPage) {
                try {
                    const u = new URL(window.location.href);
                    u.searchParams.set('page', String(targetPage));
                    window.history.pushState({}, '', u.toString());
                } catch (e) {}
            }
        }

        // Trigger active fetch & update Product Manager UI after navigation
        setTimeout(() => {
            fetchProductsFromCurrentSite();
            setTimeout(renderProductManagerPagination, 300);
        }, 350);
    }

    /**
     * Render and update pagination controls in Product Manager panel
     */
    function renderProductManagerPagination() {
        const panel = document.getElementById('ecomlap-manager-panel');
        if (!panel) return;

        const pageInfo = detectEcomlapPageInfo();

        // 1. Minimized View (Gallery)
        const gallery = panel.querySelector('.ecomlap-ideas-gallery');
        if (gallery) {
            let pagEl = gallery.querySelector('.vibe-pm-pagination-gallery');
            if (!pagEl) {
                pagEl = document.createElement('div');
                pagEl.className = 'ecomlap-pagination vibe-pm-pagination-gallery';
                pagEl.style.cssText = `
                    display: flex !important;
                    align-items: center !important;
                    justify-content: space-between !important;
                    padding: 8px 14px !important;
                    background: #f8fafc !important;
                    border-top: 1px solid #e2e8f0 !important;
                    flex-shrink: 0 !important;
                    margin-top: auto !important;
                    z-index: 10 !important;
                `;
                gallery.appendChild(pagEl);
            }

            pagEl.innerHTML = `
                <div class="pagination-info" style="font-size: 12px; color: #475569; display: flex; align-items: center; gap: 4px;">
                    <span>Trang <strong>${pageInfo.currentPage}</strong> / <strong>${pageInfo.totalPages}</strong></span>
                    ${pageInfo.totalItems > 0 ? `<span style="color:#94a3b8;">(${pageInfo.totalItems} sp)</span>` : ''}
                </div>
                <div class="pagination-actions" style="display: flex; align-items: center; gap: 6px;">
                    <button type="button" class="btn btn-sm btn-secondary vibe-btn-prev" ${!pageInfo.hasPrev ? 'disabled' : ''} style="padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: ${pageInfo.hasPrev ? 'pointer' : 'not-allowed'}; opacity: ${pageInfo.hasPrev ? '1' : '0.4'};">
                        ◀ Trước
                    </button>
                    <button type="button" class="btn btn-sm btn-secondary vibe-btn-next" ${!pageInfo.hasNext ? 'disabled' : ''} style="padding: 4px 10px; font-size: 11px; font-weight: 600; cursor: ${pageInfo.hasNext ? 'pointer' : 'not-allowed'}; opacity: ${pageInfo.hasNext ? '1' : '0.4'};">
                        Sau ▶
                    </button>
                </div>
            `;

            const prevBtn = pagEl.querySelector('.vibe-btn-prev');
            const nextBtn = pagEl.querySelector('.vibe-btn-next');
            if (prevBtn && pageInfo.hasPrev) {
                prevBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    triggerEcomlapPagination('prev');
                };
            }
            if (nextBtn && pageInfo.hasNext) {
                nextBtn.onclick = (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    triggerEcomlapPagination('next');
                };
            }
        }

        // 2. Expanded View (Table)
        // Bind click synchronization to existing React table pagination buttons
        const leftPanel = panel.querySelector('.ecomlap-left-panel');
        if (leftPanel) {
            const reactPag = leftPanel.querySelector('.ecomlap-pagination:not(.vibe-pm-pagination-gallery)');
            if (reactPag) {
                const buttons = reactPag.querySelectorAll('button');
                buttons.forEach(btn => {
                    const txt = btn.textContent.trim();
                    if ((txt.includes('Trước') || txt.includes('◀')) && !btn.hasAttribute('data-vibe-bound')) {
                        btn.setAttribute('data-vibe-bound', 'true');
                        btn.addEventListener('click', () => {
                            triggerEcomlapPagination('prev');
                        }, true);
                    } else if ((txt.includes('Sau') || txt.includes('▶')) && !btn.hasAttribute('data-vibe-bound')) {
                        btn.setAttribute('data-vibe-bound', 'true');
                        btn.addEventListener('click', () => {
                            triggerEcomlapPagination('next');
                        }, true);
                    }
                });
            }
        }
    }

    function setupBadgeMutationObserver() {
        if (badgeObserver) return;
        badgeObserver = new MutationObserver(() => {
            if (badgeDebounceTimer) clearTimeout(badgeDebounceTimer);
            badgeDebounceTimer = setTimeout(() => {
                if (cachedLinkedMap && Object.keys(cachedLinkedMap).length > 0) {
                    renderLinkedBadgesAcrossPage(cachedLinkedMap);
                }
                renderProductManagerPagination();
            }, 300);
        });

        const target = document.body || document.documentElement;
        if (target) {
            badgeObserver.observe(target, { childList: true, subtree: true });
        }
    }

    // Run network hook injection immediately at document_start
    injectNetworkHook();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
