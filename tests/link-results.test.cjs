const test = require('node:test');
const assert = require('node:assert/strict');
const { normalize } = require('../scripts/link-results.js');
const products = [{ ecomlap_id: 'a', handle: 'first' }, { ecomlap_id: 'b', handle: 'second' }];

test('legacy partial success marks only the returned product', () => {
    const report = normalize(products, { success: true, products: [{ id: 'prod_a', handle: 'first', action: 'created' }], errors: [{ handle: 'second', reason: 'Invalid price' }] });
    assert.equal(report.created_count, 1);
    assert.equal(report.failed_count, 1);
    assert.equal(report.results[1].reason, 'Invalid price');
});
test('new partial failure still preserves confirmed successes and warnings', () => {
    const report = normalize(products, { success: false, results: [{ input_index: 0, id: 'prod_a', action: 'updated', warnings: [{ stage: 'images', reason: 'B2 unavailable' }] }, { input_index: 1, action: 'failed', reason: 'Invalid price' }] });
    assert.equal(report.updated_count, 1);
    assert.equal(report.failed_count, 1);
    assert.equal(report.warnings.length, 1);
});
test('skip is counted separately and accepts changed destination handles', () => {
    const report = normalize(products, { results: [{ input_index: 0, id: 'prod_a', handle: 'old-handle', action: 'skipped' }] });
    assert.equal(report.skipped_count, 1);
    assert.equal(report.count, 0);
    assert.equal(report.results[0].handle, 'old-handle');
});
test('aggregate success without per-item confirmation fails closed', () => {
    assert.equal(normalize(products, { success: true, count: 2 }).failed_count, 2);
});
test('ambiguous handles and invalid indexes cannot mark the wrong item', () => {
    assert.equal(normalize([{ handle: 'same' }, { handle: 'same' }], { products: [{ id: 'prod', handle: 'same', action: 'created' }] }).failed_count, 2);
    assert.equal(normalize(products, { results: [{ id: 'prod', input_index: 10, handle: 'first', action: 'created' }] }).failed_count, 2);
});
test('wrapper responses from background preserve zero count and failures', () => {
    const report = normalize(products, { success: true, data: { products: [], count: 0 } });
    assert.equal(report.count, 0);
    assert.equal(report.failed_count, 2);
});
