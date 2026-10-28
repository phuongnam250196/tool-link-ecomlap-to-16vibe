const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
let JSDOM;
try { ({ JSDOM } = require('jsdom')); } catch { /* Optional DOM dependency. */ }
const domOptions = { skip: !JSDOM && 'Install jsdom or expose it through NODE_PATH' };

function setup(initialData) {
    const dom = new JSDOM('<!DOCTYPE html><html><head></head><body></body></html>', { url: 'https://ecomlap.com/products', runScripts: 'outside-only' });
    const w = dom.window, calls = { metadata: 0, fetches: [], bridges: 0, submissions: [] };
    const state = { data: initialData };
    const storage = {};
    w.console = { log() {}, warn() {}, error() {} };
    w.fetch = async url => { calls.fetches.push(url); return { ok: true, json: async () => ({ data: [] }) }; };
    w.addEventListener('16vibe-fetch-personalization', () => calls.bridges++);
    w.chrome = {
        runtime: { getURL: file => 'chrome-extension://test/' + file, sendMessage(msg, cb) {
            if (msg.action === 'getInkvibeMetadata') { calls.metadata++; cb({ success: true, data: state.data }); }
            else if (msg.action === 'linkProductsToInkvibe') {
                calls.submissions.push(msg.data);
                cb({ results: [{ input_index: 0, id: 'prod_a', action: 'created' }] });
            }
        } },
        storage: { local: { get(keys, cb) { cb(Object.fromEntries(keys.filter(k => k in storage).map(k => [k, storage[k]]))); }, set(value, cb) { Object.assign(storage, value); cb?.(); } } },
    };
    for (const file of ['scripts/link-results.js', 'scripts/content/link-16vibe-modal.js']) w.eval(fs.readFileSync(path.join(__dirname, '..', file), 'utf8'));
    w.__16vibe_openLinkModal([{ id: 'a', name: 'Product', sku: 'sku-a', personalization_config_data: { name: 'EcomLap legacy' }, raw: { id: 'a', sku: 'sku-a', personalization_config: { name: 'EcomLap config' } } }]);
    return { dom, w, calls, state };
}
async function loaded(w) {
    for (let i = 0; i < 30 && w.document.getElementById('vibe-select-personalization').disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.equal(w.document.getElementById('vibe-select-personalization').disabled, false);
}

test('modal reads only InkVibe metadata and submits native selection without EcomLap fields', domOptions, async () => {
    const { dom, w, calls } = setup({ categories: [], collections: [], personalization_configs: [{ id: 'native_1', name: 'Native <template>', is_active: true }] });
    try {
        await loaded(w);
        assert.equal(calls.metadata, 1);
        assert.equal(calls.bridges, 0);
        assert.deepEqual(calls.fetches, []);
        const select = w.document.getElementById('vibe-select-personalization');
        assert.equal(select.options.length, 2);
        assert.equal(select.options[1].textContent, 'Native <template>');
        select.value = 'native_1';
        w.document.getElementById('vibe-btn-submit-link').click();
        for (let i = 0; i < 30 && !calls.submissions.length; i++) await new Promise(resolve => setTimeout(resolve, 10));
        const payload = calls.submissions[0];
        assert.equal(payload.config.personalization_config_id, 'native_1');
        assert.equal(payload.config.personalization_source, 'inkvibe');
        assert.equal(payload.products[0].personalization_config_id, 'native_1');
        assert.equal(payload.products[0].personalization_config_data, undefined);
        assert.equal(payload.products[0].metadata.personalization_config_data, undefined);
        assert.equal(payload.config.personalization_config_data, undefined);
        for (let i = 0; i < 30 && w.document.getElementById('vibe-btn-submit-link').disabled; i++) await new Promise(resolve => setTimeout(resolve, 10));
        assert.equal(w.document.getElementById('vibe-btn-submit-link').disabled, false);
    } finally { dom.window.close(); }
});

test('refresh replaces cached choices, with distinct empty and error states', domOptions, async () => {
    const { dom, w, calls, state } = setup({ personalization_configs: [{ id: 'old', name: 'Old', is_active: true }] });
    try {
        await loaded(w);
        const select = w.document.getElementById('vibe-select-personalization');
        select.value = 'old';
        state.data = { personalization_configs: [{ id: 'new', name: 'New', is_active: true }] };
        w.document.getElementById('vibe-btn-refresh-pers').click();
        await loaded(w);
        assert.equal(calls.metadata, 2);
        assert.equal(select.options[1].value, 'new');
        assert.equal(select.value, '');
        state.data = { personalization_configs: [] };
        w.document.getElementById('vibe-btn-refresh-pers').click();
        await loaded(w);
        assert.equal(select.options.length, 1);
        assert.match(w.document.getElementById('vibe-hint-personalization-count').textContent, /Chưa có/);
        state.data = { personalization_configs: [], personalization_configs_error: 'InkVibe unavailable' };
        w.document.getElementById('vibe-btn-refresh-pers').click();
        await loaded(w);
        assert.match(w.document.getElementById('vibe-hint-personalization-count').textContent, /InkVibe unavailable/);
        assert.equal(select.options.length, 1);
        assert.equal(calls.bridges, 0);
        assert.deepEqual(calls.fetches, []);
    } finally { dom.window.close(); }
});
