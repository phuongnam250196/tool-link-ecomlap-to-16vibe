const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');
const read = file => fs.readFileSync(path.join(__dirname, '../scripts/content', file), 'utf8');

test('gallery and table render stable product IDs for linked status', () => {
    const bundle = read('gemini-content.js');
    for (const marker of ['className:"idea-card "', 'className:"table-row"']) {
        const start = bundle.indexOf(marker);
        const end = bundle.indexOf('children:', start);
        const props = vm.runInNewContext('({' + bundle.slice(start, end) + 'children: []})', { e: { _id: 'product-123' } });
        assert.equal(props['data-id'], 'product-123');
    }
});

test('storage updates mark only confirmed products, survive rerender, and clear removed status', async () => {
    const dom = new JSDOM('<table><tbody><tr data-id="success"><td><img src="https://example.com/shared.jpg"></td><td>Product name</td></tr></tbody></table><div class="product-card" data-product-id="success"><img src="https://example.com/shared.jpg"><span class="product-name">Product name</span></div><div id="ecomlap-manager-panel"></div>', { url: 'https://ecomlap.com/products', runScripts: 'outside-only' });
    const w = dom.window;
    let storageChanged;
    w.__16vibe_network_hook_injected = true;
    w.console = { log() {}, warn() {}, error() {} };
    w.chrome = {
        runtime: { onMessage: { addListener() {} }, getURL: x => x },
        storage: {
            local: { get(keys, cb) { cb({}); }, set() {} },
            onChanged: { addListener(fn) { storageChanged = fn; } },
        },
    };
    const panel = w.document.getElementById('ecomlap-manager-panel');
    const markup = ['success', 'failed'].map(id => `<div class="idea-card" data-id="${id}"><div class="idea-thumb"><img src="https://example.com/shared.jpg"></div><div class="idea-name">Same name</div></div>`).join('');
    try {
        panel.innerHTML = markup;
        w.eval(read('product-interceptor.js'));
        await new Promise(resolve => w.setTimeout(resolve, 0));
        assert.equal(typeof storageChanged, 'function');
        storageChanged({ linked_products_map: { newValue: { success: { status: 'linked' } } } }, 'local');
        const assertMarked = () => {
            assert.equal(w.document.querySelectorAll('table .vibe-linked-badge').length, 1);
            assert.equal(w.document.querySelectorAll('.product-card .vibe-linked-badge').length, 1);
            assert.equal(panel.querySelectorAll('[data-id="success"] .vibe-linked-badge').length, 1);
            assert.equal(panel.querySelector('[data-id="success"]').style.backgroundColor, 'rgb(240, 253, 244)');
            assert.equal(panel.querySelectorAll('[data-id="failed"] .vibe-linked-badge').length, 0);
        };
        assertMarked();
        panel.innerHTML = markup;
        await new Promise(resolve => w.setTimeout(resolve, 400));
        assertMarked();
        storageChanged({ linked_products_map: { newValue: {} } }, 'local');
        assert.equal(panel.querySelectorAll('.vibe-linked-badge, .vibe-item-linked').length, 0);
    } finally { dom.window.close(); }
});
