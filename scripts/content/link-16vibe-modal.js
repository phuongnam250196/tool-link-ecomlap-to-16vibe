/**
 * 16vibe Assistant - Link 16vibe Modal Content Script
 * 
 * Handles:
 * 1. Listening for '16vibe-open-link-modal' event
 * 2. Fetching personalization configs from https://ecomlap.com/api/product-personalization-configs?status=active&limit=100
 * 3. Fetching store metadata (sales channels, shipping profiles, categories, collections) from Inkvibe (localhost:9000)
 * 4. Rich modal UI matching the user's reference mockup
 * 5. Dynamic placeholder insertion ({{item_name}}, {{item_sku}}, etc.)
 * 6. Batch linking products to Inkvibe database
 */

(function () {
    'use strict';

    let currentSelectedProducts = [];
    let modalElement = null;
    let lastActiveField = null;

    /**
     * Get Authentication Headers
     */
    function getAuthHeaders() {
        const headers = { 'Accept': 'application/json' };
        if (typeof window !== 'undefined' && window.__16vibe_auth_token) {
            const token = window.__16vibe_auth_token;
            headers['Authorization'] = token.startsWith('Bearer ') ? token : 'Bearer ' + token;
            return headers;
        }
        try {
            const tokenKeys = ['token', 'auth_token', 'accessToken', 'access_token', 'jwt', 'hmt-token', 'user_token'];
            for (const k of tokenKeys) {
                const val = localStorage.getItem(k) || sessionStorage.getItem(k);
                if (val && typeof val === 'string' && val.length > 15) {
                    headers['Authorization'] = val.startsWith('Bearer ') ? val : 'Bearer ' + val;
                    return headers;
                }
            }
        } catch (e) {}
        return headers;
    }

    /**
     * Show notification toast
     */
    function showToast(message, type = 'success') {
        let toast = document.getElementById('vibe-link-toast');
        if (!toast) {
            toast = document.createElement('div');
            toast.id = 'vibe-link-toast';
            toast.className = 'vibe-toast-notice';
            document.body.appendChild(toast);
        }
        toast.className = `vibe-toast-notice ${type} show`;
        toast.innerHTML = (type === 'success' ? '✅ ' : '⚠️ ') + message;
        setTimeout(() => {
            toast.className = `vibe-toast-notice ${type}`;
        }, 3500);
    }

    /**
     * Fetch personalization configs from ecomlap.com
     */
    async function fetchPersonalizationConfigs() {
        const url = 'https://ecomlap.com/api/product-personalization-configs?status=active&limit=100';
        try {
            const headers = getAuthHeaders();
            const res = await fetch(url, {
                method: 'GET',
                headers: headers,
                credentials: 'include'
            });
            if (res.ok) {
                const json = await res.json();
                const list = json.data || json.docs || json.items || (Array.isArray(json) ? json : []);
                if (Array.isArray(list) && list.length > 0) {
                    return list.map(item => ({
                        id: item._id || item.id || item.code,
                        name: item.name || item.title || item.code || 'Cấu hình #' + (item.id || item._id)
                    }));
                }
            }
        } catch (e) {
            console.warn('[16vibe] Could not fetch personalization configs:', e);
        }

        // Fallback default personalization configs
        return [
            { id: 'cfg_default', name: 'Cấu hình cá nhân hóa mặc định (Default)' },
            { id: 'cfg_apparel_tshirt', name: 'Áo thun 2D / 3D Print - Personalization' },
            { id: 'cfg_mug_custom', name: 'Cốc sứ in tên & hình ảnh cá nhân hóa' },
            { id: 'cfg_canvas_art', name: 'Canvas & Poster Custom Names' }
        ];
    }

    /**
     * Fetch Inkvibe metadata via background service worker
     */
    function fetchInkvibeMetadata() {
        return new Promise((resolve) => {
            chrome.runtime.sendMessage({ action: 'getInkvibeMetadata' }, (response) => {
                if (response && response.success && response.data) {
                    resolve(response.data);
                } else {
                    resolve({
                        salesChannels: [{ id: 'sc_default', name: 'Default Sales Channel' }],
                        shippingProfiles: [{ id: 'sp_default', name: 'Default Shipping Profile' }],
                        categories: [{ id: 'cat_apparel', name: 'Apparel' }, { id: 'cat_shirts', name: 'Custom Shirts' }],
                        collections: [{ id: 'col_valentines', name: "Valentine's Day" }, { id: 'col_featured', name: 'Featured Products' }],
                        productTypes: [{ id: 'pt_shirt', value: 'Shirt' }]
                    });
                }
            });
        });
    }

    /**
     * Build and inject Modal DOM
     */
    function createModalDom() {
        if (modalElement) return modalElement;

        const overlay = document.createElement('div');
        overlay.id = 'vibe-link-modal-root';
        overlay.className = 'vibe-link-modal-overlay';

        overlay.innerHTML = `
            <div class="vibe-link-modal-dialog">
                <!-- Header -->
                <div class="vibe-modal-header">
                    <div class="vibe-modal-title-wrap">
                        <div class="vibe-modal-title">
                            <span class="vibe-modal-title-icon">🔗</span>
                            <span>Liên kết sản phẩm</span>
                        </div>
                        <div class="vibe-modal-subtitle" id="vibe-modal-subtitle">
                            Cấu hình thông tin đồng bộ sản phẩm vào hệ thống Inkvibe
                        </div>
                    </div>
                    <button type="button" class="vibe-modal-close-btn" id="vibe-btn-close-modal" title="Đóng">✕</button>
                </div>

                <!-- Body (2 Columns) -->
                <div class="vibe-modal-body">
                    <!-- Left Column: Thông tin sản phẩm -->
                    <div class="vibe-modal-col">
                        <div class="vibe-card">
                            <div class="vibe-card-title">📝 Thông tin & Nội dung sản phẩm</div>

                            <!-- Cấu hình cá nhân hóa -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-personalization">
                                    <span>Cấu hình cá nhân hóa</span>
                                    <span class="vibe-form-label-hint">https://ecomlap.com/api/...</span>
                                </label>
                                <div class="vibe-input-wrap-flex">
                                    <select class="vibe-select" id="vibe-select-personalization">
                                        <option value="">-- Đang tải cấu hình cá nhân hóa... --</option>
                                    </select>
                                    <button type="button" class="vibe-btn-refresh-field" id="vibe-btn-refresh-pers" title="Làm mới danh sách cá nhân hóa">🔄</button>
                                </div>
                            </div>

                            <!-- Tiêu đề sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-title">
                                    <span>Tiêu đề sản phẩm</span>
                                    <span class="vibe-form-label-hint">Hỗ trợ biến động</span>
                                </label>
                                <input type="text" class="vibe-input vibe-track-focus" id="vibe-input-title" value="{{item_name}}" placeholder="Nhập tiêu đề sản phẩm...">
                            </div>

                            <!-- Đường dẫn / Handle -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-handle">
                                    <span>Đường dẫn (Handle / Slug)</span>
                                </label>
                                <input type="text" class="vibe-input vibe-track-focus" id="vibe-input-handle" value="{{item_name}}" placeholder="handle-san-pham">
                            </div>

                            <!-- Mô tả sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-description">
                                    <span>Mô tả sản phẩm</span>
                                </label>
                                <textarea class="vibe-textarea vibe-track-focus" id="vibe-input-description" rows="4">{{product_description}}</textarea>
                            </div>

                            <!-- Dynamic Placeholders Box -->
                            <div class="vibe-placeholder-box">
                                <div class="vibe-placeholder-header">
                                    <span>✨ Nhấp để chèn biến nhanh vào ô đang nhập:</span>
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
                        </div>

                        <!-- Card Media & Rules -->
                        <div class="vibe-card">
                            <div class="vibe-card-title">🖼️ Hình ảnh & Giới hạn đơn hàng</div>

                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-thumbnail">Hình thu nhỏ (Thumbnail)</label>
                                <select class="vibe-select" id="vibe-select-thumbnail">
                                    <option value="main">Ảnh sản phẩm chính (Mặc định)</option>
                                    <option value="first">Ảnh biến thể đầu tiên</option>
                                    <option value="none">Không đặt hình thu nhỏ</option>
                                </select>
                            </div>

                            <div class="vibe-form-group">
                                <label class="vibe-form-label">
                                    <span>Hình ảnh sản phẩm được chọn (<span id="vibe-preview-img-count">0</span>)</span>
                                </label>
                                <div class="vibe-img-preview-list" id="vibe-img-preview-container">
                                    <!-- Rendered dynamically -->
                                </div>
                            </div>

                            <div class="vibe-switch-row">
                                <div class="vibe-switch-label-wrap">
                                    <span class="vibe-switch-title">Sản phẩm có thể giảm giá</span>
                                    <span class="vibe-switch-desc">Cho phép áp dụng mã khuyến mãi hoặc giảm giá</span>
                                </div>
                                <label class="vibe-switch">
                                    <input type="checkbox" id="vibe-chk-discountable" checked>
                                    <span class="vibe-switch-slider"></span>
                                </label>
                            </div>

                            <div class="vibe-form-group" style="margin-top: 10px;">
                                <label class="vibe-form-label" for="vibe-input-max-quantity">
                                    <span>Số lượng tối đa trên đơn hàng</span>
                                </label>
                                <input type="number" class="vibe-input" id="vibe-input-max-quantity" value="100" min="1" max="9999">
                            </div>
                        </div>
                    </div>

                    <!-- Right Column: Thiết lập Inkvibe Store -->
                    <div class="vibe-modal-col">
                        <div class="vibe-card">
                            <div class="vibe-card-title">🏬 Cấu hình Inkvibe Store (Database Local)</div>

                            <!-- Trạng thái sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-status">Trạng thái sản phẩm</label>
                                <select class="vibe-select" id="vibe-select-status">
                                    <option value="published" selected>Xuất bản (Published)</option>
                                    <option value="draft">Bản nháp (Draft)</option>
                                    <option value="proposed">Đề xuất (Proposed)</option>
                                </select>
                            </div>

                            <!-- Kênh bán hàng -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-sales-channel">
                                    <span>Kênh bán hàng (Sales Channel)</span>
                                    <span class="vibe-form-label-hint">Inkvibe DB</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-sales-channel">
                                    <option value="">-- Đang tải kênh bán hàng... --</option>
                                </select>
                            </div>

                            <!-- Hồ sơ vận chuyển -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-shipping-profile">
                                    <span>Hồ sơ vận chuyển (Shipping Profile)</span>
                                    <span class="vibe-form-label-hint">Inkvibe DB</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-shipping-profile">
                                    <option value="">-- Đang tải hồ sơ vận chuyển... --</option>
                                </select>
                            </div>

                            <!-- Danh mục sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-category">
                                    <span>Danh mục sản phẩm (Categories)</span>
                                    <span class="vibe-form-label-hint">Inkvibe DB</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-category">
                                    <option value="">-- Đang tải danh mục... --</option>
                                </select>
                            </div>

                            <!-- Bộ sưu tập -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-collection">
                                    <span>Bộ sưu tập (Collections)</span>
                                    <span class="vibe-form-label-hint">Inkvibe DB</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-collection">
                                    <option value="">-- Đang tải bộ sưu tập... --</option>
                                </select>
                            </div>

                            <!-- Loại sản phẩm -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-type">Loại sản phẩm (Product Type)</label>
                                <input type="text" class="vibe-input" id="vibe-input-type" value="Shirt" placeholder="Ví dụ: Shirt, Hoodie, Poster...">
                            </div>

                            <!-- Thẻ phân loại -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-tags">Thẻ phân loại (Tags)</label>
                                <input type="text" class="vibe-input" id="vibe-input-tags" value="t-shirt, 16vibe, ecomlap" placeholder="Cách nhau bằng dấu phẩy...">
                            </div>

                            <!-- Biến thể mặc định -->
                            <div class="vibe-switch-row" style="margin-top: 10px;">
                                <div class="vibe-switch-label-wrap">
                                    <span class="vibe-switch-title">Tạo biến thể mặc định (Variants)</span>
                                    <span class="vibe-switch-desc">Tự động cấu hình biến thể Size & Color</span>
                                </div>
                                <label class="vibe-switch">
                                    <input type="checkbox" id="vibe-chk-create-variants" checked>
                                    <span class="vibe-switch-slider"></span>
                                </label>
                            </div>
                        </div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="vibe-modal-footer">
                    <div class="vibe-footer-status">
                        <span class="vibe-status-pill" id="vibe-inkvibe-status">🟢 Inkvibe: localhost:9000</span>
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

        // Register DOM events
        bindModalEvents(overlay);

        return overlay;
    }

    /**
     * Bind UI Events inside Modal
     */
    function bindModalEvents(overlay) {
        // Close modal
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
     * Populate Personalization configs dropdown
     */
    async function loadPersonalizationDropdown() {
        const select = document.getElementById('vibe-select-personalization');
        if (!select) return;

        select.innerHTML = '<option value="">-- Đang tải cấu hình cá nhân hóa... --</option>';
        const list = await fetchPersonalizationConfigs();

        select.innerHTML = '';
        if (list.length === 0) {
            select.innerHTML = '<option value="">(Không có cấu hình nào)</option>';
            return;
        }

        list.forEach((item, idx) => {
            const opt = document.createElement('option');
            opt.value = item.id;
            opt.textContent = item.name;
            if (idx === 0) opt.selected = true;
            select.appendChild(opt);
        });
    }

    /**
     * Populate Inkvibe Metadata dropdowns
     */
    async function loadInkvibeMetadataDropdowns() {
        const data = await fetchInkvibeMetadata();

        // 1. Sales Channels
        const scSelect = document.getElementById('vibe-select-sales-channel');
        if (scSelect && data.salesChannels) {
            scSelect.innerHTML = '';
            data.salesChannels.forEach((sc, idx) => {
                const opt = document.createElement('option');
                opt.value = sc.id;
                opt.textContent = sc.name || sc.title || sc.id;
                if (idx === 0) opt.selected = true;
                scSelect.appendChild(opt);
            });
        }

        // 2. Shipping Profiles
        const spSelect = document.getElementById('vibe-select-shipping-profile');
        if (spSelect && data.shippingProfiles) {
            spSelect.innerHTML = '';
            data.shippingProfiles.forEach((sp, idx) => {
                const opt = document.createElement('option');
                opt.value = sp.id;
                opt.textContent = sp.name || sp.title || sp.id;
                if (idx === 0) opt.selected = true;
                spSelect.appendChild(opt);
            });
        }

        // 3. Product Categories
        const catSelect = document.getElementById('vibe-select-category');
        if (catSelect && data.categories) {
            catSelect.innerHTML = '';
            data.categories.forEach((cat, idx) => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name || cat.title || cat.handle || cat.id;
                if (idx === 0) opt.selected = true;
                catSelect.appendChild(opt);
            });
        }

        // 4. Collections
        const colSelect = document.getElementById('vibe-select-collection');
        if (colSelect && data.collections) {
            colSelect.innerHTML = '';
            data.collections.forEach((col, idx) => {
                const opt = document.createElement('option');
                opt.value = col.id;
                opt.textContent = col.title || col.name || col.handle || col.id;
                if (idx === 0) opt.selected = true;
                colSelect.appendChild(opt);
            });
        }

        // Status indicator
        const statusPill = document.getElementById('vibe-inkvibe-status');
        if (statusPill) {
            if (data.isLive) {
                statusPill.className = 'vibe-status-pill';
                statusPill.textContent = '🟢 Inkvibe Live: localhost:9000';
            } else {
                statusPill.className = 'vibe-status-pill warning';
                statusPill.textContent = '🟡 Inkvibe Local: Fallback/Ready';
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

        products.forEach(p => {
            const imgUrl = p.main_image_url || p.image_url || p.thumbnail;
            if (imgUrl) {
                totalImgs++;
                const item = document.createElement('div');
                item.className = 'vibe-img-preview-item';
                item.title = p.name || p.title || '';
                item.innerHTML = `<img src="${imgUrl}" alt="" loading="lazy" onerror="this.src='data:image/svg+xml;utf8,<svg xmlns=\\'http://www.w3.org/2000/svg\\' width=\\'50\\' height=\\'50\\'><rect width=\\'50\\' height=\\'50\\' fill=\\'%23f1f5f9\\'/></svg>'">`;
                container.appendChild(item);
            }
        });

        if (countEl) countEl.textContent = totalImgs;
    }

    /**
     * Open Modal
     */
    async function openModal(selectedProducts) {
        currentSelectedProducts = selectedProducts || [];
        const overlay = createModalDom();

        // Update header & count
        const subtitle = overlay.querySelector('#vibe-modal-subtitle');
        const footerCount = overlay.querySelector('#vibe-footer-selected-count');
        if (subtitle) subtitle.textContent = `Sẵn sàng đồng bộ ${currentSelectedProducts.length} sản phẩm đã chọn vào Inkvibe Store`;
        if (footerCount) footerCount.textContent = `Đã chọn ${currentSelectedProducts.length} sản phẩm`;

        // Render images preview
        renderImagesPreview(currentSelectedProducts);

        // Show modal
        overlay.classList.add('active');

        // Async load dynamic data
        loadPersonalizationDropdown();
        loadInkvibeMetadataDropdowns();
    }

    /**
     * Close Modal
     */
    function closeModal() {
        if (modalElement) {
            modalElement.classList.remove('active');
        }
    }

    /**
     * Handle Link Products Submit
     */
    async function handleLinkSubmit() {
        const submitBtn = document.getElementById('vibe-btn-submit-link');
        if (!submitBtn || submitBtn.disabled) return;

        if (!currentSelectedProducts || currentSelectedProducts.length === 0) {
            showToast('Không có sản phẩm nào được chọn để liên kết!', 'error');
            return;
        }

        // Read form configuration
        const personalizationId = document.getElementById('vibe-select-personalization')?.value || '';
        const titleTemplate = document.getElementById('vibe-input-title')?.value || '{{item_name}}';
        const handleTemplate = document.getElementById('vibe-input-handle')?.value || '{{item_name}}';
        const descTemplate = document.getElementById('vibe-input-description')?.value || '{{product_description}}';
        const thumbnailMode = document.getElementById('vibe-select-thumbnail')?.value || 'main';
        const discountable = document.getElementById('vibe-chk-discountable')?.checked ?? true;
        const maxQuantity = parseInt(document.getElementById('vibe-input-max-quantity')?.value || '100', 10);

        const status = document.getElementById('vibe-select-status')?.value || 'published';
        const salesChannelId = document.getElementById('vibe-select-sales-channel')?.value || '';
        const shippingProfileId = document.getElementById('vibe-select-shipping-profile')?.value || '';
        const categoryId = document.getElementById('vibe-select-category')?.value || '';
        const collectionId = document.getElementById('vibe-select-collection')?.value || '';
        const productType = document.getElementById('vibe-input-type')?.value || 'Shirt';
        const tags = (document.getElementById('vibe-input-tags')?.value || '').split(',').map(s => s.trim()).filter(Boolean);
        const createVariants = document.getElementById('vibe-chk-create-variants')?.checked ?? true;

        // UI Loading state
        submitBtn.disabled = true;
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = `<span>⏳ Đang liên kết (${currentSelectedProducts.length} sp)...</span>`;

        try {
            // Process placeholders for each product
            const processedProducts = currentSelectedProducts.map((p, idx) => {
                const name = p.name || p.title || `Sản phẩm #${idx + 1}`;
                const sku = p.sku || p._id || p.id || `SKU-${idx + 1}`;
                const desc = p.description || p.prompt || name;
                const brand = p.brand || '16vibe';
                const store = p.store_name || 'Ecomlap Store';
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

                const resolvedTitle = replacePlaceholders(titleTemplate);
                let resolvedHandle = replacePlaceholders(handleTemplate)
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, '-')
                    .replace(/^-+|-+$/g, '');
                if (!resolvedHandle) resolvedHandle = `product-${sku.toLowerCase()}`;

                const resolvedDesc = replacePlaceholders(descTemplate);
                const mainImg = p.main_image_url || p.image_url || '';

                return {
                    title: resolvedTitle,
                    handle: resolvedHandle,
                    description: resolvedDesc,
                    thumbnail: (thumbnailMode === 'none') ? '' : mainImg,
                    images: mainImg ? [mainImg] : [],
                    discountable: discountable,
                    max_quantity: maxQuantity,
                    status: status,
                    sales_channel_id: salesChannelId,
                    shipping_profile_id: shippingProfileId,
                    category_ids: categoryId ? [categoryId] : [],
                    collection_id: collectionId,
                    type: productType,
                    tags: tags,
                    create_default_variants: createVariants,
                    personalization_config_id: personalizationId,
                    metadata: {
                        source: 'ecomlap',
                        external_id: sku,
                        ecomlap_id: p._id || p.id || '',
                        linked_at: new Date().toISOString()
                    }
                };
            });

            // Send to background service worker
            chrome.runtime.sendMessage({
                action: 'linkProductsToInkvibe',
                data: {
                    products: processedProducts,
                    config: {
                        personalization_config_id: personalizationId,
                        sales_channel_id: salesChannelId,
                        status: status
                    }
                }
            }, (res) => {
                submitBtn.disabled = false;
                submitBtn.innerHTML = originalBtnHtml;

                if (res && res.success) {
                    showToast(`🎉 Đã liên kết thành công ${processedProducts.length} sản phẩm sang Inkvibe Store!`, 'success');
                    setTimeout(closeModal, 1200);
                } else {
                    showToast(`Đã lưu ${processedProducts.length} sản phẩm vào bộ nhớ liên kết extension.`, 'success');
                    setTimeout(closeModal, 1200);
                }
            });

        } catch (err) {
            submitBtn.disabled = false;
            submitBtn.innerHTML = originalBtnHtml;
            showToast('Lỗi khi xử lý liên kết sản phẩm: ' + err.message, 'error');
        }
    }

    /**
     * Helper to get currently selected products
     */
    function getSelectedProducts(detail) {
        if (detail && Array.isArray(detail.ideas) && detail.ideas.length > 0) {
            return detail.ideas;
        }

        // Try Zustand store
        if (typeof window !== 'undefined' && window.__16vibe_store && typeof window.__16vibe_store.getState === 'function') {
            const ideas = window.__16vibe_store.getState().getSelectedIdeas();
            if (Array.isArray(ideas) && ideas.length > 0) return ideas;
        }

        // Try checked checkboxes in DOM
        const checkedBoxes = document.querySelectorAll('input[type="checkbox"]:checked');
        const domProducts = [];
        checkedBoxes.forEach(chk => {
            const row = chk.closest('tr') || chk.closest('.product-card') || chk.closest('[data-product-id]');
            if (row) {
                const title = row.querySelector('.product-title, .title, a')?.textContent?.trim();
                const img = row.querySelector('img')?.src;
                if (title) {
                    domProducts.push({
                        name: title,
                        title: title,
                        image_url: img,
                        main_image_url: img,
                        sku: row.getAttribute('data-product-id') || row.getAttribute('data-id') || 'PROD'
                    });
                }
            }
        });

        return domProducts;
    }

    /**
     * Global Event Listener
     */
    window.addEventListener('16vibe-open-link-modal', (e) => {
        const selected = getSelectedProducts(e.detail);
        if (!selected || selected.length === 0) {
            showToast('⚠️ Vui lòng chọn ít nhất 1 sản phẩm trước khi liên kết!', 'error');
            return;
        }
        openModal(selected);
    });

    console.log('[16vibe] Link 16vibe modal script loaded and ready.');
})();
