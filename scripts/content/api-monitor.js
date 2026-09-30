/**
 * 16vibe Assistant - API Monitor Content Script
 * Displays a middle-right floating widget when authenticated to monitor calls to https://ecomlap.com/api/products
 */

(function () {
    'use strict';

    const TARGET_API_URL = 'https://ecomlap.com/api/products';
    const TARGET_API_PATH = '/api/products';

    let isAuthenticated = false;
    let widgetElement = null;
    let isCollapsed = false;

    // Monitor State
    let monitorState = {
        status: 'idle', // 'idle' | 'calling' | 'detected' | 'error'
        callCount: 0,
        lastCallTime: null,
        lastStatus: null,
        history: [] // { time, status, method }
    };

    /**
     * 1. In-Page Network Interceptor
     * Injects a tiny DOM script into page window context to intercept fetch() and XMLHttpRequest
     */
    function injectPageNetworkInterceptor() {
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
                        const init = args[1] || {};
                        let url = '';
                        if (typeof input === 'string') {
                            url = input;
                        } else if (input && input.url) {
                            url = input.url;
                        }

                        if (isTarget(url)) {
                            const method = (init.method || 'GET').toUpperCase();
                            window.dispatchEvent(new CustomEvent('16vibe-api-detect', {
                                detail: { type: 'calling', url, method, time: Date.now() }
                            }));

                            try {
                                const response = await originalFetch.apply(this, args);
                                window.dispatchEvent(new CustomEvent('16vibe-api-detect', {
                                    detail: {
                                        type: 'completed',
                                        url,
                                        method,
                                        status: response.status,
                                        time: Date.now()
                                    }
                                }));
                                return response;
                            } catch (err) {
                                window.dispatchEvent(new CustomEvent('16vibe-api-detect', {
                                    detail: {
                                        type: 'error',
                                        url,
                                        method,
                                        error: err.message,
                                        time: Date.now()
                                    }
                                }));
                                throw err;
                            }
                        }

                        return originalFetch.apply(this, args);
                    };

                    // Monkey-patch XMLHttpRequest
                    const originalOpen = XMLHttpRequest.prototype.open;
                    const originalSend = XMLHttpRequest.prototype.send;

                    XMLHttpRequest.prototype.open = function(method, url) {
                        this._16vibeUrl = url;
                        this._16vibeMethod = method;
                        return originalOpen.apply(this, arguments);
                    };

                    XMLHttpRequest.prototype.send = function() {
                        if (isTarget(this._16vibeUrl)) {
                            const method = (this._16vibeMethod || 'GET').toUpperCase();
                            window.dispatchEvent(new CustomEvent('16vibe-api-detect', {
                                detail: { type: 'calling', url: this._16vibeUrl, method, time: Date.now() }
                            }));

                            this.addEventListener('load', () => {
                                window.dispatchEvent(new CustomEvent('16vibe-api-detect', {
                                    detail: {
                                        type: 'completed',
                                        url: this._16vibeUrl,
                                        method,
                                        status: this.status,
                                        time: Date.now()
                                    }
                                }));
                            });

                            this.addEventListener('error', () => {
                                window.dispatchEvent(new CustomEvent('16vibe-api-detect', {
                                    detail: {
                                        type: 'error',
                                        url: this._16vibeUrl,
                                        method,
                                        error: 'Network Error',
                                        time: Date.now()
                                    }
                                }));
                            });
                        }

                        return originalSend.apply(this, arguments);
                    };
                })();
            `;
            (document.head || document.documentElement).appendChild(script);
            script.remove();
        } catch (e) {
            console.warn('[16vibe Monitor] Could not inject in-page interceptor:', e);
        }
    }

    /**
     * Format timestamp to hh:mm:ss
     */
    function formatTime(timestamp) {
        if (!timestamp) return '--:--:--';
        const d = new Date(timestamp);
        return d.toLocaleTimeString('vi-VN', { hour12: false });
    }

    /**
     * Create & Mount floating widget at middle-right edge
     */
    function mountWidget() {
        if (widgetElement || document.getElementById('vibe-api-monitor-root')) {
            return;
        }

        const container = document.createElement('div');
        container.id = 'vibe-api-monitor-root';
        container.innerHTML = `
            <div class="vibe-monitor-card">
                <!-- Header -->
                <div class="vibe-monitor-header">
                    <div class="vibe-monitor-title-wrap">
                        <div class="vibe-monitor-indicator ${monitorState.status}"></div>
                        <span class="vibe-monitor-title">16vibe Monitor</span>
                    </div>
                    <button class="vibe-monitor-toggle-btn" title="Thu gọn/Mở rộng">▶</button>
                </div>

                <!-- Collapsed view strip -->
                <div class="vibe-collapsed-strip">
                    <span class="vibe-collapsed-badge ${monitorState.callCount > 0 ? 'has-calls' : ''}">
                        ${monitorState.callCount}
                    </span>
                    <span class="vibe-collapsed-label">API MONITOR</span>
                </div>

                <!-- Body -->
                <div class="vibe-monitor-body">
                    <!-- Target URL -->
                    <div class="vibe-target-box">
                        <div class="vibe-target-label">Mục tiêu theo dõi:</div>
                        <div class="vibe-target-url">${TARGET_API_URL}</div>
                    </div>

                    <!-- Status Banner -->
                    <div class="vibe-status-banner ${monitorState.status}">
                        <div class="vibe-status-icon">📡</div>
                        <div class="vibe-status-text">Đang lắng nghe... Chưa phát hiện gọi API</div>
                    </div>

                    <!-- Stats Grid -->
                    <div class="vibe-stats-grid">
                        <div class="vibe-stat-item">
                            <div class="vibe-stat-num vibe-count-val">${monitorState.callCount}</div>
                            <div class="vibe-stat-label">Số lần gọi</div>
                        </div>
                        <div class="vibe-stat-item">
                            <div class="vibe-stat-num vibe-time-val">${formatTime(monitorState.lastCallTime)}</div>
                            <div class="vibe-stat-label">Lần cuối</div>
                        </div>
                    </div>

                    <!-- Call Log Box -->
                    <div class="vibe-call-log">
                        <div class="vibe-call-log-empty">Chưa có request nào được ghi nhận</div>
                    </div>
                </div>

                <!-- Footer -->
                <div class="vibe-monitor-footer">
                    <button class="vibe-clear-btn">Xóa log</button>
                </div>
            </div>
        `;

        document.body.appendChild(container);
        widgetElement = container;

        // Toggle collapse
        const toggleBtn = container.querySelector('.vibe-monitor-toggle-btn');
        const card = container.querySelector('.vibe-monitor-card');

        toggleBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleCollapse();
        });

        card.addEventListener('click', () => {
            if (isCollapsed) {
                toggleCollapse();
            }
        });

        // Clear button
        const clearBtn = container.querySelector('.vibe-clear-btn');
        clearBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            resetMonitorState();
        });

        updateWidgetUI();
    }

    /**
     * Unmount Widget (when logged out)
     */
    function unmountWidget() {
        if (widgetElement) {
            widgetElement.remove();
            widgetElement = null;
        }
        const existing = document.getElementById('vibe-api-monitor-root');
        if (existing) existing.remove();
    }

    /**
     * Toggle Collapsed state
     */
    function toggleCollapse() {
        isCollapsed = !isCollapsed;
        if (!widgetElement) return;

        if (isCollapsed) {
            widgetElement.classList.add('collapsed');
            const toggleBtn = widgetElement.querySelector('.vibe-monitor-toggle-btn');
            if (toggleBtn) toggleBtn.textContent = '◀';
        } else {
            widgetElement.classList.remove('collapsed');
            const toggleBtn = widgetElement.querySelector('.vibe-monitor-toggle-btn');
            if (toggleBtn) toggleBtn.textContent = '▶';
        }
    }

    /**
     * Reset monitor state
     */
    function resetMonitorState() {
        monitorState = {
            status: 'idle',
            callCount: 0,
            lastCallTime: null,
            lastStatus: null,
            history: []
        };
        updateWidgetUI();
    }

    /**
     * Update UI with current state
     */
    function updateWidgetUI() {
        if (!widgetElement) return;

        const indicator = widgetElement.querySelector('.vibe-monitor-indicator');
        const statusBanner = widgetElement.querySelector('.vibe-status-banner');
        const statusIcon = widgetElement.querySelector('.vibe-status-icon');
        const statusText = widgetElement.querySelector('.vibe-status-text');
        const countVal = widgetElement.querySelector('.vibe-count-val');
        const timeVal = widgetElement.querySelector('.vibe-time-val');
        const collapsedBadge = widgetElement.querySelector('.vibe-collapsed-badge');
        const logContainer = widgetElement.querySelector('.vibe-call-log');

        // Update indicator
        if (indicator) {
            indicator.className = `vibe-monitor-indicator ${monitorState.status}`;
        }

        // Update banner
        if (statusBanner) {
            statusBanner.className = `vibe-status-banner ${monitorState.status}`;
            if (monitorState.status === 'idle') {
                statusIcon.textContent = '📡';
                statusText.textContent = 'Đang lắng nghe... Chưa phát hiện gọi API';
            } else if (monitorState.status === 'calling') {
                statusIcon.textContent = '⏳';
                statusText.textContent = 'Trang ĐANG GỌI API /api/products...';
            } else if (monitorState.status === 'detected') {
                statusIcon.textContent = '⚡';
                statusText.innerHTML = `<strong>Đã phát hiện gọi API!</strong> (Status: ${monitorState.lastStatus || '200 OK'})`;
            } else if (monitorState.status === 'error') {
                statusIcon.textContent = '⚠️';
                statusText.textContent = 'Phát hiện gọi API nhưng bị lỗi kết nối';
            }
        }

        // Update counts
        if (countVal) countVal.textContent = monitorState.callCount;
        if (timeVal) timeVal.textContent = formatTime(monitorState.lastCallTime);
        if (collapsedBadge) {
            collapsedBadge.textContent = monitorState.callCount;
            if (monitorState.callCount > 0) {
                collapsedBadge.classList.add('has-calls');
            } else {
                collapsedBadge.classList.remove('has-calls');
            }
        }

        // Update call log
        if (logContainer) {
            if (monitorState.history.length === 0) {
                logContainer.innerHTML = '<div class="vibe-call-log-empty">Chưa có request nào được ghi nhận</div>';
            } else {
                logContainer.innerHTML = monitorState.history.slice(-5).reverse().map(item => `
                    <div class="vibe-call-log-item">
                        <span class="vibe-call-log-time">${item.time}</span>
                        <span>${item.method || 'GET'}</span>
                        <span class="vibe-call-log-status">${item.status || 'OK'}</span>
                    </div>
                `).join('');
            }
        }
    }

    /**
     * Handlers for detected calls
     */
    function handleApiCallStart(data) {
        monitorState.status = 'calling';
        monitorState.lastCallTime = data?.timestamp || Date.now();
        updateWidgetUI();
    }

    function handleApiCallCompleted(data) {
        monitorState.status = 'detected';
        monitorState.callCount++;
        monitorState.lastCallTime = data?.timestamp || Date.now();
        monitorState.lastStatus = data?.statusCode || data?.status || 200;

        monitorState.history.push({
            time: formatTime(monitorState.lastCallTime),
            status: monitorState.lastStatus,
            method: data?.method || 'GET'
        });

        updateWidgetUI();
    }

    function handleApiCallError(data) {
        monitorState.status = 'error';
        monitorState.callCount++;
        monitorState.lastCallTime = data?.timestamp || Date.now();
        monitorState.lastStatus = 'Error';

        monitorState.history.push({
            time: formatTime(monitorState.lastCallTime),
            status: 'ERR',
            method: data?.method || 'GET'
        });

        updateWidgetUI();
    }

    /**
     * Init & Event Listeners
     */
    function init() {
        injectPageNetworkInterceptor();

        // 1. Listen for In-Page Interceptor Events
        window.addEventListener('16vibe-api-detect', (e) => {
            const detail = e.detail;
            if (!detail) return;
            if (detail.type === 'calling') {
                handleApiCallStart(detail);
            } else if (detail.type === 'completed') {
                handleApiCallCompleted(detail);
            } else if (detail.type === 'error') {
                handleApiCallError(detail);
            }
        });

        // 2. Listen for Background WebRequest Messages
        chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
            if (message.action === 'authStatusChanged') {
                isAuthenticated = !!(message.data && message.data.authenticated);
                if (isAuthenticated) {
                    mountWidget();
                } else {
                    unmountWidget();
                }
            } else if (message.action === 'apiProductsCalling') {
                handleApiCallStart(message.data);
            } else if (message.action === 'apiProductsCompleted') {
                handleApiCallCompleted(message.data);
            } else if (message.action === 'apiProductsError') {
                handleApiCallError(message.data);
            }
        });

        // 3. Listen to chrome.storage for login token changes
        chrome.storage.onChanged.addListener((changes, areaName) => {
            if (areaName === 'local' && changes['hmt-token']) {
                const newToken = changes['hmt-token'].newValue;
                if (newToken) {
                    isAuthenticated = true;
                    mountWidget();
                } else {
                    isAuthenticated = false;
                    unmountWidget();
                }
            }
        });

        // 4. Initial Auth Check
        chrome.runtime.sendMessage({ action: 'getAuthStatus' }, (response) => {
            if (response && response.success && response.data && response.data.authenticated) {
                isAuthenticated = true;
                mountWidget();
            } else {
                isAuthenticated = false;
                unmountWidget();
            }
        });
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init);
    } else {
        init();
    }
})();
