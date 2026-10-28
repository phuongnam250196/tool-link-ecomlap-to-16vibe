const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { /* Optional DOM test dependency. */ }

test('modal shows partial results, retains warnings and marks only confirmed products', { skip: !JSDOM && 'Install jsdom or expose it through NODE_PATH' }, async () => {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'https://ecomlap.com/products', runScripts: 'outside-only' });
    const w = dom.window;
    const storage = {};
    w.document.body.innerHTML = '<table><tbody><tr data-id="a"><td><img src="https://example.com/a.jpg"></td><td>First</td></tr></tbody></table><div id="ecomlap-manager-panel"><div class="idea-card" data-id="a"><div class="idea-thumb"><img src="https://example.com/a.jpg"></div><div class="idea-name">First</div></div><div class="idea-card" data-id="b"><div class="idea-thumb"><img src="https://example.com/b.jpg"></div><div class="idea-name">Second</div></div></div>';
    w.__16vibe_network_hook_injected = true;
    w.console = { log() {}, warn() {}, error() {} };
    w.fetch = async () => ({ ok: true, json: async () => ({ success: true, data: [] }) });
    w.chrome = {
        runtime: { onMessage: { addListener() {} }, getURL: file => 'chrome-extension://test/' + file, sendMessage(msg, callback) {
            if (msg.action === 'linkProductsToInkvibe') {
                callback({ success: false, results: [
                    { input_index: 0, id: 'prod_a', action: 'created', warnings: [{ stage: 'images', reason: 'B2 unavailable' }] },
                    { input_index: 1, action: 'failed', reason: 'Invalid price' },
                ] });
            } else callback({ success: true, data: { categories: [{ id: 'cat', name: 'Category' }], collections: [], vendors: [], tags: [], personalization_configs: [] } });
        } },
        storage: { onChanged: { addListener() {} }, local: {
            get(keys, cb) { cb(Object.fromEntries(keys.filter(k => k in storage).map(k => [k, storage[k]]))); },
            set(value, cb) { Object.assign(storage, value); if (cb) cb(); },
        } },
    };
    try {
        for (const file of ['scripts/content/product-interceptor.js', 'scripts/link-results.js', 'scripts/content/link-16vibe-modal.js']) w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
        await new Promise(resolve => setTimeout(resolve, 0));
        w.__16vibe_openLinkModal([{ id: 'a', name: 'First', sku: 'sku-a', main_image_url: 'https://example.com/a.jpg' }, { id: 'b', name: 'Second', sku: 'sku-b', main_image_url: 'https://example.com/b.jpg' }]);
        for (let i = 0; i < 20 && w.document.getElementById('vibe-select-personalization').disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
        const button = w.document.getElementById('vibe-btn-submit-link');
        button.click();
        for (let i = 0; i < 20 && !w.document.getElementById('vibe-link-results'); i++) await new Promise(resolve => setTimeout(resolve, 10));
        const panel = w.document.getElementById('vibe-link-results');
        assert.ok(panel, 'Result panel should be rendered');
        assert.match(panel.textContent, /Tạo mới: 1/);
        assert.match(panel.textContent, /Lỗi: 1/);
        assert.match(panel.textContent, /B2 unavailable/);
        assert.match(panel.textContent, /Invalid price/);
        assert.ok(storage.linked_products_map.a);
        assert.equal(storage.linked_products_map.b, undefined);
        const previews = w.document.querySelectorAll('.vibe-img-preview-item');
        assert.equal(previews.length, 2);
        assert.equal(previews[0].querySelectorAll('.vibe-linked-badge').length, 1);
        assert.equal(previews[1].querySelectorAll('.vibe-linked-badge').length, 0);
        assert.equal(w.document.querySelectorAll('table .vibe-linked-badge').length, 1);
        assert.equal(w.document.querySelectorAll('#ecomlap-manager-panel [data-id="a"] .vibe-linked-badge').length, 1);
        assert.equal(w.document.querySelectorAll('#ecomlap-manager-panel [data-id="b"] .vibe-linked-badge').length, 0);
        assert.equal(button.disabled, false);
        assert.equal(w.document.getElementById('vibe-btn-cancel-modal').disabled, false);
        assert.ok(w.document.getElementById('vibe-link-16vibe-modal').classList.contains('active'));
    } finally { w.close(); }
});
