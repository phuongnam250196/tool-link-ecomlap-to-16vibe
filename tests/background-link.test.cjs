const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

async function link(response, status = 200, action = 'linkProductsToInkvibe', envText = '') {
    const storage = { sync_secret_key: 'test' };
    const requests = [];
    let listener;
    const event = { addListener() {} };
    const context = vm.createContext({
        console, URL, URLSearchParams, setTimeout, clearTimeout,
        chrome: {
            runtime: { getURL: p => 'extension://' + p, onInstalled: event, onMessage: { addListener(fn) { listener = fn; } } },
            storage: { local: {
                get(keys, callback) { const result = Object.fromEntries(keys.filter(key => key in storage).map(key => [key, storage[key]])); if (callback) callback(result); else return Promise.resolve(result); },
                set(value, callback) { Object.assign(storage, value); if (callback) callback(); return Promise.resolve(); },
                remove() { return Promise.resolve(); },
            } },
            tabs: { query(_, cb) { cb([]); } },
        },
        fetch: async (url, options) => {
            if (url.startsWith('extension://')) return { ok: true, text: async () => {
                await new Promise(resolve => setTimeout(resolve, 15));
                return envText;
            } };
            requests.push({ url, options });
            return { ok: status < 400, status, json: async () => response };
        },
    });
    context.importScripts = file => vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts', file), 'utf8'), context);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '../scripts/background.js'), 'utf8'), context);
    const products = [{ ecomlap_id: 'a', external_id: 'sku-a', handle: 'a', title: 'First' }, { ecomlap_id: 'b', external_id: 'sku-b', handle: 'b', title: 'Second' }];
    const reply = await new Promise(resolve => listener({ action, data: { products } }, {}, resolve));
    return { reply, storage, requests };
}

test('both API actions wait for env and prefer its secret over saved Chrome settings', async () => {
    for (const action of ['getInkvibeMetadata', 'linkProductsToInkvibe']) {
        const { requests } = await link({ success: true, data: { personalization_configs: [] }, results: [] }, 200, action,
            '# local configuration\nBACKEND_URL="https://inkvibe.example"\nINKVIBE_SYNC_SECRET=\'secret=from-env\'\r\n');
        assert.equal(requests.length, 1);
        assert.equal(requests[0].url, 'https://inkvibe.example/admin/products/link-16vibe');
        assert.equal(requests[0].options.headers['x-16vibe-secret-key'], 'secret=from-env');
    }
});

test('missing env secret keeps existing Chrome configuration working', async () => {
    const { requests } = await link({ results: [] });
    assert.equal(requests[0].options.headers['x-16vibe-secret-key'], 'test');
});

test('actual background handler persists only confirmed products on partial success', async () => {
    const { reply, storage } = await link({ success: false, results: [{ input_index: 0, id: 'prod_a', action: 'created' }, { input_index: 1, action: 'failed', reason: 'Invalid price' }] });
    assert.equal(reply.created_count, 1);
    assert.equal(reply.failed_count, 1);
    assert.equal(storage.linked_products[0].productCount, 1);
    assert.ok(storage.linked_products_map.a);
    assert.equal(storage.linked_products_map.b, undefined);
});

test('zero confirmed products writes no linked history', async () => {
    const { reply, storage } = await link({ success: true, count: 2 });
    assert.equal(reply.count, 0);
    assert.equal(reply.failed_count, 2);
    assert.equal(storage.linked_products, undefined);
});

test('authorization failures propagate status so modal stops later batches', async () => {
    const { reply, storage } = await link({ error: 'Unauthorized' }, 401);
    assert.equal(reply.status, 401);
    assert.equal(reply.count, 0);
    assert.equal(storage.linked_products_map, undefined);
});

test('metadata forwards native personalization choices even without categories', async () => {
    const choices = [{ id: 'tpl_1', name: 'Native InkVibe', is_active: true }];
    const { reply } = await link({ success: true, data: { categories: [], personalization_configs: choices } }, 200, 'getInkvibeMetadata');
    assert.equal(reply.data.personalization_configs[0].id, 'tpl_1');
    assert.equal(reply.data.personalization_configs_error, null);
});

test('metadata exposes authorization and server failures instead of fake successful defaults', async () => {
    for (const status of [401, 403, 404, 500]) {
        const { reply } = await link({ error: 'Request rejected' }, status, 'getInkvibeMetadata');
        assert.equal(reply.success, false);
        assert.equal(reply.status, status);
        assert.match(reply.error, new RegExp(String(status)));
        assert.equal(reply.data, undefined);
    }
});

test('metadata preserves an empty list and exposes old-backend compatibility errors', async () => {
    const empty = await link({ success: true, data: { personalization_configs: [] } }, 200, 'getInkvibeMetadata');
    assert.equal(empty.reply.data.personalization_configs.length, 0);
    assert.equal(empty.reply.data.personalization_configs_error, null);
    const old = await link({ success: true, data: { categories: [] } }, 200, 'getInkvibeMetadata');
    assert.equal(old.reply.data.personalization_configs.length, 0);
    assert.match(old.reply.data.personalization_configs_error, /cập nhật backend/);
});
