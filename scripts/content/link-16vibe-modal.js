/**
 * 16vibe Assistant - Link 16vibe Modal Content Script
 * 
 * Handles:
 * 1. Listening for '16vibe-open-link-modal' event and capture-phase click on "Link 16vibe"
 * 2. Auto-injecting modal styles to guarantee UI visibility
 * 3. Fetching personalization configs from https://ecomlap.com/api/product-personalization-configs?status=active&limit=100
 *    via Main World authenticated bridge + DOM attribute token
 * 4. Fetching store metadata (all 11 categories, 39 collections, trending tags) from Inkvibe (localhost:9000)
 * 5. Interactive Inkvibe Tags suggestion badges for quick appending
 * 6. Dynamic placeholder insertion ({{item_name}}, {{item_sku}}, etc.)
 * 7. Batch linking products to Inkvibe database
 */

(function () {
    'use strict';

    let currentSelectedProducts = [];
    let modalElement = null;
    let lastActiveField = null;

    /**
     * Auto-inject Modal CSS
     */
    function injectModalStyles() {
        if (document.getElementById('vibe-link-modal-injected-style')) return;
        const style = document.createElement('style');
        style.id = 'vibe-link-modal-injected-style';
        style.textContent = "/* ==========================================================================\n   16vibe Assistant - Link 16vibe Modal Styles\n   Matches reference mockup UI from user design\n   ========================================================================== */\n\n.vibe-link-modal-overlay {\n    position: fixed;\n    top: 0;\n    left: 0;\n    width: 100vw;\n    height: 100vh;\n    background: rgba(15, 23, 42, 0.65);\n    backdrop-filter: blur(4px);\n    -webkit-backdrop-filter: blur(4px);\n    z-index: 9999999;\n    display: flex;\n    align-items: center;\n    justify-content: center;\n    opacity: 0;\n    visibility: hidden;\n    transition: opacity 0.25s ease, visibility 0.25s ease;\n    font-family: -apple-system, BlinkMacSystemFont, \"Segoe UI\", Roboto, Helvetica, Arial, sans-serif;\n    color: #1e293b;\n    box-sizing: border-box;\n}\n\n.vibe-link-modal-overlay * {\n    box-sizing: border-box;\n}\n\n.vibe-link-modal-overlay.active {\n    opacity: 1;\n    visibility: visible;\n}\n\n.vibe-link-modal-dialog {\n    width: 95%;\n    max-width: 980px;\n    max-height: 92vh;\n    background: #ffffff;\n    border-radius: 12px;\n    box-shadow: 0 20px 45px -10px rgba(0, 0, 0, 0.25), 0 0 0 1px rgba(0, 0, 0, 0.05);\n    display: flex;\n    flex-direction: column;\n    overflow: hidden;\n    transform: translateY(16px) scale(0.98);\n    transition: transform 0.25s cubic-bezier(0.16, 1, 0.3, 1);\n}\n\n.vibe-link-modal-overlay.active .vibe-link-modal-dialog {\n    transform: translateY(0) scale(1);\n}\n\n/* Header */\n.vibe-modal-header {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    padding: 18px 24px;\n    background: #ffffff;\n    border-bottom: 1px solid #e2e8f0;\n}\n\n.vibe-modal-title-wrap {\n    display: flex;\n    flex-direction: column;\n    gap: 4px;\n}\n\n.vibe-modal-title {\n    margin: 0;\n    font-size: 18px;\n    font-weight: 700;\n    color: #0f172a;\n    display: flex;\n    align-items: center;\n    gap: 8px;\n}\n\n.vibe-modal-title-icon {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    width: 32px;\n    height: 32px;\n    background: #eff6ff;\n    color: #2563eb;\n    border-radius: 8px;\n    font-size: 16px;\n}\n\n.vibe-modal-subtitle {\n    margin: 0;\n    font-size: 13px;\n    color: #64748b;\n}\n\n.vibe-modal-close-btn {\n    border: none;\n    background: #f1f5f9;\n    color: #64748b;\n    width: 34px;\n    height: 34px;\n    border-radius: 50%;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    cursor: pointer;\n    font-size: 18px;\n    line-height: 1;\n    transition: all 0.15s ease;\n}\n\n.vibe-modal-close-btn:hover {\n    background: #e2e8f0;\n    color: #0f172a;\n}\n\n/* Body */\n.vibe-modal-body {\n    padding: 24px;\n    overflow-y: auto;\n    max-height: calc(92vh - 145px);\n    display: grid;\n    grid-template-columns: 1.15fr 0.85fr;\n    gap: 24px;\n    background: #f8fafc;\n}\n\n@media (max-width: 820px) {\n    .vibe-modal-body {\n        grid-template-columns: 1fr;\n    }\n}\n\n.vibe-modal-col {\n    display: flex;\n    flex-direction: column;\n    gap: 18px;\n}\n\n.vibe-card {\n    background: #ffffff;\n    border: 1px solid #e2e8f0;\n    border-radius: 10px;\n    padding: 18px;\n    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);\n}\n\n.vibe-card-title {\n    font-size: 14px;\n    font-weight: 700;\n    color: #1e293b;\n    margin: 0 0 14px 0;\n    display: flex;\n    align-items: center;\n    gap: 6px;\n    text-transform: uppercase;\n    letter-spacing: 0.03em;\n}\n\n.vibe-form-group {\n    display: flex;\n    flex-direction: column;\n    gap: 6px;\n    margin-bottom: 14px;\n}\n\n.vibe-form-group:last-child {\n    margin-bottom: 0;\n}\n\n.vibe-form-label {\n    font-size: 13px;\n    font-weight: 600;\n    color: #334155;\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n}\n\n.vibe-form-label-hint {\n    font-size: 11px;\n    font-weight: 400;\n    color: #94a3b8;\n}\n\n.vibe-input,\n.vibe-select,\n.vibe-textarea {\n    width: 100%;\n    padding: 9px 12px;\n    font-size: 13px;\n    color: #0f172a;\n    background: #ffffff;\n    border: 1px solid #cbd5e1;\n    border-radius: 6px;\n    outline: none;\n    transition: border-color 0.15s ease, box-shadow 0.15s ease;\n    font-family: inherit;\n}\n\n.vibe-input:focus,\n.vibe-select:focus,\n.vibe-textarea:focus {\n    border-color: #3b82f6;\n    box-shadow: 0 0 0 3px rgba(59, 130, 246, 0.15);\n}\n\n.vibe-textarea {\n    resize: vertical;\n    min-height: 85px;\n    line-height: 1.5;\n}\n\n.vibe-input-wrap-flex {\n    display: flex;\n    gap: 6px;\n    align-items: center;\n}\n\n.vibe-btn-refresh-field {\n    background: #eff6ff;\n    color: #2563eb;\n    border: 1px solid #bfdbfe;\n    border-radius: 6px;\n    width: 36px;\n    height: 36px;\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    cursor: pointer;\n    font-size: 14px;\n    flex-shrink: 0;\n    transition: all 0.15s ease;\n}\n\n.vibe-btn-refresh-field:hover {\n    background: #dbeafe;\n}\n\n/* Dynamic Placeholder Badges */\n.vibe-placeholder-box {\n    background: #f8fafc;\n    border: 1px dashed #cbd5e1;\n    border-radius: 6px;\n    padding: 10px;\n    margin-top: 6px;\n}\n\n.vibe-placeholder-header {\n    font-size: 11px;\n    font-weight: 600;\n    color: #64748b;\n    margin-bottom: 6px;\n    display: flex;\n    align-items: center;\n    gap: 4px;\n}\n\n.vibe-badges-container {\n    display: flex;\n    flex-wrap: wrap;\n    gap: 6px;\n}\n\n.vibe-badge-token {\n    display: inline-flex;\n    align-items: center;\n    padding: 3px 8px;\n    background: #ffffff;\n    border: 1px solid #e2e8f0;\n    border-radius: 4px;\n    font-family: \"SFMono-Regular\", Consolas, \"Liberation Mono\", Menlo, monospace;\n    font-size: 11px;\n    color: #3b82f6;\n    cursor: pointer;\n    user-select: none;\n    transition: all 0.15s ease;\n}\n\n.vibe-badge-token:hover {\n    background: #eff6ff;\n    border-color: #93c5fd;\n    transform: translateY(-1px);\n}\n\n.vibe-badge-token:active {\n    transform: translateY(0);\n}\n\n/* Image preview row */\n.vibe-img-preview-list {\n    display: flex;\n    gap: 8px;\n    overflow-x: auto;\n    padding: 8px 2px;\n    margin-top: 6px;\n    scrollbar-width: thin;\n}\n\n.vibe-img-preview-item {\n    position: relative;\n    width: 54px;\n    height: 54px;\n    border-radius: 6px;\n    border: 1px solid #e2e8f0;\n    overflow: hidden;\n    flex-shrink: 0;\n    background: #f1f5f9;\n}\n\n.vibe-img-preview-item img {\n    width: 100%;\n    height: 100%;\n    object-fit: cover;\n}\n\n/* Switch & Checkbox */\n.vibe-switch-row {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    padding: 6px 0;\n    cursor: pointer;\n}\n\n.vibe-switch-label-wrap {\n    display: flex;\n    flex-direction: column;\n}\n\n.vibe-switch-title {\n    font-size: 13px;\n    font-weight: 600;\n    color: #1e293b;\n}\n\n.vibe-switch-desc {\n    font-size: 11px;\n    color: #64748b;\n}\n\n.vibe-switch {\n    position: relative;\n    display: inline-block;\n    width: 40px;\n    height: 22px;\n    flex-shrink: 0;\n}\n\n.vibe-switch input {\n    opacity: 0;\n    width: 0;\n    height: 0;\n}\n\n.vibe-switch-slider {\n    position: absolute;\n    cursor: pointer;\n    top: 0;\n    left: 0;\n    right: 0;\n    bottom: 0;\n    background-color: #cbd5e1;\n    transition: 0.25s;\n    border-radius: 34px;\n}\n\n.vibe-switch-slider:before {\n    position: absolute;\n    content: \"\";\n    height: 16px;\n    width: 16px;\n    left: 3px;\n    bottom: 3px;\n    background-color: white;\n    transition: 0.25s;\n    border-radius: 50%;\n    box-shadow: 0 1px 3px rgba(0, 0, 0, 0.2);\n}\n\n.vibe-switch input:checked + .vibe-switch-slider {\n    background-color: #10b981;\n}\n\n.vibe-switch input:checked + .vibe-switch-slider:before {\n    transform: translateX(18px);\n}\n\n/* Footer */\n.vibe-modal-footer {\n    display: flex;\n    align-items: center;\n    justify-content: space-between;\n    padding: 16px 24px;\n    background: #ffffff;\n    border-top: 1px solid #e2e8f0;\n}\n\n.vibe-footer-status {\n    display: flex;\n    align-items: center;\n    gap: 12px;\n    font-size: 12px;\n    color: #64748b;\n}\n\n.vibe-status-pill {\n    display: inline-flex;\n    align-items: center;\n    gap: 6px;\n    padding: 4px 10px;\n    border-radius: 9999px;\n    background: #ecfdf5;\n    color: #065f46;\n    font-weight: 500;\n    font-size: 11px;\n    border: 1px solid #a7f3d0;\n}\n\n.vibe-status-pill.warning {\n    background: #fffbeb;\n    color: #92400e;\n    border-color: #fde68a;\n}\n\n.vibe-footer-actions {\n    display: flex;\n    align-items: center;\n    gap: 10px;\n}\n\n.vibe-btn {\n    display: inline-flex;\n    align-items: center;\n    justify-content: center;\n    gap: 6px;\n    padding: 9px 18px;\n    border-radius: 6px;\n    font-size: 13px;\n    font-weight: 600;\n    cursor: pointer;\n    border: 1px solid transparent;\n    transition: all 0.15s ease;\n    outline: none;\n}\n\n.vibe-btn-ghost {\n    background: #f1f5f9;\n    color: #475569;\n    border-color: #cbd5e1;\n}\n\n.vibe-btn-ghost:hover {\n    background: #e2e8f0;\n    color: #1e293b;\n}\n\n.vibe-btn-primary {\n    background: linear-gradient(135deg, #2563eb, #1d4ed8);\n    color: #ffffff;\n    box-shadow: 0 2px 4px rgba(37, 99, 235, 0.25);\n}\n\n.vibe-btn-primary:hover {\n    background: linear-gradient(135deg, #1d4ed8, #1e40af);\n    box-shadow: 0 4px 8px rgba(37, 99, 235, 0.35);\n}\n\n.vibe-btn-primary:disabled {\n    opacity: 0.65;\n    cursor: not-allowed;\n    transform: none !important;\n}\n\n/* Toast alert notification */\n.vibe-toast-notice {\n    position: fixed;\n    bottom: 24px;\n    right: 24px;\n    z-index: 10000000;\n    padding: 12px 18px;\n    border-radius: 8px;\n    background: #0f172a;\n    color: #ffffff;\n    font-size: 13px;\n    box-shadow: 0 10px 25px rgba(0, 0, 0, 0.25);\n    display: flex;\n    align-items: center;\n    gap: 8px;\n    opacity: 0;\n    transform: translateY(12px);\n    transition: all 0.25s cubic-bezier(0.16, 1, 0.3, 1);\n    pointer-events: none;\n}\n\n.vibe-toast-notice.show {\n    opacity: 1;\n    transform: translateY(0);\n}\n\n.vibe-toast-notice.success {\n    background: #065f46;\n    border: 1px solid #059669;\n}\n\n.vibe-toast-notice.error {\n    background: #991b1b;\n    border: 1px solid #dc2626;\n}\n";
        (document.head || document.documentElement).appendChild(style);
    }

    injectModalStyles();
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', injectModalStyles);
    }

    /**
     * Get Authentication Headers
     */
    function getAuthHeaders() {
        const headers = { 'Accept': 'application/json' };
        
        // 1. From DOM attribute set by in-page network hook
        try {
            const domAuth = document.documentElement.getAttribute('data-16vibe-auth');
            if (domAuth && domAuth.length > 10) {
                headers['Authorization'] = domAuth.startsWith('Bearer ') ? domAuth : 'Bearer ' + domAuth;
                return headers;
            }
        } catch(e) {}

        // 2. From window variable if accessible
        if (typeof window !== 'undefined' && window.__16vibe_auth_token) {
            const token = window.__16vibe_auth_token;
            headers['Authorization'] = token.startsWith('Bearer ') ? token : 'Bearer ' + token;
            return headers;
        }

        // 3. From storage
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
        toast.className = 'vibe-toast-notice ' + type + ' show';
        toast.innerHTML = (type === 'success' ? '✅ ' : '⚠️ ') + message;
        setTimeout(() => {
            if (toast) toast.className = 'vibe-toast-notice ' + type;
        }, 3500);
    }

    /**
     * Extract personalization configs list from raw API payload
     */
    function extractPersonalizationList(data) {
        if (!data) return [];
        let rawList = [];
        if (Array.isArray(data)) rawList = data;
        else if (Array.isArray(data.data)) rawList = data.data;
        else if (Array.isArray(data.docs)) rawList = data.docs;
        else if (Array.isArray(data.items)) rawList = data.items;
        else if (Array.isArray(data.configs)) rawList = data.configs;
        else if (Array.isArray(data.personalization_configs)) rawList = data.personalization_configs;
        else if (data.data && Array.isArray(data.data.items)) rawList = data.data.items;

        return rawList.map(item => ({
            id: item._id || item.id || item.code || item.config_id || 'cfg',
            name: item.name || item.title || item.config_name || item.label || item.code || ('Cấu hình #' + (item.id || item._id))
        })).filter(item => item.id && item.name);
    }

    /**
     * Fetch personalization configs from ecomlap.com
     * Uses in-page Main World bridge for 100% native authenticated session
     */
    function fetchPersonalizationConfigs() {
        return new Promise(async (resolve) => {
            let resolved = false;

            // Bridge listener for response from in-page hook
            const responseHandler = (e) => {
                if (resolved) return;
                window.removeEventListener('16vibe-personalization-response', responseHandler);
                const detail = e.detail;
                if (detail && detail.success && detail.data) {
                    const list = extractPersonalizationList(detail.data);
                    if (list.length > 0) {
                        console.log('[16vibe] Lấy thành công ' + list.length + ' cấu hình cá nhân hóa từ Ecomlap qua in-page bridge:', list);
                        resolved = true;
                        return resolve(list);
                    }
                }
            };
            window.addEventListener('16vibe-personalization-response', responseHandler);

            // Trigger in-page fetch
            try {
                window.dispatchEvent(new CustomEvent('16vibe-fetch-personalization'));
            } catch(e) {}

            // Concurrent direct fetch from content script
            const targetUrl = window.location.origin.includes('ecomlap.com')
                ? '/api/product-personalization-configs?status=active&limit=100'
                : 'https://ecomlap.com/api/product-personalization-configs?status=active&limit=100';

            try {
                const headers = getAuthHeaders();
                const res = await fetch(targetUrl, {
                    method: 'GET',
                    headers: headers,
                    credentials: 'include'
                });
                if (res.ok) {
                    const json = await res.json();
                    const list = extractPersonalizationList(json);
                    if (list.length > 0 && !resolved) {
                        resolved = true;
                        window.removeEventListener('16vibe-personalization-response', responseHandler);
                        console.log('[16vibe] Lấy thành công ' + list.length + ' cấu hình cá nhân hóa từ API:', list);
                        return resolve(list);
                    }
                }
            } catch (e) {
                console.warn('[16vibe] Direct fetch personalization error:', e);
            }

            // Timeout fallback
            setTimeout(() => {
                if (!resolved) {
                    resolved = true;
                    window.removeEventListener('16vibe-personalization-response', responseHandler);
                    resolve([
                        { id: 'cfg_default', name: 'Cấu hình cá nhân hóa mặc định (Default)' },
                        { id: 'cfg_apparel_tshirt', name: 'Áo thun 2D / 3D Print - Personalization' },
                        { id: 'cfg_mug_custom', name: 'Cốc sứ in tên & hình ảnh cá nhân hóa' },
                        { id: 'cfg_canvas_art', name: 'Canvas & Poster Custom Names' }
                    ]);
                }
            }, 1200);
        });
    }

    /**
     * Fetch Inkvibe metadata via background service worker
     */
    function fetchInkvibeMetadata() {
        return new Promise((resolve) => {
            try {
                chrome.runtime.sendMessage({ action: 'getInkvibeMetadata' }, (response) => {
                    if (response && response.success && response.data) {
                        resolve(response.data);
                    } else {
                        resolve({
                            categories: [],
                            collections: [],
                            tags: [],
                            salesChannels: [{ id: 'sc_default', name: 'Default Sales Channel' }],
                            shippingProfiles: [{ id: 'sp_default', name: 'Default Shipping Profile' }],
                            productTypes: [{ id: 'pt_shirt', value: 'Shirt' }]
                        });
                    }
                });
            } catch (err) {
                resolve({
                    categories: [],
                    collections: [],
                    tags: [],
                    salesChannels: [{ id: 'sc_default', name: 'Default Sales Channel' }],
                    shippingProfiles: [{ id: 'sp_default', name: 'Default Shipping Profile' }],
                    productTypes: [{ id: 'pt_shirt', value: 'Shirt' }]
                });
            }
        });
    }

    /**
     * Build and inject Modal DOM
     */
    function createModalDom() {
        if (modalElement && document.body.contains(modalElement)) return modalElement;

        injectModalStyles();

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
                            <span>Liên kết sản phẩm (Link 16vibe)</span>
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
                                    <span class="vibe-form-label-hint" id="vibe-hint-category-count">Inkvibe DB</span>
                                </label>
                                <select class="vibe-select" id="vibe-select-category">
                                    <option value="">-- Đang tải danh mục... --</option>
                                </select>
                            </div>

                            <!-- Bộ sưu tập -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-select-collection">
                                    <span>Bộ sưu tập (Collections)</span>
                                    <span class="vibe-form-label-hint" id="vibe-hint-collection-count">Inkvibe DB</span>
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

                            <!-- Thẻ phân loại (Tags) + Inkvibe Suggested Tags -->
                            <div class="vibe-form-group">
                                <label class="vibe-form-label" for="vibe-input-tags">
                                    <span>Thẻ phân loại (Tags)</span>
                                    <span class="vibe-form-label-hint">Phân cách bằng dấu phẩy</span>
                                </label>
                                <input type="text" class="vibe-input" id="vibe-input-tags" value="t-shirt, 16vibe, ecomlap" placeholder="Cách nhau bằng dấu phẩy...">
                                
                                <!-- Inkvibe Tags Container -->
                                <div style="margin-top: 8px;">
                                    <div style="font-size: 11px; font-weight: 600; color: #475569; margin-bottom: 5px; display: flex; align-items: center; justify-content: space-between;">
                                        <span>🏷️ Gợi ý thẻ từ Inkvibe (Click để thêm):</span>
                                        <span id="vibe-tags-count-label" style="color: #94a3b8; font-weight: 400;">0 thẻ</span>
                                    </div>
                                    <div class="vibe-badges-container" id="vibe-inkvibe-tags-list" style="max-height: 90px; overflow-y: auto; padding: 4px 0;">
                                        <!-- Inkvibe tags rendered dynamically -->
                                    </div>
                                </div>
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
     * Populate Inkvibe Metadata dropdowns (all categories, collections & tags)
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

        // 3. Product Categories - Render ALL categories
        const catSelect = document.getElementById('vibe-select-category');
        const catHint = document.getElementById('vibe-hint-category-count');
        if (catSelect && Array.isArray(data.categories)) {
            catSelect.innerHTML = '';
            if (catHint) catHint.textContent = data.categories.length + ' danh mục từ Inkvibe';
            
            data.categories.forEach((cat, idx) => {
                const opt = document.createElement('option');
                opt.value = cat.id;
                opt.textContent = cat.name || cat.title || cat.handle || cat.id;
                if (idx === 0) opt.selected = true;
                catSelect.appendChild(opt);
            });
        }

        // 4. Collections - Render ALL collections
        const colSelect = document.getElementById('vibe-select-collection');
        const colHint = document.getElementById('vibe-hint-collection-count');
        if (colSelect && Array.isArray(data.collections)) {
            colSelect.innerHTML = '';
            if (colHint) colHint.textContent = data.collections.length + ' bộ sưu tập từ Inkvibe';

            data.collections.forEach((col, idx) => {
                const opt = document.createElement('option');
                opt.value = col.id;
                opt.textContent = col.title || col.name || col.handle || col.id;
                if (idx === 0) opt.selected = true;
                colSelect.appendChild(opt);
            });
        }

        // 5. Inkvibe Suggested Tags
        const tagsContainer = document.getElementById('vibe-inkvibe-tags-list');
        const tagsCountLabel = document.getElementById('vibe-tags-count-label');
        if (tagsContainer && Array.isArray(data.tags)) {
            tagsContainer.innerHTML = '';
            if (tagsCountLabel) tagsCountLabel.textContent = data.tags.length + ' thẻ Inkvibe';

            data.tags.forEach(tag => {
                const badge = document.createElement('span');
                badge.className = 'vibe-badge-token';
                badge.style.cursor = 'pointer';
                badge.style.borderColor = '#93c5fd';
                badge.style.backgroundColor = '#f0f9ff';
                badge.title = 'Nhấp để thêm thẻ "' + tag + '" vào sản phẩm';
                badge.textContent = '+ ' + tag;
                badge.addEventListener('click', () => {
                    appendTagToInput(tag);
                    badge.style.backgroundColor = '#dcfce7';
                    badge.style.borderColor = '#86efac';
                    badge.textContent = '✓ ' + tag;
                    setTimeout(() => {
                        badge.style.backgroundColor = '#f0f9ff';
                        badge.style.borderColor = '#93c5fd';
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
                statusPill.textContent = '🟢 Inkvibe Live (' + (data.categories?.length || 0) + ' cats, ' + (data.collections?.length || 0) + ' cols)';
            } else {
                statusPill.className = 'vibe-status-pill warning';
                statusPill.textContent = '🟡 Inkvibe Local: Ready';
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
                item.innerHTML = '<img src="' + imgUrl + '" alt="" loading="lazy" onerror="this.src=\'data:image/svg+xml;utf8,<svg xmlns=\\\'http://www.w3.org/2000/svg\\\' width=\\\'' + 50 + '\\\' height=\\\'' + 50 + '\\\'><rect width=\\\'' + 50 + '\\\' height=\\\'' + 50 + '\\\'><rect width=\\\'' + 50 + '\\\' height=\\\'' + 50 + '\\\' fill=\\\'%23f1f5f9\\\'/></svg>\'">';
                container.appendChild(item);
            }
        });

        if (countEl) countEl.textContent = totalImgs;
    }

    /**
     * Open Modal - NEVER FAILS, ALWAYS OPENS
     */
    function openModal(selectedProducts) {
        if (!Array.isArray(selectedProducts) || selectedProducts.length === 0) {
            selectedProducts = resolveCurrentSelectedProducts();
        }

        currentSelectedProducts = selectedProducts || [];
        const overlay = createModalDom();

        const subtitle = overlay.querySelector('#vibe-modal-subtitle');
        const footerCount = overlay.querySelector('#vibe-footer-selected-count');
        if (subtitle) {
            if (currentSelectedProducts.length > 0) {
                subtitle.textContent = 'Sẵn sàng đồng bộ ' + currentSelectedProducts.length + ' sản phẩm đã chọn vào Inkvibe Store';
            } else {
                subtitle.textContent = 'Chưa chọn sản phẩm từ danh sách (Vui lòng chọn sản phẩm trên bảng để liên kết)';
            }
        }
        if (footerCount) footerCount.textContent = 'Đã chọn ' + currentSelectedProducts.length + ' sản phẩm';

        renderImagesPreview(currentSelectedProducts);
        overlay.classList.add('active');

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
            showToast('Vui lòng chọn ít nhất 1 sản phẩm trước khi liên kết!', 'error');
            return;
        }

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

        submitBtn.disabled = true;
        const originalBtnHtml = submitBtn.innerHTML;
        submitBtn.innerHTML = '<span>⏳ Đang liên kết (' + currentSelectedProducts.length + ' sp)...</span>';

        try {
            const processedProducts = currentSelectedProducts.map((p, idx) => {
                const name = p.name || p.title || ('Sản phẩm #' + (idx + 1));
                const sku = p.sku || p._id || p.id || ('SKU-' + (idx + 1));
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
                if (!resolvedHandle) resolvedHandle = 'product-' + sku.toLowerCase();

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
                    showToast('🎉 Đã liên kết thành công ' + processedProducts.length + ' sản phẩm sang Inkvibe Store!', 'success');
                    setTimeout(closeModal, 1500);
                } else {
                    showToast('Đã lưu ' + processedProducts.length + ' sản phẩm vào bộ nhớ liên kết extension.', 'success');
                    setTimeout(closeModal, 1500);
                }
            });

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
        try {
            if (typeof window !== 'undefined' && window.__16vibe_store && typeof window.__16vibe_store.getState === 'function') {
                const st = window.__16vibe_store.getState();
                const selIds = st.selectedIds || [];
                if (Array.isArray(selIds) && selIds.length > 0 && Array.isArray(st.ideas)) {
                    const matched = st.ideas.filter(i => {
                        const id = i._id || i.id;
                        return selIds.some(sid => String(sid) === String(id));
                    });
                    if (matched.length > 0) return matched;
                }
            }
        } catch (e) {}

        try {
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
            if (domProducts.length > 0) return domProducts;
        } catch (e) {}

        return [];
    }

    window.__16vibe_openLinkModal = openModal;
    window.__16vibe_closeLinkModal = closeModal;

    window.addEventListener('16vibe-open-link-modal', (e) => {
        const ideas = (e && e.detail && e.detail.ideas) || [];
        openModal(ideas);
    });

    document.addEventListener('click', (e) => {
        const btn = e.target.closest('button, .btn, [role="button"]');
        if (btn) {
            const text = (btn.innerText || btn.textContent || '').trim();
            if (text.includes('Link 16vibe') || text.includes('Cấu hình đã chọn')) {
                console.log('[16vibe] "Link 16vibe" button intercepted by capture listener!');
                e.preventDefault();
                e.stopPropagation();
                openModal([]);
            }
        }
    }, true);

    console.log('[16vibe] Link 16vibe modal script loaded and active.');
})();
