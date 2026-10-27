/**
 * Link 16vibe Modal Component
 * Displays modal for syncing/linking selected products to Inkvibe Medusa backend.
 * Fully aligned with reference mockup and supports:
 * - Real personalization configs from Ecomlap
 * - Inkvibe hierarchical category tree select & breadcrumbs
 * - Ancestor chain for category_ids (parent -> child)
 * - Multi-image extraction: main_image_url + other_image_url1..10 + additional images
 * - Single product toggle vs full variants, base price, inventory tracking, upsert
 */

(function () {
    'use strict';

    if (typeof window !== 'undefined' && window.location && window.location.hostname && !window.location.hostname.includes('ecomlap.com')) {
        return;
    }

    let modalElement = null;
    let currentSelectedProducts = [];
    let lastActiveField = null;
    let cachedPersonalizationConfigs = null;
    let cachedInkvibeMetadata = null;
    let cachedCategoriesList = [];

    // State for dynamic variants matrix & custom table
    let matrixColors = [
        { name: 'Black', extra: 0 }
    ];
    let matrixSizes = [
        { name: 'Small', extra: 0 },
        { name: 'Medium', extra: 1.00 },
        { name: 'Large', extra: 2.00 },
        { name: 'X-Large', extra: 3.00 },
        { name: '2X-Large', extra: 4.00 },
        { name: '3X-Large', extra: 5.00 }
    ];
    let tableOptionTitles = ['Color', 'Size'];
    let tableVariants = [
        { Color: 'Black', Size: 'Small', price: 29.95 },
        { Color: 'Black', Size: 'Medium', price: 30.95 },
        { Color: 'Black', Size: 'Large', price: 31.95 },
        { Color: 'Black', Size: 'X-Large', price: 32.95 },
        { Color: 'Black', Size: '2X-Large', price: 33.95 },
        { Color: 'Black', Size: '3X-Large', price: 34.95 }
    ];

    /**
     * Inject Modal Styles directly into DOM to guarantee styling and visibility
     */
    function ensureModalStylesInjected() {
        if (typeof document === 'undefined') return;

        // 1. Inject critical layout & visibility style immediately
        if (!document.getElementById('vibe-link-modal-critical-styles')) {
            const style = document.createElement('style');
            style.id = 'vibe-link-modal-critical-styles';
            style.textContent = `
                .vibe-link-modal-overlay {
                    position: fixed !important;
                    top: 0 !important;
                    left: 0 !important;
                    width: 100vw !important;
                    height: 100vh !important;
                    background: rgba(15, 23, 42, 0.7) !important;
                    backdrop-filter: blur(4px) !important;
                    -webkit-backdrop-filter: blur(4px) !important;
                    z-index: 2147483647 !important;
                    display: none;
                    align-items: center !important;
                    justify-content: center !important;
                    box-sizing: border-box !important;
                    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif !important;
                }
                .vibe-link-modal-overlay.active {
                    display: flex !important;
                    opacity: 1 !important;
                    visibility: visible !important;
                    pointer-events: auto !important;
                }
                .vibe-link-modal-dialog {
                    width: 95% !important;
                    max-width: 960px !important;
                    max-height: 94vh !important;
                    background: #ffffff !important;
                    border-radius: 12px !important;
                    box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.35) !important;
                    display: flex !important;
                    flex-direction: column !important;
                    overflow: hidden !important;
                    color: #1e293b !important;
                }
            `;
            (document.head || document.documentElement).appendChild(style);
        }

        // 2. Inject full stylesheet via chrome.runtime.getURL
        if (!document.getElementById('vibe-link-modal-styles-link') && typeof chrome !== 'undefined' && chrome.runtime && typeof chrome.runtime.getURL === 'function') {
            try {
                const link = document.createElement('link');
                link.id = 'vibe-link-modal-styles-link';
                link.rel = 'stylesheet';
                link.type = 'text/css';
                link.href = chrome.runtime.getURL('assets/styles/link-16vibe-modal.css');
                (document.head || document.documentElement).appendChild(link);
            } catch (e) {}
        }
    }

    ensureModalStylesInjected();
    if (typeof document !== 'undefined' && document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', ensureModalStylesInjected);
    }

    /**
     * Toast notification helper
     */
    function showToast(message, type = 'info') {
        const existing = document.querySelectorAll('.vibe-toast-msg');
        existing.forEach(el => el.remove());

        const toast = document.createElement('div');
        toast.className = 'vibe-toast-msg ' + type;
        const icon = (type === 'success') ? '✅' : (type === 'error') ? '⚠️' : 'ℹ️';
        toast.innerHTML = '<span>' + icon + '</span><span>' + message + '</span>';
        document.body.appendChild(toast);

        setTimeout(() => {
            toast.style.opacity = '0';
            toast.style.transform = 'translateY(12px)';
            toast.style.transition = 'all 0.3s ease';
            setTimeout(() => toast.remove(), 300);
        }, 4000);
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
     * Accurately extract product title from a table row or card element in DOM
     */
    function extractTitleFromRow(container) {
        if (!container) return '';

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

        const cells = Array.from(container.querySelectorAll('td, th'));
        if (cells.length > 0) {
            const candidates = [];
            cells.forEach((td) => {
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

        const cardTitle = container.querySelector('.title, .name, h3, h4, h5, a');
        if (cardTitle && cardTitle.textContent.trim().length > 2) {
            return cardTitle.textContent.trim();
        }

        return '';
    }

    /**
     * Resolve ancestor chain for category_ids: [parent_id, ..., leaf_id]
     */
    function getCategoryAncestorIds(selectedId, categoriesList) {
        if (!selectedId) return [];
        const idToCat = new Map((categoriesList || []).map(c => [c.id, c]));
        const chain = [];
        let curr = idToCat.get(selectedId);
        let depth = 0;
        while (curr && depth < 10) {
            chain.unshift(curr.id); // Parent first, child last
            curr = curr.parent_category_id ? idToCat.get(curr.parent_category_id) : null;
            depth++;
        }
        return chain;
    }

    /**
     * Deep scanner for JWT token across all possible storages
     */
    function findTokenAnywhere() {
        try {
            if (typeof window === 'undefined') return '';
            const testJwt = (val) => {
                if (!val || typeof val !== 'string') return false;
                const trimmed = val.replace(/^Bearer\s+/i, '').trim();
                return /^eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]{10,}$/.test(trimmed);
            };

            const directKeys = [
                'token', 'access_token', 'jwt', 'hmt-token', 'auth_token',
                'user_token', 'authToken', 'accessToken', 'loginToken',
                'ecomlap_token', 'ecomlap_jwt', 'admin_token'
            ];

            for (const k of directKeys) {
                try {
                    const v1 = localStorage.getItem(k);
                    if (testJwt(v1)) return v1.replace(/^Bearer\s+/i, '').trim();
                    const v2 = sessionStorage.getItem(k);
                    if (testJwt(v2)) return v2.replace(/^Bearer\s+/i, '').trim();
                } catch (e) {}
            }

            for (let i = 0; i < localStorage.length; i++) {
                const k = localStorage.key(i);
                const val = localStorage.getItem(k);
                if (testJwt(val)) return val.replace(/^Bearer\s+/i, '').trim();
                if (val && (val.startsWith('{') || val.startsWith('['))) {
                    try {
                        const parsed = JSON.parse(val);
                        for (const subKey of directKeys) {
                            if (parsed && testJwt(parsed[subKey])) {
                                return parsed[subKey].replace(/^Bearer\s+/i, '').trim();
                            }
                        }
                    } catch (e) {}
                }
            }

            for (let i = 0; i < sessionStorage.length; i++) {
                const k = sessionStorage.key(i);
                const val = sessionStorage.getItem(k);
                if (testJwt(val)) return val.replace(/^Bearer\s+/i, '').trim();
                if (val && (val.startsWith('{') || val.startsWith('['))) {
                    try {
                        const parsed = JSON.parse(val);
                        for (const subKey of directKeys) {
                            if (parsed && testJwt(parsed[subKey])) {
                                return parsed[subKey].replace(/^Bearer\s+/i, '').trim();
                            }
                        }
                    } catch (e) {}
                }
            }

            const cookies = document.cookie ? document.cookie.split(';') : [];
            for (const c of cookies) {
                const parts = c.split('=');
                const name = (parts[0] || '').trim();
                const val = decodeURIComponent((parts[1] || '').trim());
                if (directKeys.includes(name) && testJwt(val)) {
                    return val.replace(/^Bearer\s+/i, '').trim();
                }
                if (testJwt(val)) {
                    return val.replace(/^Bearer\s+/i, '').trim();
                }
            }
        } catch (e) {}
        return '';
    }

    /**
     * Request Main World page context to fetch Personalization configs via bridge
     */
    function fetchPersonalizationConfigsViaMainWorld() {
        return new Promise((resolve) => {
            const reqId = 'req_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7);
            let cleanedUp = false;

            const timer = setTimeout(() => {
                cleanup();
                resolve(null);
            }, 3500);

            function cleanup() {
                if (cleanedUp) return;
                cleanedUp = true;
                clearTimeout(timer);
                window.removeEventListener('message', onMsg);
                window.removeEventListener('16vibe-personalization-response', onCustomEvt);
            }

            function onMsg(event) {
                if (event.source !== window || !event.data) return;
                if (event.data.type === '16VIBE_PERSONALIZATION_CONFIGS_RES' && event.data.requestId === reqId) {
                    cleanup();
                    resolve(event.data.items || null);
                }
            }

            function onCustomEvt(event) {
                if (event.detail && event.detail.success) {
                    const data = event.detail.data;
                    const items = event.detail.items || (Array.isArray(data) ? data : (data?.data || data?.configs || data?.items || []));
                    cleanup();
                    resolve(items || null);
                }
            }

            window.addEventListener('message', onMsg);
            window.addEventListener('16vibe-personalization-response', onCustomEvt);

            // Dispatch both CustomEvent and postMessage for maximum compatibility
            try {
                window.dispatchEvent(new CustomEvent('16vibe-fetch-personalization', { detail: { requestId: reqId } }));
            } catch (e) {}

            try {
                window.postMessage({
                    type: '16VIBE_FETCH_PERSONALIZATION_CONFIGS_REQ',
                    requestId: reqId
                }, '*');
            } catch (e) {}
        });
    }

    /**
     * Fetch Personalization Configs
     */
    async function fetchPersonalizationConfigs() {
        if (cachedPersonalizationConfigs && cachedPersonalizationConfigs.length > 0) {
            return cachedPersonalizationConfigs;
        }

        try {
            const bridgeItems = await fetchPersonalizationConfigsViaMainWorld();
            if (Array.isArray(bridgeItems) && bridgeItems.length > 0) {
                const mapped = bridgeItems.map((c, i) => ({
                    id: String(c._id || c.id || ('cfg_' + (i + 1))),
                    name: c.name || c.title || c.code || ('Cấu hình cá nhân hóa #' + (i + 1)),
                    code: c.code || '',
                    raw: c
                }));
                cachedPersonalizationConfigs = mapped;
                return mapped;
            }
        } catch (e) {}

        const token = findTokenAnywhere();
        const headers = { 'Accept': 'application/json, text/plain, */*' };
        if (token) {
            headers['Authorization'] = 'Bearer ' + token;
            headers['hmt-token'] = token;
        }

        try {
            const res = await fetch('https://ecomlap.com/api/product-personalization-configs?status=active&limit=100', {
                method: 'GET',
                credentials: 'include',
                headers: headers
            });

            if (res.ok) {
                const json = await res.json();
                let items = [];
                if (Array.isArray(json)) items = json;
                else if (json.docs && Array.isArray(json.docs)) items = json.docs;
                else if (json.data && Array.isArray(json.data)) items = json.data;
                else if (json.configs && Array.isArray(json.configs)) items = json.configs;
                else if (json.items && Array.isArray(json.items)) items = json.items;

                const mapped = items.map((c, i) => ({
                    id: String(c._id || c.id || ('cfg_' + (i + 1))),
                    name: c.name || c.title || c.code || ('Cấu hình cá nhân hóa #' + (i + 1)),
                    code: c.code || '',
                    raw: c
                }));

                if (mapped.length > 0) {
                    cachedPersonalizationConfigs = mapped;
                    return mapped;
                }
            }
        } catch (err) {}

        const fallbackPresets = [
            { id: "6a7b6512d77cfcad9c09f546", name: "Custom Apparel Personalization", code: "custom-apparel" },
            { id: "6a8f2b36609b55d6ab469626", name: "Custom Hat", code: "custom-hat" },
            { id: "6a8c077d82248306cfedae9a", name: "11oz & 15oz Mug Personalization - Black", code: "mug-black" },
            { id: "6724a2c0f124a91bb4c00003", name: "Pet Portrait Artwork Config", code: "pet-portrait" },
            { id: "6724a2c0f124a91bb4c00004", name: "Poster & Canvas Photo Print", code: "canvas-print" },
            { id: "6724a2c0f124a91bb4c00006", name: "Holiday Ornament & Greeting Card", code: "ornament-holiday" }
        ].map(item => ({ ...item, raw: item }));

        return fallbackPresets;
    }

    /**
     * Fetch Inkvibe Store Metadata (Categories, Collections, Tags, Sales Channels, Shipping Profiles)
     */
    async function fetchInkvibeMetadata(forceRefresh = false) {
        if (!forceRefresh && cachedInkvibeMetadata && 
            ((cachedInkvibeMetadata.categories && cachedInkvibeMetadata.categories.length > 0) || 
             (cachedInkvibeMetadata.collections && cachedInkvibeMetadata.collections.length > 0))) {
            return cachedInkvibeMetadata;
        }

        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ 
                action: 'getInkvibeMetadata',
                data: { serverUrl: 'https://api.16vibe.com' }
            }, (response) => {
                if (response && response.success && response.data && 
                    ((response.data.categories && response.data.categories.length > 0) || 
                     (response.data.collections && response.data.collections.length > 0))) {
                    cachedInkvibeMetadata = response.data;
                    cachedCategoriesList = response.data.categories || [];
                    resolve(response.data);
                } else {
                    const fallback = {
                        categories: [
                            { id: "pcat_01M2FR96Z8QTGW71HQJG7GK4X7", name: "Apparel", parent_category_id: null, rank: 0 },
                            { id: "pcat_01M2FR99DWS97R6FWHH2G71MG5", name: "Custom Shirts", parent_category_id: "pcat_01M2FR96Z8QTGW71HQJG7GK4X7", rank: 1 },
                            { id: "pcat_01M2FR97BSND85NG6SHVF54YJ3", name: "Drinkware", parent_category_id: null, rank: 0 },
                            { id: "pcat_01M2PSRRAE8486N75SSZDKHXNT", name: "Custom Mugs", parent_category_id: "pcat_01M2FR97BSND85NG6SHVF54YJ3", rank: 1 },
                            { id: "pcat_01M2PSRRZD77D3N60XPAH6DK1W", name: "Custom Tumblers", parent_category_id: "pcat_01M2FR97BSND85NG6SHVF54YJ3", rank: 2 },
                            { id: "pcat_01M2FR982ZYBRPXDC13XNVPVF9", name: "Accessories", parent_category_id: null, rank: 0 },
                            { id: "pcat_01M2Q9SPHXASHFRCADAYTSBVRC", name: "Custom Hats", parent_category_id: "pcat_01M2FR982ZYBRPXDC13XNVPVF9", rank: 1 },
                            { id: "pcat_01M2PSJW881KETDPD50GWMYGQY", name: "Cards", parent_category_id: null, rank: 0 },
                            { id: "pcat_01M2PSNXR1N8CMRT431A3TQW41", name: "Custom Greeting Cards", parent_category_id: "pcat_01M2PSJW881KETDPD50GWMYGQY", rank: 1 },
                            { id: "pcat_01M2PSRP7HKS06EQ02NSQGPTXE", name: "Home Decor", parent_category_id: null, rank: 0 },
                            { id: "pcat_01M2PSRYV5FJ0Y2DCQ7E198M72", name: "Custom Ornaments", parent_category_id: "pcat_01M2PSRP7HKS06EQ02NSQGPTXE", rank: 1 }
                        ],
                        collections: [
                            { id: "pcol_best_sellers", name: "Best Sellers", title: "Best Sellers" },
                            { id: "pcol_halloween", name: "Halloween", title: "Halloween" },
                            { id: "pcol_valentine", name: "Valentine's Day", title: "Valentine's Day" },
                            { id: "pcol_trending", name: "Trending Gifts", title: "Trending Gifts" },
                            { id: "pcol_pet_lovers", name: "Pet Lovers", title: "Pet Lovers" }
                        ],
                        tags: [
                            "t-shirt", "16vibe", "ecomlap", "Valentine's Day", "Pet Lovers",
                            "Vintage", "Custom Shirts", "Custom Mugs", "Gift for Mom", "Gift for Dad"
                        ],
                        salesChannels: [
                            { id: "sc_default", name: "Default Sales Channel" }
                        ],
                        shippingProfiles: [
                            { id: "sp_default", name: "Default Shipping Profile" }
                        ],
                        productTypes: [
                            { id: "pt_shirt", value: "Shirt" },
                            { id: "pt_hoodie", value: "Hoodie" },
                            { id: "pt_mug", value: "Mug" }
                        ],
                        vendors: [
                            { id: "admin", name: "Admin", handle: "admin" },
                            { id: "01M1C02AVPFY4GQBKZKNH4KVE2", name: "InkVibe Studio", handle: "inkvibe-studio" },
                            { id: "01M1C02B3J6NWS1J39JVDV1AEV", name: "Urban Apparel", handle: "urban-apparel" }
                        ],
                        isLive: false
                    };
                    cachedCategoriesList = fallback.categories;
                    resolve(fallback);
                }
            });
        });
    }

    /**
     * Build Hierarchical Category Tree from flat category list
     */
    function buildCategoryTree(categories) {
        if (!Array.isArray(categories) || categories.length === 0) return [];

        const idMap = new Map();
        categories.forEach(c => {
            idMap.set(c.id, {
                ...c,
                children: []
            });
        });

        const roots = [];
        categories.forEach(c => {
            const node = idMap.get(c.id);
            if (c.parent_category_id && idMap.has(c.parent_category_id)) {
                idMap.get(c.parent_category_id).children.push(node);
            } else {
                roots.push(node);
            }
        });

        const sortNodes = (nodes) => {
            nodes.sort((a, b) => {
                if ((a.rank ?? 0) !== (b.rank ?? 0)) return (a.rank ?? 0) - (b.rank ?? 0);
                return (a.name || '').localeCompare(b.name || '');
            });
            nodes.forEach(n => {
                if (n.children && n.children.length > 0) {
                    sortNodes(n.children);
                }
            });
        };
        sortNodes(roots);

        const flattenedTree = [];
        function traverse(node, level, prefix = '', path = []) {
            const currentPath = [...path, node.name];
            flattenedTree.push({
                id: node.id,
                name: node.name,
                level: level,
                prefix: prefix,
                path: currentPath.join(' > '),
                hasChildren: node.children && node.children.length > 0
            });

            if (node.children && node.children.length > 0) {
                node.children.forEach((child, idx) => {
                    const isLast = idx === node.children.length - 1;
                    const childPrefix = prefix + (level === 0 ? '　' : '│　') + (isLast ? '└── ' : '├── ');
                    traverse(child, level + 1, childPrefix, currentPath);
                });
            }
        }

        roots.forEach(r => traverse(r, 0, '', []));
        return flattenedTree;
    }

    /**
     * Create Modal DOM
     */
    function createModalDom() {
        if (modalElement && document.body && document.body.contains(modalElement)) return modalElement;

        const existing = document.getElementById('vibe-link-16vibe-modal');
        if (existing) {
            modalElement = existing;
            return existing;
        }

        const overlay = document.createElement('div');
        overlay.className = 'vibe-link-modal-overlay';
        overlay.id = 'vibe-link-16vibe-modal';

        overlay.innerHTML = `
            <div class="vibe-link-modal-dialog">
                <!-- Header -->
                <div class="vibe-modal-header">
                    <div class="vibe-modal-title-wrap">
                        <div class="vibe-modal-title">
                            <span class="vibe-modal-title-icon">🔗</span>
                            <span>Liên kết sản phẩm lên Medusa (Link 16vibe)</span>
                        </div>
                        <div class="vibe-modal-subtitle" id="vibe-modal-subtitle">
                            Cấu hình thông tin đồng bộ sản phẩm vào hệ thống Inkvibe
                        </div>
                    </div>
                    <button type="button" class="vibe-modal-close-btn" id="vibe-btn-close-modal" title="Đóng">✕</button>
                </div>

                <!-- Body (2 Columns) -->
                <div class="vibe-modal-body">
                    <!-- Left Column: Thông tin sản phẩm & Nội dung -->
                    <div class="vibe-modal-col">
                        <div class="vibe-card">
                            <div class="vibe-card-title">📝 Thông tin & Nội dung sản phẩm</div>

                            <!-- Cấu hình cá nhân hóa -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-personalization">
                                    <span>Cấu hình cá nhân hóa</span>
                                    <span class="vibe-form-label-hint" id="vibe-hint-personalization-count">ecomlap.com/api/...</span>
                                </label>
                                <div class="vibe-input-wrap-flex">
                                    <select class="vibe-select" id="vibe-select-personalization">
                                        <option value="">-- Đang nạp cấu hình cá nhân hóa từ Ecomlap... --</option>
                                    </select>
                                    <button type="button" class="vibe-btn-refresh-field" id="vibe-btn-refresh-pers" title="Làm mới danh sách cá nhân hóa">🔄</button>
                                </div>
                            </div>

                            <!-- Dynamic Placeholders Banner -->
                            <div class="vibe-placeholder-box">
                                <div class="vibe-placeholder-header">
                                    <span>✨ Tiêu đề, Handle và Mô tả hỗ trợ các placeholder — tự động thay bằng dữ liệu từng sản phẩm:</span>
                                </div>
                                <div class="vibe-badges-container">
                                    <span class="vibe-badge-token" data-token="{{item_name}}">{{item_name}}</span>
                                    <span class="vibe-badge-token" data-token="{{item_sku}}">{{item_sku}}</span>
                                    <span class="vibe-badge-token" data-token="{{product_description}}">{{product_description}}</span>
                                    <span class="vibe-badge-token" data-token="{{brand_name}}">{{brand_name}}</span>
                                    <span class="vibe-badge-token" data-token="{{store_name}}">{{store_name}}</span>
                                    <span class="vibe-badge-token" data-token="{{bullet_points}}">{{bullet_points}}</span>
                                    <span class="vibe-badge-token" data-token="{{property:key}}">{{property:key}}</span>
                                </div>
                            </div>

                            <!-- Tiêu đề sản phẩm -->
                            <div class="vibe-form-group" style="margin-top: 12px;">
                                <label class="vibe-form-label" for="vibe-input-title">
                                    <span>Tiêu đề</span>
                                </label>
                                <input type="text" class="vibe-input vibe-track-focus" id="vibe-input-title" value="{{item_name}}" placeholder="Nhập tiêu đề sản phẩm...">
                            </div>

                            <!-- Đường dẫn / Handle -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-handle">
                                    <span>Handle</span>
                                </label>
                                <input type="text" class="vibe-input vibe-track-focus" id="vibe-input-handle" value="" placeholder="Để trống để tự sinh từ tiêu đề">
                            </div>

                            <!-- Nếu đã tồn tại (Upsert) -->
                            <div class="vibe-checkbox-row">
                                <label class="vibe-checkbox-label">
                                    <input type="checkbox" id="vibe-chk-update-if-exists" checked>
                                    <span>Cập nhật sản phẩm Medusa đã có thay vì báo lỗi</span>
                                </label>
                                <div class="vibe-field-desc">
                                    Đối chiếu theo handle, nên sản phẩm tạo ngoài hmt cũng tìm thấy. Ghi đè toàn bộ: tiêu đề, mô tả, hình ảnh, tuỳ chọn, biến thể, giá và tồn kho.
                                </div>
                            </div>

                            <!-- Mô tả sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-description">
                                    <span>Mô tả</span>
                                </label>
                                <textarea class="vibe-textarea vibe-track-focus" id="vibe-input-description" rows="3">{{product_description}}</textarea>
                            </div>
                        </div>

                        <!-- Card Media -->
                        <div class="vibe-card">
                            <div class="vibe-card-title">🖼️ Hình ảnh sản phẩm</div>

                            <!-- Hình ảnh bổ sung -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-additional-images">
                                    <span>Hình ảnh bổ sung</span>
                                    <span class="vibe-form-label-hint">Tùy chọn</span>
                                </label>
                                <textarea class="vibe-textarea" id="vibe-input-additional-images" rows="2" placeholder="Mỗi URL một dòng, hoặc phân tách bằng dấu phẩy"></textarea>
                            </div>

                            <div class="vibe-form-group">
                                <label class="vibe-form-label">
                                    <span>Hình ảnh sản phẩm được chọn (<span id="vibe-preview-img-count">0</span> ảnh)</span>
                                </label>
                                <div class="vibe-img-preview-list" id="vibe-img-preview-container">
                                    <!-- Rendered dynamically -->
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Thiết lập Inkvibe Store, Giá & Biến thể -->
                    <div class="vibe-modal-col">
                        <div class="vibe-card">
                            <div class="vibe-card-title">🏬 Cấu hình Inkvibe Store</div>

                            <!-- Trạng thái sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-status">Trạng thái</label>
                                <select class="vibe-select" id="vibe-select-status">
                                    <option value="published" selected>Đã xuất bản (Published)</option>
                                    <option value="draft">Bản nháp (Draft)</option>
                                    <option value="proposed">Đề xuất (Proposed)</option>
                                </select>
                            </div>

                            <!-- Người bán (Vendor) -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-vendor">
                                    <span>Người bán (Vendor)</span>
                                    <span class="vibe-form-label-hint">Mặc định: Admin</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-vendor">
                                    <option value="admin" selected>Admin (Chính sàn Inkvibe - Không hiển thị store)</option>
                                </select>
                                <div class="vibe-field-desc">Mặc định: Admin (sản phẩm của sàn, không hiển thị thẻ store/creator ở chi tiết sản phẩm).</div>
                            </div>

                            <!-- Kênh bán hàng -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-sales-channel">
                                    <span>Kênh bán hàng</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-sales-channel">
                                    <option value="">-- Đang tải kênh bán hàng... --</option>
                                </select>
                            </div>

                            <!-- Hồ sơ vận chuyển -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-shipping-profile">
                                    <span>Hồ sơ vận chuyển</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-shipping-profile">
                                    <option value="">-- Đang tải hồ sơ vận chuyển... --</option>
                                </select>
                            </div>

                            <!-- Danh mục sản phẩm (Hierarchical Tree Select) -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-category" style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>Danh mục sản phẩm</span>
                                    <span style="display: flex; align-items: center; gap: 6px;">
                                        <span class="vibe-form-label-hint" id="vibe-hint-category-count">Dạng cây Inkvibe</span>
                                        <button type="button" id="vibe-btn-refresh-metadata" title="Tải lại danh mục & bộ sưu tập từ 16vibe" style="background: none; border: 1px solid #cbd5e1; border-radius: 4px; cursor: pointer; font-size: 11px; padding: 1px 6px; color: #475569; line-height: 1.4;">🔄 Làm mới</button>
                                    </span>
                                </label>
                                <select class="vibe-select" id="vibe-select-category" style="font-family: monospace, -apple-system, BlinkMacSystemFont, sans-serif;">
                                    <option value="">-- Đang tải cây danh mục... --</option>
                                </select>
                                <div id="vibe-category-path-indicator" style="font-size: 11px; font-weight: 600; color: #2563eb; margin-top: 4px; display: none;"></div>
                            </div>

                            <!-- Bộ sưu tập -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-collection">
                                    <span>Bộ sưu tập</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-collection">
                                    <option value="">-- Đang tải bộ sưu tập... --</option>
                                </select>
                            </div>

                            <!-- Template giao diện chi tiết (Product Page Template) -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-page-template" style="display: flex; justify-content: space-between; align-items: center;">
                                    <span>Template giao diện chi tiết</span>
                                    <span class="vibe-form-label-hint">16vibe Page Template</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-page-template">
                                    <option value="">-- Mặc định theo danh mục (hoặc chọn template) --</option>
                                </select>
                            </div>

                            <!-- Loại sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-type">Loại sản phẩm</label>
                                <input type="text" class="vibe-input" id="vibe-input-type" value="Shirt" placeholder="Ví dụ: Shirt, Hoodie...">
                            </div>

                            <!-- Giá cơ bản & Tiền tệ -->
                            <div class="vibe-form-group-row">
                                <div class="vibe-form-group" style="flex: 1;">
                                    <label class="vibe-form-label" for="vibe-input-base-price">Giá cơ bản</label>
                                    <input type="number" class="vibe-input" id="vibe-input-base-price" value="23.95" step="0.01" min="0">
                                    <div class="vibe-field-desc" style="padding-left: 0;">Đây là giá của sản phẩm.</div>
                                </div>
                                <div class="vibe-form-group" style="flex: 1;">
                                    <label class="vibe-form-label" for="vibe-select-currency">Tiền tệ</label>
                                    <select class="vibe-select" id="vibe-select-currency">
                                        <option value="usd" selected>USD (mặc định của store)</option>
                                        <option value="vnd">VND</option>
                                        <option value="eur">EUR</option>
                                    </select>
                                </div>
                            </div>

                            <!-- Tồn kho -->
                            <div class="vibe-checkbox-row">
                                <label class="vibe-checkbox-label">
                                    <input type="checkbox" id="vibe-chk-track-inventory">
                                    <span>Theo dõi tồn kho và đặt số lượng</span>
                                </label>
                                <div class="vibe-field-desc">Tắt: biến thể không bị theo dõi tồn kho và luôn mua được.</div>
                            </div>



                            <!-- Thẻ phân loại (Tags) -->
                            <div class="vibe-form-group" style="margin-top: 10px;">
                                <label class="vibe-form-label" for="vibe-input-tags">
                                    <span>Thẻ phân loại (Tags)</span>
                                    <span class="vibe-form-label-hint">Phân cách bằng dấu phẩy</span>
                                </label>
                                <input type="text" class="vibe-input" id="vibe-input-tags" value="t-shirt, 16vibe, ecomlap" placeholder="Cách nhau bằng dấu phẩy...">
                                
                                <div style="margin-top: 8px;">
                                    <div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 5px; display: flex; align-items: center; justify-content: space-between;">
                                        <span>🏷️ Gợi ý thẻ từ Inkvibe (Click để thêm):</span>
                                        <span id="vibe-tags-count-label" style="color: #94a3b8; font-weight: 400;">0 thẻ</span>
                                    </div>
                                    <div class="vibe-badges-container" id="vibe-inkvibe-tags-list" style="max-height: 80px; overflow-y: auto; padding: 2px 0;">
                                        <!-- Inkvibe tags rendered dynamically -->
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>

                    <!-- Full-Width: Quản lý Biến thể (Variants) -->
                    <div class="vibe-card vibe-variants-card" style="grid-column: 1 / -1;">
                        <div class="vibe-card-title">🧩 Biến thể sản phẩm (Variants)</div>

                        <!-- Checkbox 1: Bán như sản phẩm đơn -->
                        <div class="vibe-checkbox-row">
                            <label class="vibe-checkbox-label">
                                <input type="checkbox" id="vibe-chk-single-product" checked>
                                <span>Bán như một sản phẩm đơn (bỏ biến thể)</span>
                            </label>
                            <div class="vibe-field-desc">Sản phẩm lên Medusa dưới dạng một mặt hàng duy nhất, không có tuỳ chọn (1 giá cố định). Nếu chọn cấu hình cá nhân hóa ở trên, trang chi tiết sản phẩm trên Storefront sẽ tự động hiển thị nút và Modal Customize.</div>
                        </div>

                        <!-- Checkbox 2: Tạo lại biến thể -->
                        <div class="vibe-checkbox-row" style="margin-top: 10px;">
                            <label class="vibe-checkbox-label">
                                <input type="checkbox" id="vibe-chk-recreate-variants">
                                <span>Tạo lại biến thể</span>
                            </label>
                            <div class="vibe-field-desc">Áp cho tất cả sản phẩm đã chọn: cùng màu, kích thước, giá và số lượng. Mỗi sản phẩm chỉ khác nhau ở SKU riêng của nó.</div>
                        </div>

                        <!-- Khối tạo ma trận biến thể ("Tạo lại biến thể") -->
                        <div class="vibe-variant-builder-box" id="vibe-variant-builder-box" style="display: none;">
                            <div class="vibe-variant-matrix-cols">
                                <!-- Cột Màu sắc -->
                                <div class="vibe-variant-matrix-col">
                                    <div class="vibe-matrix-col-header">
                                        <span>Màu sắc</span>
                                        <button type="button" class="vibe-btn-mini" id="vibe-btn-add-color">Thêm</button>
                                    </div>
                                    <div class="vibe-matrix-items-list" id="vibe-matrix-color-list"></div>
                                </div>

                                <!-- Cột Kích thước -->
                                <div class="vibe-variant-matrix-col">
                                    <div class="vibe-matrix-col-header">
                                        <span>Kích thước</span>
                                        <button type="button" class="vibe-btn-mini" id="vibe-btn-add-size">Thêm</button>
                                    </div>
                                    <div class="vibe-matrix-items-list" id="vibe-matrix-size-list"></div>
                                </div>
                            </div>

                            <!-- Matrix Actions -->
                            <div class="vibe-matrix-actions-row">
                                <button type="button" class="vibe-btn-matrix-primary" id="vibe-btn-generate-matrix">
                                    <span>⚙️ Tạo biến thể (<span id="vibe-matrix-count">6</span>)</span>
                                </button>
                                <button type="button" class="vibe-btn-matrix-secondary" id="vibe-btn-recalc-price">
                                    <span>Tính lại giá</span>
                                </button>
                            </div>

                            <!-- Explanatory Notes -->
                            <div class="vibe-matrix-notes">
                                <div>Giá = giá mặc định + giá cộng thêm của màu + của kích thước.</div>
                                <div>SKU tự sinh cho từng sản phẩm: SKU của chính nó + kích thước + màu. ví dụ <code class="vibe-sku-pill">PN-T1FR-8C3G-Small-Black</code></div>
                                <div>Tính lại giá giữ nguyên các dòng, chỉ tính lại giá.</div>
                            </div>
                        </div>

                        <!-- Bảng danh sách biến thể tùy chỉnh -->
                        <div class="vibe-variants-table-section" id="vibe-variants-table-section" style="display: none;">
                            <!-- Toolbar -->
                            <div class="vibe-variants-toolbar">
                                <button type="button" class="vibe-btn-tool" id="vibe-btn-reload-orig-variants">Tải lại từ sản phẩm gốc</button>
                                <button type="button" class="vibe-btn-tool" id="vibe-btn-add-custom-variant">Thêm biến thể</button>
                                <button type="button" class="vibe-btn-tool" id="vibe-btn-add-custom-option">Thêm tuỳ chọn</button>
                            </div>

                            <!-- Table Container -->
                            <div class="vibe-variants-table-container">
                                <table class="vibe-variants-table" id="vibe-variants-table">
                                    <thead id="vibe-variants-thead"></thead>
                                    <tbody id="vibe-variants-tbody"></tbody>
                                </table>
                            </div>

                            <!-- Batch Price Bar -->
                            <div class="vibe-batch-price-row">
                                <input type="number" class="vibe-batch-price-input" id="vibe-input-batch-price" placeholder="Giá" step="0.01" min="0">
                                <button type="button" class="vibe-btn-batch-apply" id="vibe-btn-apply-batch-price">Áp dụng cho tất cả</button>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Footer Sync All Box -->
                <div class="vibe-sync-all-wrap">
                    <label class="vibe-checkbox-label" style="margin-bottom: 6px;">
                        <input type="checkbox" id="vibe-chk-upload-to-b2" checked>
                        <span style="font-weight: 600;">☁️ Tải ảnh & upload lên Backblaze B2 (WebP)</span>
                    </label>
                    <div class="vibe-field-desc" style="margin-bottom: 12px;">Tự động tải toàn bộ ảnh sản phẩm từ Ecomlap, tối ưu nén WebP và upload trực tiếp vào B2 (<code>img.16vibe.com/products/{sku}/...</code>).</div>

                    <label class="vibe-checkbox-label">
                        <input type="checkbox" id="vibe-chk-sync-all">
                        <span>Tiếp tục cho đến khi link hết sản phẩm</span>
                    </label>
                    <div class="vibe-field-desc">Link những sản phẩm bạn đã chọn, rồi tiếp tục tải thêm theo đúng bộ lọc hiện tại và link tiếp, cho đến khi không còn gì. Từ lượt thứ hai trở đi hệ thống chọn TẤT CẢ sản phẩm trên trang, không chỉ vài cái.</div>
                </div>

                <!-- Footer Actions -->
                <div class="vibe-modal-footer">
                    <div class="vibe-footer-status">
                        <span class="vibe-status-pill" id="vibe-inkvibe-status">🟢 16vibe: api.16vibe.com</span>
                        <span id="vibe-footer-selected-count">Đã chọn 0 sản phẩm</span>
                    </div>
                    <div class="vibe-footer-actions">
                        <button type="button" class="vibe-btn vibe-btn-ghost" id="vibe-btn-cancel-modal">Hủy</button>
                        <button type="button" class="vibe-btn vibe-btn-primary" id="vibe-btn-submit-link">
                            <span>🚀 Liên kết sản phẩm</span>
                        </button>
                    </div>
                </div>
            </div>
        `;

        document.body.appendChild(overlay);
        modalElement = overlay;

        bindModalEvents(overlay);
        return overlay;
    }

    /**
     * Add tag to tags input field (avoiding duplicates)
     */
    function appendTagToInput(tag) {
        const input = document.getElementById('vibe-input-tags');
        if (!input || !tag) return;

        const currentTags = input.value.split(',').map(s => s.trim()).filter(Boolean);
        if (!currentTags.includes(tag)) {
            currentTags.push(tag);
            input.value = currentTags.join(', ');
        }
        input.focus();
    }

    /**
     * Update variants builder & table visibility based on single-product checkbox
     */
    function updateVariantsVisibility() {
        const chkSingle = document.getElementById('vibe-chk-single-product');
        const chkRecreate = document.getElementById('vibe-chk-recreate-variants');
        const builderBox = document.getElementById('vibe-variant-builder-box');
        const tableSection = document.getElementById('vibe-variants-table-section');

        const isSingle = chkSingle ? chkSingle.checked : true;

        if (isSingle) {
            if (chkRecreate) chkRecreate.checked = false;
            if (builderBox) builderBox.style.display = 'none';
            if (tableSection) tableSection.style.display = 'none';
        } else {
            const isRecreate = chkRecreate ? chkRecreate.checked : false;
            if (builderBox) builderBox.style.display = isRecreate ? 'block' : 'none';
            if (tableSection) tableSection.style.display = 'block';
        }
    }

    /**
     * Save modal form settings into chrome.storage.local
     */
    function saveModalFormState() {
        try {
            const config = {
                category_id: document.getElementById('vibe-select-category')?.value || '',
                collection_id: document.getElementById('vibe-select-collection')?.value || '',
                page_template_id: document.getElementById('vibe-select-page-template')?.value || '',
                personalization_id: document.getElementById('vibe-select-personalization')?.value || '',
                vendor_id: document.getElementById('vibe-select-vendor')?.value || 'admin',
                sales_channel_id: document.getElementById('vibe-select-sales-channel')?.value || '',
                shipping_profile_id: document.getElementById('vibe-select-shipping-profile')?.value || '',
                status: document.getElementById('vibe-select-status')?.value || 'published',
                product_type: document.getElementById('vibe-input-type')?.value || 'Shirt',
                base_price: parseFloat(document.getElementById('vibe-input-base-price')?.value || '23.95'),
                currency_code: document.getElementById('vibe-select-currency')?.value || 'usd',
                tags: document.getElementById('vibe-input-tags')?.value || '',
                upload_to_b2: document.getElementById('vibe-chk-upload-to-b2')?.checked ?? true,
                update_if_exists: document.getElementById('vibe-chk-update-if-exists')?.checked ?? true,
                single_product: document.getElementById('vibe-chk-single-product')?.checked ?? true,
                track_inventory: document.getElementById('vibe-chk-track-inventory')?.checked ?? false,
                updated_at: new Date().toISOString()
            };
            chrome.storage.local.set({ vibe_link_modal_config: config }, () => {
                console.log('[16vibe] Đã lưu cấu hình form modal:', config);
            });
        } catch (e) {
            console.warn('[16vibe] Lỗi khi lưu cấu hình form modal:', e);
        }
    }

    /**
     * Bind UI Events inside Modal
     */
    function bindModalEvents(overlay) {
        overlay.querySelector('#vibe-btn-close-modal').addEventListener('click', closeModal);
        overlay.querySelector('#vibe-btn-cancel-modal').addEventListener('click', closeModal);
        overlay.addEventListener('click', (e) => {
            if (e.target === overlay) closeModal();
        });

        // Track last focused input for placeholder insertion
        overlay.querySelectorAll('.vibe-track-focus').forEach(el => {
            el.addEventListener('focus', () => {
                lastActiveField = el;
            });
        });

        // Clickable placeholder badges
        overlay.querySelectorAll('.vibe-badge-token').forEach(badge => {
            badge.addEventListener('click', () => {
                const token = badge.getAttribute('data-token');
                insertTokenAtCursor(token);
            });
        });

        // Refresh personalization button
        overlay.querySelector('#vibe-btn-refresh-pers').addEventListener('click', async () => {
            const btn = overlay.querySelector('#vibe-btn-refresh-pers');
            btn.style.transform = 'rotate(180deg)';
            await loadPersonalizationDropdown();
            setTimeout(() => { btn.style.transform = 'none'; }, 400);
        });

        // Refresh metadata button (Categories, Collections, Tags, Vendors)
        overlay.querySelector('#vibe-btn-refresh-metadata')?.addEventListener('click', async () => {
            const btn = overlay.querySelector('#vibe-btn-refresh-metadata');
            if (btn) {
                btn.textContent = '⏳ Đang tải...';
                btn.disabled = true;
            }
            try {
                await loadInkvibeMetadataDropdowns(true);
                if (btn) btn.textContent = '✓ Đã xong';
                setTimeout(() => { if (btn) { btn.textContent = '🔄 Làm mới'; btn.disabled = false; } }, 1200);
            } catch (err) {
                if (btn) btn.textContent = '❌ Lỗi';
                setTimeout(() => { if (btn) { btn.textContent = '🔄 Làm mới'; btn.disabled = false; } }, 1500);
            }
        });

        // Variant Builder & Matrix Events
        overlay.querySelector('#vibe-btn-add-color')?.addEventListener('click', () => {
            matrixColors.push({ name: '', extra: 0 });
            renderMatrixLists();
        });

        overlay.querySelector('#vibe-btn-add-size')?.addEventListener('click', () => {
            matrixSizes.push({ name: '', extra: 0 });
            renderMatrixLists();
        });

        overlay.querySelector('#vibe-btn-generate-matrix')?.addEventListener('click', generateVariantsFromMatrix);
        overlay.querySelector('#vibe-btn-recalc-price')?.addEventListener('click', recalculateVariantPrices);

        overlay.querySelector('#vibe-btn-reload-orig-variants')?.addEventListener('click', reloadFromOriginalProduct);
        overlay.querySelector('#vibe-btn-add-custom-variant')?.addEventListener('click', addCustomVariantRow);
        overlay.querySelector('#vibe-btn-add-custom-option')?.addEventListener('click', addCustomOptionColumn);
        overlay.querySelector('#vibe-btn-apply-batch-price')?.addEventListener('click', applyBatchPrice);

        // Checkbox toggles
        const chkSingle = overlay.querySelector('#vibe-chk-single-product');
        const chkRecreate = overlay.querySelector('#vibe-chk-recreate-variants');

        chkSingle?.addEventListener('change', () => {
            if (chkSingle.checked && chkRecreate) {
                chkRecreate.checked = false;
            }
            updateVariantsVisibility();
            saveModalFormState();
        });

        chkRecreate?.addEventListener('change', () => {
            if (chkRecreate.checked && chkSingle) {
                chkSingle.checked = false;
            }
            updateVariantsVisibility();
            saveModalFormState();
        });

        // Auto-save form state on any input/select change
        [
            'vibe-select-category',
            'vibe-select-collection',
            'vibe-select-page-template',
            'vibe-select-personalization',
            'vibe-select-vendor',
            'vibe-select-sales-channel',
            'vibe-select-shipping-profile',
            'vibe-select-status',
            'vibe-input-type',
            'vibe-input-base-price',
            'vibe-select-currency',
            'vibe-input-tags',
            'vibe-chk-upload-to-b2',
            'vibe-chk-update-if-exists',
            'vibe-chk-track-inventory'
        ].forEach(id => {
            overlay.querySelector('#' + id)?.addEventListener('change', saveModalFormState);
        });

        // Initialize variants visibility
        updateVariantsVisibility();

        // Submit link
        overlay.querySelector('#vibe-btn-submit-link').addEventListener('click', handleLinkSubmit);
    }

    /**
     * Insert dynamic token into active input or default to Title
     */
    function insertTokenAtCursor(token) {
        const target = lastActiveField || document.getElementById('vibe-input-title');
        if (!target) return;

        const start = target.selectionStart || 0;
        const end = target.selectionEnd || 0;
        const val = target.value || '';

        target.value = val.substring(0, start) + token + val.substring(end);
        target.selectionStart = target.selectionEnd = start + token.length;
        target.focus();
    }

    /**
     * Render the 2-column matrix lists (Color & Size)
     */
    function renderMatrixLists() {
        const colorList = document.getElementById('vibe-matrix-color-list');
        const sizeList = document.getElementById('vibe-matrix-size-list');
        const countSpan = document.getElementById('vibe-matrix-count');

        if (countSpan) {
            const count = matrixColors.length * matrixSizes.length;
            countSpan.textContent = count > 0 ? count : 0;
        }

        if (colorList) {
            colorList.innerHTML = '';
            matrixColors.forEach((item, idx) => {
                const row = document.createElement('div');
                row.className = 'vibe-matrix-item-row';
                row.innerHTML = `
                    <input type="text" class="vibe-matrix-name-input" value="${item.name || ''}" placeholder="Tên màu">
                    <input type="number" step="0.01" class="vibe-matrix-extra-price-input" value="${item.extra !== undefined && item.extra !== null ? item.extra : ''}" placeholder="Giá cộng thêm cho màu">
                    <button type="button" class="vibe-btn-remove-row" title="Xóa">✕</button>
                `;

                const nameInput = row.querySelector('.vibe-matrix-name-input');
                const extraInput = row.querySelector('.vibe-matrix-extra-price-input');
                const removeBtn = row.querySelector('.vibe-btn-remove-row');

                nameInput.addEventListener('input', () => {
                    item.name = nameInput.value.trim();
                });
                extraInput.addEventListener('input', () => {
                    item.extra = parseFloat(extraInput.value) || 0;
                });
                removeBtn.addEventListener('click', () => {
                    matrixColors.splice(idx, 1);
                    renderMatrixLists();
                });

                colorList.appendChild(row);
            });
        }

        if (sizeList) {
            sizeList.innerHTML = '';
            matrixSizes.forEach((item, idx) => {
                const row = document.createElement('div');
                row.className = 'vibe-matrix-item-row';
                row.innerHTML = `
                    <input type="text" class="vibe-matrix-name-input" value="${item.name || ''}" placeholder="Tên kích thước">
                    <input type="number" step="0.01" class="vibe-matrix-extra-price-input" value="${item.extra !== undefined && item.extra !== null ? item.extra : ''}" placeholder="Giá cộng thêm cho kích thước">
                    <button type="button" class="vibe-btn-remove-row" title="Xóa">✕</button>
                `;

                const nameInput = row.querySelector('.vibe-matrix-name-input');
                const extraInput = row.querySelector('.vibe-matrix-extra-price-input');
                const removeBtn = row.querySelector('.vibe-btn-remove-row');

                nameInput.addEventListener('input', () => {
                    item.name = nameInput.value.trim();
                });
                extraInput.addEventListener('input', () => {
                    item.extra = parseFloat(extraInput.value) || 0;
                });
                removeBtn.addEventListener('click', () => {
                    matrixSizes.splice(idx, 1);
                    renderMatrixLists();
                });

                sizeList.appendChild(row);
            });
        }
    }

    /**
     * Render the custom variants table
     */
    function renderVariantsTable() {
        const thead = document.getElementById('vibe-variants-thead');
        const tbody = document.getElementById('vibe-variants-tbody');
        if (!thead || !tbody) return;

        // Render Table Header
        thead.innerHTML = '';
        const headerTr = document.createElement('tr');

        tableOptionTitles.forEach((title, optIdx) => {
            const th = document.createElement('th');
            th.innerHTML = `
                <div class="vibe-table-header-input-wrap">
                    <input type="text" class="vibe-table-header-input" value="${title}">
                    <button type="button" class="vibe-btn-remove-row" style="width:20px;height:22px;font-size:10px;" title="Xóa cột">✕</button>
                </div>
            `;

            const input = th.querySelector('.vibe-table-header-input');
            const removeBtn = th.querySelector('.vibe-btn-remove-row');

            input.addEventListener('change', () => {
                const oldTitle = tableOptionTitles[optIdx];
                const newTitle = input.value.trim() || ('Option ' + (optIdx + 1));
                tableOptionTitles[optIdx] = newTitle;
                // Update keys in tableVariants
                tableVariants.forEach(v => {
                    if (v[oldTitle] !== undefined) {
                        v[newTitle] = v[oldTitle];
                        delete v[oldTitle];
                    }
                });
                renderVariantsTable();
            });

            removeBtn.addEventListener('click', () => {
                if (tableOptionTitles.length <= 1) {
                    showToast('Phải giữ lại ít nhất 1 cột thuộc tính!', 'error');
                    return;
                }
                const removedKey = tableOptionTitles[optIdx];
                tableOptionTitles.splice(optIdx, 1);
                tableVariants.forEach(v => { delete v[removedKey]; });
                renderVariantsTable();
            });

            headerTr.appendChild(th);
        });

        // Price header
        const priceTh = document.createElement('th');
        priceTh.style.width = '120px';
        priceTh.textContent = 'Giá';
        headerTr.appendChild(priceTh);

        // Actions header
        const actionTh = document.createElement('th');
        actionTh.style.width = '36px';
        headerTr.appendChild(actionTh);

        thead.appendChild(headerTr);

        // Render Table Body
        tbody.innerHTML = '';
        tableVariants.forEach((v, rIdx) => {
            const tr = document.createElement('tr');

            tableOptionTitles.forEach(optTitle => {
                const td = document.createElement('td');
                const val = v[optTitle] !== undefined ? v[optTitle] : '';
                const input = document.createElement('input');
                input.type = 'text';
                input.className = 'vibe-table-cell-input';
                input.value = val;
                input.addEventListener('input', () => {
                    v[optTitle] = input.value;
                });
                td.appendChild(input);
                tr.appendChild(td);
            });

            // Price column
            const priceTd = document.createElement('td');
            const priceInput = document.createElement('input');
            priceInput.type = 'number';
            priceInput.step = '0.01';
            priceInput.className = 'vibe-table-price-input';
            priceInput.value = v.price !== undefined ? v.price : '29.95';
            priceInput.addEventListener('input', () => {
                v.price = parseFloat(priceInput.value) || 0;
            });
            priceTd.appendChild(priceInput);
            tr.appendChild(priceTd);

            // Delete action column
            const actionTd = document.createElement('td');
            const deleteBtn = document.createElement('button');
            deleteBtn.type = 'button';
            deleteBtn.className = 'vibe-btn-remove-row';
            deleteBtn.textContent = '✕';
            deleteBtn.title = 'Xóa biến thể này';
            deleteBtn.addEventListener('click', () => {
                tableVariants.splice(rIdx, 1);
                renderVariantsTable();
            });
            actionTd.appendChild(deleteBtn);
            tr.appendChild(actionTd);

            tbody.appendChild(tr);
        });
    }

    /**
     * Generate Cartesian Product Variants from Color & Size matrix
     */
    function generateVariantsFromMatrix() {
        const basePrice = parseFloat(document.getElementById('vibe-input-base-price')?.value || '23.95') || 23.95;
        const validColors = matrixColors.filter(c => c.name && c.name.trim());
        const validSizes = matrixSizes.filter(s => s.name && s.name.trim());

        if (validColors.length === 0 || validSizes.length === 0) {
            showToast('Vui lòng nhập ít nhất 1 màu và 1 kích thước để tạo biến thể!', 'error');
            return;
        }

        tableOptionTitles = ['Color', 'Size'];
        const newVariants = [];

        validColors.forEach(c => {
            validSizes.forEach(s => {
                const extra = (parseFloat(c.extra) || 0) + (parseFloat(s.extra) || 0);
                const finalPrice = parseFloat((basePrice + extra).toFixed(2));
                newVariants.push({
                    Color: c.name.trim(),
                    Size: s.name.trim(),
                    price: finalPrice
                });
            });
        });

        tableVariants = newVariants;
        renderVariantsTable();
        showToast('Đã tạo thành công ' + tableVariants.length + ' biến thể từ ma trận!', 'success');
    }

    /**
     * Recalculate price column without recreating rows
     */
    function recalculateVariantPrices() {
        const basePrice = parseFloat(document.getElementById('vibe-input-base-price')?.value || '23.95') || 23.95;
        const colorMap = new Map(matrixColors.map(c => [c.name.trim().toLowerCase(), parseFloat(c.extra) || 0]));
        const sizeMap = new Map(matrixSizes.map(s => [s.name.trim().toLowerCase(), parseFloat(s.extra) || 0]));

        tableVariants.forEach(v => {
            let extra = 0;
            if (v.Color && colorMap.has(v.Color.trim().toLowerCase())) {
                extra += colorMap.get(v.Color.trim().toLowerCase());
            }
            if (v.Size && sizeMap.has(v.Size.trim().toLowerCase())) {
                extra += sizeMap.get(v.Size.trim().toLowerCase());
            }
            v.price = parseFloat((basePrice + extra).toFixed(2));
        });

        renderVariantsTable();
        showToast('Đã tính lại giá cho toàn bộ ' + tableVariants.length + ' dòng biến thể!', 'success');
    }

    /**
     * Add a custom option column to table
     */
    function addCustomOptionColumn() {
        const optionName = prompt('Nhập tên tùy chọn mới (ví dụ: Material, Style, Fit...):', 'Material');
        if (!optionName || !optionName.trim()) return;

        const cleanName = optionName.trim();
        if (tableOptionTitles.includes(cleanName)) {
            showToast('Tùy chọn "' + cleanName + '" đã tồn tại!', 'error');
            return;
        }

        tableOptionTitles.push(cleanName);
        tableVariants.forEach(v => {
            v[cleanName] = 'Default';
        });

        renderVariantsTable();
        showToast('Đã thêm cột tùy chọn "' + cleanName + '" vào bảng biến thể!', 'success');
    }

    /**
     * Add an empty custom variant row
     */
    function addCustomVariantRow() {
        const basePrice = parseFloat(document.getElementById('vibe-input-base-price')?.value || '23.95') || 23.95;
        const newRow = {};
        tableOptionTitles.forEach((opt, idx) => {
            if (opt.toLowerCase() === 'color' && matrixColors[0]) {
                newRow[opt] = matrixColors[0].name || 'Black';
            } else if (opt.toLowerCase() === 'size' && matrixSizes[0]) {
                newRow[opt] = matrixSizes[0].name || 'Small';
            } else {
                newRow[opt] = 'Option ' + (idx + 1);
            }
        });
        newRow.price = basePrice;
        tableVariants.push(newRow);
        renderVariantsTable();
    }

    /**
     * Batch apply price to all variant rows
     */
    function applyBatchPrice() {
        const input = document.getElementById('vibe-input-batch-price');
        const val = parseFloat(input?.value);
        if (isNaN(val) || val < 0) {
            showToast('Vui lòng nhập giá hợp lệ!', 'error');
            return;
        }

        tableVariants.forEach(v => {
            v.price = parseFloat(val.toFixed(2));
        });

        renderVariantsTable();
        showToast('Đã áp dụng giá ' + val.toFixed(2) + ' cho toàn bộ biến thể!', 'success');
    }

    /**
     * Reload variants from original product
     */
    function reloadFromOriginalProduct() {
        const firstProd = currentSelectedProducts[0] || {};
        if (Array.isArray(firstProd.variants) && firstProd.variants.length > 0) {
            const rawVars = firstProd.variants;
            const titlesSet = new Set();
            rawVars.forEach(v => {
                if (v.options && typeof v.options === 'object') {
                    Object.keys(v.options).forEach(k => titlesSet.add(k));
                }
            });

            if (titlesSet.size > 0) {
                tableOptionTitles = Array.from(titlesSet);
                tableVariants = rawVars.map(v => {
                    const row = { ...(v.options || {}) };
                    row.price = parseFloat(v.price || v.amount || 23.95);
                    return row;
                });
                renderVariantsTable();
                showToast('Đã tải lại ' + tableVariants.length + ' biến thể từ sản phẩm gốc!', 'success');
                return;
            }
        }

        // Fallback to regenerating from matrix
        generateVariantsFromMatrix();
    }


    /**
     * Populate Personalization configs dropdown with real items
     */
    async function loadPersonalizationDropdown() {
        const select = document.getElementById('vibe-select-personalization');
        const hint = document.getElementById('vibe-hint-personalization-count');
        if (!select) return;

        let savedConfig = {};
        try {
            const st = await new Promise(r => chrome.storage.local.get(['vibe_link_modal_config'], r));
            if (st && st.vibe_link_modal_config) savedConfig = st.vibe_link_modal_config;
        } catch(e) {}
        const prevPersId = select.value || savedConfig.personalization_id || '';

        select.innerHTML = '<option value="">⏳ Đang nạp cấu hình cá nhân hóa từ Ecomlap...</option>';
        const list = await fetchPersonalizationConfigs();

        select.innerHTML = '';
        if (list.length === 0) {
            select.innerHTML = '<option value="">⚠️ Không tải được cấu hình - Bấm nút 🔄 để thử lại</option>';
            if (hint) hint.textContent = '0 cấu hình (Cần tải lại)';
            return;
        }

        if (hint) hint.textContent = list.length + ' cấu hình từ Ecomlap';

        list.forEach((item) => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.name;
            select.appendChild(opt);
        });

        if (prevPersId && Array.from(select.options).some(o => o.value === prevPersId)) {
            select.value = prevPersId;
        } else if (select.options.length > 0) {
            select.selectedIndex = 0;
        }
    }

    /**
     * Populate Inkvibe Metadata dropdowns (tree categories, collections & tags)
     */
    async function loadInkvibeMetadataDropdowns(forceRefresh = false) {
        const catSelect = document.getElementById('vibe-select-category');
        const colSelect = document.getElementById('vibe-select-collection');
        const tplSelect = document.getElementById('vibe-select-page-template');
        const vendorSelect = document.getElementById('vibe-select-vendor');
        const scSelect = document.getElementById('vibe-select-sales-channel');
        const spSelect = document.getElementById('vibe-select-shipping-profile');
        const pathIndicator = document.getElementById('vibe-category-path-indicator');

        // Read saved form config from storage
        let savedConfig = {};
        try {
            const st = await new Promise(r => chrome.storage.local.get(['vibe_link_modal_config'], r));
            if (st && st.vibe_link_modal_config) savedConfig = st.vibe_link_modal_config;
        } catch(e) {}

        const prevCatId = (catSelect && catSelect.value) || savedConfig.category_id || '';
        const prevColId = (colSelect && colSelect.value) || savedConfig.collection_id || '';
        const prevTplId = (tplSelect && tplSelect.value) || savedConfig.page_template_id || '';
        const prevVendorId = (vendorSelect && vendorSelect.value) || savedConfig.vendor_id || 'admin';
        const prevScId = (scSelect && scSelect.value) || savedConfig.sales_channel_id || '';
        const prevSpId = (spSelect && spSelect.value) || savedConfig.shipping_profile_id || '';

        if (forceRefresh) {
            if (catSelect) catSelect.innerHTML = '<option value="">-- Đang tải cây danh mục từ 16vibe... --</option>';
            if (colSelect) colSelect.innerHTML = '<option value="">-- Đang tải bộ sưu tập từ 16vibe... --</option>';
            if (tplSelect) tplSelect.innerHTML = '<option value="">-- Đang tải template từ 16vibe... --</option>';
        }

        const data = await fetchInkvibeMetadata(forceRefresh);

        // 0. Vendors (Default: Admin or restored)
        if (vendorSelect) {
            vendorSelect.innerHTML = '';
            const adminOpt = document.createElement('option');
            adminOpt.value = 'admin';
            adminOpt.textContent = 'Admin (Chính sàn Inkvibe - Không hiển thị store)';
            vendorSelect.appendChild(adminOpt);

            if (Array.isArray(data.vendors)) {
                data.vendors.forEach(v => {
                    if (v.handle === 'admin' || v.id === 'admin') return;
                    const opt = document.createElement('option');
                    opt.value = v.id;
                    opt.textContent = (v.name || v.handle) + ' (@' + (v.handle || '') + ')';
                    vendorSelect.appendChild(opt);
                });
            }
            if (prevVendorId && Array.from(vendorSelect.options).some(o => o.value === prevVendorId)) {
                vendorSelect.value = prevVendorId;
            } else {
                vendorSelect.value = 'admin';
            }
        }

        // 1. Sales Channels
        if (scSelect && data.salesChannels) {
            scSelect.innerHTML = '';
            data.salesChannels.forEach((sc) => {
                const opt = document.createElement('option');
                opt.value = sc.id;
                opt.textContent = sc.name || sc.title || sc.id;
                scSelect.appendChild(opt);
            });
            if (prevScId && Array.from(scSelect.options).some(o => o.value === prevScId)) {
                scSelect.value = prevScId;
            } else if (scSelect.options.length > 0) {
                scSelect.selectedIndex = 0;
            }
        }

        // 2. Shipping Profiles
        if (spSelect && data.shippingProfiles) {
            spSelect.innerHTML = '';
            data.shippingProfiles.forEach((sp) => {
                const opt = document.createElement('option');
                opt.value = sp.id;
                opt.textContent = sp.name || sp.title || sp.id;
                spSelect.appendChild(opt);
            });
            if (prevSpId && Array.from(spSelect.options).some(o => o.value === prevSpId)) {
                spSelect.value = prevSpId;
            } else if (spSelect.options.length > 0) {
                spSelect.selectedIndex = 0;
            }
        }

        // 3. Hierarchical Categories Tree
        const catHint = document.getElementById('vibe-hint-category-count');
        if (catSelect && data.categories) {
            catSelect.innerHTML = '';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '-- Chọn danh mục sản phẩm (hoặc để trống) --';
            catSelect.appendChild(emptyOpt);

            const treeNodes = buildCategoryTree(data.categories);
            if (catHint) catHint.textContent = treeNodes.length + ' danh mục dạng cây';

            treeNodes.forEach(node => {
                const opt = document.createElement('option');
                opt.value = node.id;
                opt.setAttribute('data-path', node.path);

                if (node.level === 0) {
                    opt.textContent = '📁 ' + node.name;
                    opt.style.fontWeight = 'bold';
                } else {
                    opt.textContent = node.prefix + '📄 ' + node.name;
                }
                catSelect.appendChild(opt);
            });

            // Restore category selection & breadcrumb
            if (prevCatId && Array.from(catSelect.options).some(o => o.value === prevCatId)) {
                catSelect.value = prevCatId;
                const selectedOpt = catSelect.options[catSelect.selectedIndex];
                const fullPath = selectedOpt ? selectedOpt.getAttribute('data-path') : '';
                if (pathIndicator) {
                    if (fullPath) {
                        pathIndicator.style.display = 'block';
                        pathIndicator.textContent = '📁 Đường dẫn: ' + fullPath;
                    } else {
                        pathIndicator.style.display = 'none';
                    }
                }
            } else if (pathIndicator) {
                pathIndicator.style.display = 'none';
            }

            // Update Breadcrumb path indicator on change
            catSelect.onchange = () => {
                const selectedOpt = catSelect.options[catSelect.selectedIndex];
                const fullPath = selectedOpt ? selectedOpt.getAttribute('data-path') : '';
                if (pathIndicator) {
                    if (fullPath) {
                        pathIndicator.style.display = 'block';
                        pathIndicator.textContent = '📁 Đường dẫn: ' + fullPath;
                    } else {
                        pathIndicator.style.display = 'none';
                    }
                }
                saveModalFormState();
            };
        }

        // 4. Collections
        if (colSelect && data.collections) {
            colSelect.innerHTML = '';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '-- Chọn bộ sưu tập (hoặc để trống) --';
            colSelect.appendChild(emptyOpt);

            data.collections.forEach(col => {
                const opt = document.createElement('option');
                opt.value = col.id;
                opt.textContent = col.title || col.name || col.id;
                colSelect.appendChild(opt);
            });

            if (prevColId && Array.from(colSelect.options).some(o => o.value === prevColId)) {
                colSelect.value = prevColId;
            }
        }

        // 4b. Product Page Templates
        const templateSelect = document.getElementById('vibe-select-page-template');
        const pageTemplates = data.page_templates || data.pageTemplates || [];
        if (templateSelect && Array.isArray(pageTemplates)) {
            templateSelect.innerHTML = '';
            const emptyOpt = document.createElement('option');
            emptyOpt.value = '';
            emptyOpt.textContent = '-- Mặc định theo danh mục (hoặc chọn template) --';
            templateSelect.appendChild(emptyOpt);

            pageTemplates.forEach(tpl => {
                const opt = document.createElement('option');
                opt.value = tpl.id;
                opt.textContent = (tpl.name || tpl.slug) + (tpl.is_default ? ' (Mặc định toàn sàn)' : '') + (tpl.slug ? ' [' + tpl.slug + ']' : '');
                templateSelect.appendChild(opt);
            });

            if (prevTplId && Array.from(templateSelect.options).some(o => o.value === prevTplId)) {
                templateSelect.value = prevTplId;
            }
        }

        // 5. Inkvibe Suggested Tags
        const tagsContainer = document.getElementById('vibe-inkvibe-tags-list');
        const tagsCountLabel = document.getElementById('vibe-tags-count-label');
        if (tagsContainer && Array.isArray(data.tags)) {
            tagsContainer.innerHTML = '';
            if (tagsCountLabel) tagsCountLabel.textContent = data.tags.length + ' thẻ';

            data.tags.forEach(tag => {
                const badge = document.createElement('span');
                badge.className = 'vibe-badge-tag';
                badge.textContent = '+ ' + tag;
                badge.addEventListener('click', () => {
                    appendTagToInput(tag);
                    badge.style.backgroundColor = '#dcfce7';
                    badge.style.borderColor = '#86efac';
                    badge.textContent = '✓ ' + tag;
                    setTimeout(() => {
                        badge.style.backgroundColor = '#f0fdf4';
                        badge.style.borderColor = '#86efac';
                        badge.textContent = '+ ' + tag;
                    }, 1200);
                });
                tagsContainer.appendChild(badge);
            });
        }

        // Status indicator
        const statusPill = document.getElementById('vibe-inkvibe-status');
        if (statusPill) {
            if (data.isLive) {
                statusPill.className = 'vibe-status-pill';
                statusPill.textContent = '🟢 16vibe Live (' + (data.categories?.length || 0) + ' cats, ' + (data.collections?.length || 0) + ' cols)';
            } else {
                statusPill.className = 'vibe-status-pill';
                statusPill.textContent = '🟢 16vibe: Ready';
            }
        }
    }

    /**
     * Render images preview
     */
    function renderImagesPreview(products) {
        const container = document.getElementById('vibe-img-preview-container');
        const countEl = document.getElementById('vibe-preview-img-count');
        if (!container) return;

        container.innerHTML = '';
        let totalImgs = 0;

        // Retrieve linked products map from storage
        chrome.storage.local.get(['linked_products_map'], (st) => {
            const linkedMap = (st && st.linked_products_map && typeof st.linked_products_map === 'object') ? st.linked_products_map : {};

            products.forEach((p, idx) => {
                const raw = p.raw || p;
                const imgUrl = raw.main_image_url || raw.main_image || p.main_image_url || p.image_url;
                if (imgUrl) {
                    totalImgs++;
                    const item = document.createElement('div');
                    item.className = 'vibe-img-preview-item';
                    const pName = extractProductName(p, idx);
                    const pid = String(p._id || p.id || p.sku || '');

                    const isLinked = (pid && linkedMap[pid]) ||
                        (imgUrl && linkedMap[imgUrl]) ||
                        (pName && linkedMap['name:' + pName.toLowerCase().trim()]);

                    item.title = (isLinked ? '✓ [Đã liên kết] ' : '') + pName;
                    
                    let badgeHtml = '';
                    if (isLinked) {
                        badgeHtml = `
                            <div class="vibe-linked-badge" title="Đã liên kết với Inkvibe">
                                <svg viewBox="0 0 24 24">
                                    <polyline points="20 6 9 17 4 12"></polyline>
                                </svg>
                            </div>
                        `;
                    }

                    item.innerHTML = '<img src="' + imgUrl + '" alt="" loading="lazy" onerror="this.src=\'data:image/svg+xml;utf8,<svg xmlns=\\\'http://www.w3.org/2000/svg\\\' width=\\\'' + 50 + '\\\' height=\\\'' + 50 + '\\\'><rect width=\\\'' + 50 + '\\\' height=\\\'' + 50 + '\\\' fill=\\\'%23f1f5f9\\\'/></svg>\'">' + badgeHtml;
                    container.appendChild(item);
                }
            });

            if (countEl) countEl.textContent = totalImgs;
        });
    }

    /**
     * Open Modal
     */
    function openModal(selectedProducts) {
        console.log('[16vibe] openModal called with:', selectedProducts);
        ensureModalStylesInjected();

        if (!Array.isArray(selectedProducts) || selectedProducts.length === 0) {
            selectedProducts = resolveCurrentSelectedProducts();
        }

        currentSelectedProducts = selectedProducts || [];
        console.log('[16vibe] currentSelectedProducts count:', currentSelectedProducts.length);

        const overlay = createModalDom();

        const subtitle = overlay.querySelector('#vibe-modal-subtitle');
        const footerCount = overlay.querySelector('#vibe-footer-selected-count');
        const titleInput = overlay.querySelector('#vibe-input-title');
        const handleInput = overlay.querySelector('#vibe-input-handle');

        if (currentSelectedProducts.length === 1) {
            const singleProd = currentSelectedProducts[0];
            const singleProdName = extractProductName(singleProd, 0);
            if (titleInput) titleInput.value = singleProdName;
            if (handleInput) handleInput.value = '';
            if (subtitle) {
                subtitle.textContent = 'Sản phẩm: ' + singleProdName;
            }
        } else if (currentSelectedProducts.length > 1) {
            if (titleInput) titleInput.value = '{{item_name}}';
            if (handleInput) handleInput.value = '';
            if (subtitle) {
                subtitle.textContent = 'Sẵn sàng đồng bộ ' + currentSelectedProducts.length + ' sản phẩm đã chọn vào Inkvibe Store';
            }
        } else {
            if (subtitle) {
                subtitle.textContent = 'Chưa chọn sản phẩm từ danh sách (Vui lòng chọn sản phẩm trên bảng để liên kết)';
            }
        }
        if (footerCount) footerCount.textContent = 'Đã chọn ' + currentSelectedProducts.length + ' sản phẩm';

        renderImagesPreview(currentSelectedProducts);

        overlay.classList.add('active');
        overlay.style.setProperty('display', 'flex', 'important');
        overlay.style.setProperty('opacity', '1', 'important');
        overlay.style.setProperty('visibility', 'visible', 'important');
        overlay.style.setProperty('pointer-events', 'auto', 'important');
        overlay.style.setProperty('z-index', '2147483647', 'important');

        // Restore saved static form fields
        chrome.storage.local.get(['vibe_link_modal_config'], (st) => {
            const saved = st && st.vibe_link_modal_config;
            if (!saved) return;

            const statusEl = document.getElementById('vibe-select-status');
            if (statusEl && saved.status) statusEl.value = saved.status;

            const typeEl = document.getElementById('vibe-input-type');
            if (typeEl && saved.product_type) typeEl.value = saved.product_type;

            const priceEl = document.getElementById('vibe-input-base-price');
            if (priceEl && saved.base_price !== undefined) priceEl.value = saved.base_price;

            const currEl = document.getElementById('vibe-select-currency');
            if (currEl && saved.currency_code) currEl.value = saved.currency_code;

            const tagsEl = document.getElementById('vibe-input-tags');
            if (tagsEl && saved.tags !== undefined) tagsEl.value = saved.tags;

            const b2El = document.getElementById('vibe-chk-upload-to-b2');
            if (b2El && saved.upload_to_b2 !== undefined) b2El.checked = Boolean(saved.upload_to_b2);

            const updEl = document.getElementById('vibe-chk-update-if-exists');
            if (updEl && saved.update_if_exists !== undefined) updEl.checked = Boolean(saved.update_if_exists);

            const singleEl = document.getElementById('vibe-chk-single-product');
            const recreateEl = document.getElementById('vibe-chk-recreate-variants');
            if (singleEl && saved.single_product !== undefined) {
                singleEl.checked = Boolean(saved.single_product);
                if (recreateEl) recreateEl.checked = !singleEl.checked;
            }

            const invEl = document.getElementById('vibe-chk-track-inventory');
            if (invEl && saved.track_inventory !== undefined) invEl.checked = Boolean(saved.track_inventory);

            updateVariantsVisibility();
        });

        renderMatrixLists();
        renderVariantsTable();

        loadPersonalizationDropdown();
        loadInkvibeMetadataDropdowns();
    }

    /**
     * Close Modal
     */
    function closeModal() {
        console.log('[16vibe] closeModal called');
        saveModalFormState();
        const overlay = modalElement || document.getElementById('vibe-link-16vibe-modal');
        if (overlay) {
            overlay.classList.remove('active');
            overlay.style.setProperty('display', 'none', 'important');
            overlay.style.setProperty('opacity', '0', 'important');
            overlay.style.setProperty('visibility', 'hidden', 'important');
            overlay.style.setProperty('pointer-events', 'none', 'important');
        }
    }

    /**
     * Handle Link Products Submit
     */
    async function handleLinkSubmit() {
        const submitBtn = document.getElementById('vibe-btn-submit-link');
        if (!submitBtn || submitBtn.disabled) return;

        saveModalFormState();

        if (!currentSelectedProducts || currentSelectedProducts.length === 0) {
            showToast('Vui lòng chọn ít nhất 1 sản phẩm trước khi liên kết!', 'error');
            return;
        }

        const personalizationId = document.getElementById('vibe-select-personalization')?.value || '';
        const titleTemplate = document.getElementById('vibe-input-title')?.value || '{{item_name}}';
        const handleTemplate = document.getElementById('vibe-input-handle')?.value || '{{item_name}}';
        const updateIfExists = document.getElementById('vibe-chk-update-if-exists')?.checked ?? true;
        const descTemplate = document.getElementById('vibe-input-description')?.value || '{{product_description}}';
        const additionalImagesText = document.getElementById('vibe-input-additional-images')?.value || '';

        const status = document.getElementById('vibe-select-status')?.value || 'published';
        const vendorId = document.getElementById('vibe-select-vendor')?.value || 'admin';
        const salesChannelId = document.getElementById('vibe-select-sales-channel')?.value || '';
        const shippingProfileId = document.getElementById('vibe-select-shipping-profile')?.value || '';
        const selectedCategoryId = document.getElementById('vibe-select-category')?.value || '';
        const collectionId = document.getElementById('vibe-select-collection')?.value || '';
        const pageTemplateId = document.getElementById('vibe-select-page-template')?.value || '';
        const productType = document.getElementById('vibe-input-type')?.value || 'Shirt';
        const basePrice = parseFloat(document.getElementById('vibe-input-base-price')?.value || '23.95');
        const currencyCode = document.getElementById('vibe-select-currency')?.value || 'usd';
        const trackInventory = document.getElementById('vibe-chk-track-inventory')?.checked ?? false;
        const singleProduct = document.getElementById('vibe-chk-single-product')?.checked ?? true;
        const syncAll = document.getElementById('vibe-chk-sync-all')?.checked ?? false;
        const uploadToB2 = document.getElementById('vibe-chk-upload-to-b2')?.checked ?? true;

        const tags = (document.getElementById('vibe-input-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);

        // Parse additional images from textarea
        const additionalImages = additionalImagesText
            .split(/\r?\n|,/)
            .map(s => s.trim())
            .filter(Boolean);

        // Resolve ancestor chain for category_ids (parent -> child)
        const ancestorCategoryIds = getCategoryAncestorIds(selectedCategoryId, cachedCategoriesList);

        submitBtn.disabled = true;
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span>⏳ Đang liên kết & xử lý ảnh B2 (' + currentSelectedProducts.length + ' sp)...</span>';

        try {
            // Build dynamic options & variants from matrix / custom table if not single product
            let collectedOptions = [];
            let collectedVariants = [];

            if (!singleProduct) {
                collectedOptions = tableOptionTitles.map(title => {
                    const valSet = new Set();
                    tableVariants.forEach(v => {
                        if (v[title] !== undefined && String(v[title]).trim()) {
                            valSet.add(String(v[title]).trim());
                        }
                    });
                    if (valSet.size === 0) valSet.add('Default');
                    return {
                        title: title,
                        values: Array.from(valSet)
                    };
                });

                collectedVariants = tableVariants.map((v, idx) => {
                    const normOptions = {};
                    tableOptionTitles.forEach(title => {
                        normOptions[title] = String(v[title] || '').trim();
                    });
                    const optVals = Object.values(normOptions).filter(Boolean);
                    const vPrice = parseFloat(v.price) || basePrice;
                    return {
                        title: optVals.join(' / ') || ('Variant ' + (idx + 1)),
                        options: normOptions,
                        price: vPrice,
                        sku_suffix: optVals.map(s => String(s).replace(/[^a-zA-Z0-9_-]/g, '')).join('-')
                    };
                });
            }

            const selectedPersItem = (cachedPersonalizationConfigs || []).find(c => String(c.id) === String(personalizationId));
            const selectedPersRaw = selectedPersItem?.raw || selectedPersItem || null;

            const processedProducts = currentSelectedProducts.map((p, idx) => {
                const raw = p.raw || p;
                const name = extractProductName(p, idx);
                const sku = p.sku || raw.sku || raw._id || p._id || ('SKU-' + (idx + 1));
                const desc = p.description || raw.description || p.prompt || name;
                const brand = p.brand || raw.brand || '16vibe';
                const store = p.store_name || raw.store_name || 'Ecomlap Store';
                const bulletPoints = Array.isArray(p.bullet_points) ? p.bullet_points.join('\n') : (p.tags ? p.tags.join(', ') : '');

                function replacePlaceholders(str) {
                    if (!str) return '';
                    return str
                        .replace(/\{\{item_name\}\}/g, name)
                        .replace(/\{\{item_sku\}\}/g, sku)
                        .replace(/\{\{product_description\}\}/g, desc)
                        .replace(/\{\{brand_name\}\}/g, brand)
                        .replace(/\{\{store_name\}\}/g, store)
                        .replace(/\{\{bullet_points\}\}/g, bulletPoints)
                        .replace(/\{\{property:key\}\}/g, p.property || '');
                }

                let resolvedTitle = replacePlaceholders(titleTemplate).trim();
                if (!resolvedTitle || resolvedTitle === '{{item_name}}') {
                    resolvedTitle = name;
                }

                let resolvedHandle = '';
                if (handleTemplate && handleTemplate.trim() && handleTemplate.trim() !== '{{item_name}}') {
                    resolvedHandle = replacePlaceholders(handleTemplate)
                        .toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-+|-+$/g, '');
                }
                if (!resolvedHandle) {
                    resolvedHandle = resolvedTitle
                        .toLowerCase()
                        .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
                        .replace(/[^a-z0-9]+/g, '-')
                        .replace(/^-+|-+$/g, '');
                }
                if (!resolvedHandle) {
                    resolvedHandle = 'product-' + (sku ? String(sku).toLowerCase().replace(/[^a-z0-9]+/g, '-') : Date.now());
                }

                const resolvedDesc = replacePlaceholders(descTemplate) || desc || '';

                // Collect multi-images: main_image_url + other_image_url1..10 + additional
                const productImages = [];
                const mainImg = raw.main_image_url || raw.main_image || p.main_image_url || p.image_url || '';
                if (mainImg && typeof mainImg === 'string' && mainImg.trim()) {
                    productImages.push(mainImg.trim());
                }

                for (let i = 1; i <= 10; i++) {
                    const otherImg = raw['other_image_url' + i] || raw['other_image_' + i];
                    if (otherImg && typeof otherImg === 'string' && otherImg.trim()) {
                        productImages.push(otherImg.trim());
                    }
                }

                if (additionalImages.length > 0) {
                    additionalImages.forEach(url => {
                        if (url && !productImages.includes(url)) productImages.push(url);
                    });
                }

                const uniqueImages = Array.from(new Set(productImages));
                const finalThumbnail = uniqueImages.length > 0 ? uniqueImages[0] : (mainImg || '');

                const prodPersRaw = p.personalization_config_data || raw.personalization_config || raw.personalization || raw.customization || selectedPersRaw;

                return {
                    id: p._id || p.id || raw._id || raw.id || '',
                    _id: p._id || p.id || raw._id || raw.id || '',
                    sku: sku,
                    original_name: name,
                    main_image_url: mainImg,
                    image_url: mainImg,
                    external_id: sku,
                    ecomlap_id: p._id || p.id || raw._id || '',
                    title: resolvedTitle,
                    name: resolvedTitle,
                    item_name: resolvedTitle,
                    product_name: resolvedTitle,
                    handle: resolvedHandle,
                    description: resolvedDesc,
                    thumbnail: finalThumbnail,
                    images: uniqueImages,
                    category_ids: ancestorCategoryIds,
                    collection_id: collectionId,
                    tags: tags,
                    type: productType,
                    status: status,
                    vendor_id: vendorId,
                    sales_channel_id: salesChannelId,
                    shipping_profile_id: shippingProfileId,
                    base_price: basePrice,
                    currency_code: currencyCode,
                    track_inventory: trackInventory,
                    single_product: singleProduct,
                    update_if_exists: updateIfExists,
                    discountable: true,
                    max_quantity: 100,
                    personalization_config_id: personalizationId,
                    personalization_config_data: prodPersRaw,
                    product_page_template_id: pageTemplateId,
                    metadata: {
                        source: 'ecomlap',
                        external_id: sku,
                        ecomlap_id: p._id || p.id || '',
                        brand: brand,
                        store_name: store,
                        vendor_id: vendorId,
                        personalization_config_id: personalizationId,
                        personalization_config_data: prodPersRaw,
                        product_page_template_id: pageTemplateId,
                        linked_at: new Date().toISOString()
                    }
                };
            });

            const commonConfig = {
                personalization_config_id: personalizationId,
                personalization_config_data: selectedPersRaw,
                product_page_template_id: pageTemplateId,
                status: status,
                vendor_id: vendorId,
                sales_channel_id: salesChannelId,
                shipping_profile_id: shippingProfileId,
                category_ids: ancestorCategoryIds,
                collection_id: collectionId,
                product_type: productType,
                base_price: basePrice,
                currency_code: currencyCode,
                track_inventory: trackInventory,
                single_product: singleProduct,
                options: collectedOptions,
                variants: collectedVariants,
                update_if_exists: updateIfExists,
                upload_to_b2: uploadToB2,
                additional_images: additionalImages,
                tags: tags,
                discountable: true,
                max_quantity: 100,
                sync_all: syncAll
            };

            // Helper: Mark a chunk of products as linked in storage & dispatch event immediately
            const markItemsAsLinked = (items, pProducts) => {
                return new Promise((resolve) => {
                    chrome.storage.local.get(['linked_products_map'], (st) => {
                        const linkedMap = (st && st.linked_products_map && typeof st.linked_products_map === 'object') ? st.linked_products_map : {};
                        const nowIso = new Date().toISOString();

                        items.forEach((p, idx) => {
                            const raw = p.raw || p;
                            const proc = (pProducts && pProducts[idx]) || {};
                            const pid = String(p._id || p.id || raw._id || raw.id || proc._id || proc.id || p.sku || p.external_id || raw.sku || '').trim();
                            const pSku = String(p.sku || p.external_id || raw.sku || raw.external_id || proc.sku || proc.external_id || '').trim();
                            const pName = String(p.item_name || p.product_name || p.name || p.title || raw.item_name || raw.product_name || proc.title || proc.name || '').trim();

                            const imgs = [
                                p.main_image_url, p.image_url, p.thumbnail,
                                raw.main_image_url, raw.main_image, raw.image_url,
                                proc.main_image_url, proc.image_url, proc.thumbnail,
                                ...(Array.isArray(p.images) ? p.images : []),
                                ...(Array.isArray(raw.images) ? raw.images : []),
                                ...(Array.isArray(proc.images) ? proc.images : [])
                            ].filter(Boolean);

                            const entry = {
                                id: pid || pSku,
                                name: pName,
                                image_url: imgs[0] || '',
                                linked_at: nowIso,
                                status: 'linked'
                            };

                            if (pid) linkedMap[pid] = entry;
                            if (pSku) linkedMap[pSku] = entry;
                            if (pName) linkedMap['name:' + pName.toLowerCase().trim()] = entry;

                            imgs.forEach(u => {
                                if (typeof u === 'string' && u.trim().length > 5) {
                                    const trimmed = u.trim();
                                    linkedMap[trimmed] = entry;
                                    const clean = trimmed.split('?')[0].split('#')[0];
                                    if (clean) {
                                        linkedMap[clean] = entry;
                                        const fn = clean.split('/').pop();
                                        if (fn && fn.length > 5) linkedMap['fn:' + fn] = entry;
                                    }
                                }
                            });
                        });

                        chrome.storage.local.set({ linked_products_map: linkedMap }, () => {
                            window.dispatchEvent(new CustomEvent('16vibe-products-linked-local', {
                                detail: { linkedMap: linkedMap }
                            }));
                            resolve(linkedMap);
                        });
                    });
                });
            };

            // Divide into chunks of 5 products per batch to prevent server/gateway timeouts
            // and show live incremental progress + instant badges
            const CHUNK_SIZE = 5;
            const totalProducts = processedProducts.length;
            const chunks = [];
            for (let i = 0; i < totalProducts; i += CHUNK_SIZE) {
                chunks.push({
                    products: processedProducts.slice(i, i + CHUNK_SIZE),
                    selectedItems: currentSelectedProducts.slice(i, i + CHUNK_SIZE),
                    startIndex: i
                });
            }

            const totalChunks = chunks.length;
            let totalSuccess = 0;
            let totalCreated = 0;
            let totalUpdated = 0;
            let failedCount = 0;
            let lastErrorMessage = '';

            const cancelBtn = document.getElementById('vibe-btn-cancel-modal');
            if (cancelBtn) cancelBtn.disabled = true;

            for (let cIdx = 0; cIdx < totalChunks; cIdx++) {
                const chunk = chunks[cIdx];
                const currentCount = Math.min(chunk.startIndex + chunk.products.length, totalProducts);
                const percent = Math.round((currentCount / totalProducts) * 100);

                submitBtn.innerHTML = `
                    <svg class="animate-spin" style="width:16px;height:16px;display:inline-block;vertical-align:middle;margin-right:6px;" viewBox="0 0 24 24" fill="none">
                        <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                        <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
                    </svg>
                    Đang liên kết [${currentCount}/${totalProducts}] (${percent}%)...
                `;

                const footerCountEl = document.getElementById('vibe-footer-selected-count');
                if (footerCountEl) {
                    footerCountEl.innerHTML = `<span style="color:#0ea5e9;font-weight:600;">⏳ Đang xử lý mẻ ${cIdx + 1}/${totalChunks} (${chunk.products.length} sp)...</span>`;
                }

                const chunkPayload = {
                    config: commonConfig,
                    products: chunk.products
                };

                const res = await new Promise((resolve) => {
                    chrome.runtime.sendMessage({
                        action: 'linkProductsToInkvibe',
                        data: chunkPayload
                    }, (r) => resolve(r));
                });

                if (res && res.success) {
                    totalSuccess += chunk.products.length;
                    if (res.created_count) totalCreated += res.created_count;
                    if (res.updated_count) totalUpdated += res.updated_count;

                    // Immediately mark these items as linked in storage & dispatch local event
                    // so green checkmark badges appear for this batch right now!
                    await markItemsAsLinked(chunk.selectedItems, chunk.products);
                } else {
                    failedCount += chunk.products.length;
                    lastErrorMessage = (res && res.error) || 'Lỗi server khi liên kết';
                    console.error('[16vibe] Chunk link failed:', chunk, res);

                    // If unauthorized/bad key, stop early to avoid hammering invalid credentials
                    if (res && (res.status === 401 || res.status === 403 || String(res.error).toLowerCase().includes('unauthorized') || String(res.error).toLowerCase().includes('secret'))) {
                        break;
                    }
                }
            }

            if (cancelBtn) cancelBtn.disabled = false;
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;

            const footerCountEl = document.getElementById('vibe-footer-selected-count');
            if (footerCountEl) {
                footerCountEl.textContent = `Đã chọn ${totalProducts} sản phẩm`;
            }

            if (totalSuccess > 0) {
                if (failedCount === 0) {
                    showToast(`🎉 Đã liên kết thành công toàn bộ ${totalSuccess} sản phẩm sang Inkvibe!`, 'success');
                    setTimeout(closeModal, 1500);
                } else {
                    showToast(`⚠️ Đã liên kết ${totalSuccess}/${totalProducts} sản phẩm (${failedCount} sản phẩm lỗi: ${lastErrorMessage})`, 'warning');
                }
            } else {
                showToast(`❌ Thất bại: ${lastErrorMessage || 'Lỗi liên kết sản phẩm sang Inkvibe'}`, 'error');
            }

        } catch (err) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            showToast('Lỗi khi xử lý liên kết sản phẩm: ' + err.message, 'error');
        }
    }

    /**
     * Helper to resolve currently selected products from all possible stores
     */
    function resolveCurrentSelectedProducts() {
        // 1. Try Zustand store
        try {
            if (typeof window !== 'undefined' && window.__16vibe_store && typeof window.__16vibe_store.getState === 'function') {
                const st = window.__16vibe_store.getState();
                let list = [];
                if (typeof st.getSelectedIdeas === 'function') {
                    const sel = st.getSelectedIdeas();
                    if (Array.isArray(sel) && sel.length > 0) list = sel;
                }
                if (list.length === 0) {
                    const selIds = st.selectedIds || [];
                    const allProds = st.ideas || st.products || [];
                    if (selIds.length > 0 && allProds.length > 0) {
                        list = allProds.filter(p => selIds.some(sid => String(sid) === String(p._id || p.id || p.sku)));
                    }
                }
                if (list.length > 0) {
                    return list.map((p, idx) => {
                        const trueName = extractProductName(p, idx);
                        return {
                            ...p,
                            name: trueName,
                            title: trueName,
                            item_name: trueName,
                            product_name: trueName
                        };
                    });
                }
            }
        } catch (e) {}

        // 2. Try checked checkboxes in DOM
        try {
            const domChecks = document.querySelectorAll('input.item-checkbox:checked, input.select-checkbox:checked, input[type="checkbox"]:checked');
            const foundFromDom = [];
            domChecks.forEach((cb, idx) => {
                const tr = cb.closest('tr') || cb.closest('.product-card') || cb.closest('.item-row');
                if (tr) {
                    const img = tr.querySelector('img')?.src || '';
                    const title = extractTitleFromRow(tr);
                    const id = cb.value || cb.dataset.id || tr.dataset.id || '';
                    if (id || title) {
                        const finalName = title || ('Sản phẩm #' + (idx + 1));
                        foundFromDom.push({
                            _id: id || ('prod_' + (idx + 1)),
                            id: id,
                            name: finalName,
                            title: finalName,
                            item_name: finalName,
                            product_name: finalName,
                            image_url: img,
                            main_image_url: img
                        });
                    }
                }
            });
            if (foundFromDom.length > 0) return foundFromDom;
        } catch (e) {}

        return [];
    }

    // Expose functions globally on window
    window.__16vibe_openLinkModal = openModal;
    window.__16vibe_closeLinkModal = closeModal;

    // Listen for custom event dispatched by gemini-content.js
    window.addEventListener('16vibe-open-link-modal', (e) => {
        console.log('[16vibe] 16vibe-open-link-modal event received:', e.detail);
        const ideas = (e && e.detail && (e.detail.ideas || e.detail.products)) || [];
        openModal(ideas);
    });

    // Capture-phase document click listener for guaranteed click capture
    document.addEventListener('click', (e) => {
        const target = e.target;
        if (!target) return;

        // If clicking inside the modal dialog itself, do NOT intercept as "open modal"
        if (target.closest('#vibe-link-16vibe-modal')) {
            return;
        }

        const btn = target.closest('button, [role="button"], a, .btn, .ant-btn') || target;
        const text = (btn.innerText || btn.textContent || target.innerText || target.textContent || '').trim();
        const title = (btn.getAttribute('title') || target.getAttribute('title') || '').trim();
        const id = (btn.id || target.id || '');
        const className = (btn.className || '') + ' ' + (target.className || '');

        const isLinkVibeClick = 
            /link\s*16\s*vibe|cấu\s*hình\s*đã\s*chọn|liên\s*kết.*16vibe/i.test(text) ||
            /link\s*16\s*vibe|inkvibe/i.test(title) ||
            id.includes('link-16vibe') ||
            id.includes('btn-link-16vibe') ||
            className.includes('link-16vibe');

        if (isLinkVibeClick) {
            console.log('[16vibe] "Link 16vibe" clicked, intercepted by capture listener! Text:', text);
            e.preventDefault();
            e.stopPropagation();

            const selected = resolveCurrentSelectedProducts();
            openModal(selected);
        }
    }, true);

    // Expose global controller
    window.__16vibe_modal = {
        open: openModal,
        close: closeModal,
        getCategoryAncestorIds: getCategoryAncestorIds
    };

    console.log('[16vibe] Link 16vibe Modal loaded successfully.');
})();
