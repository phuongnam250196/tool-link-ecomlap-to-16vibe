const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../scripts/content/gemini-content.js'), 'utf8');
const helper = source.slice(source.indexOf('function vibeFilterProducts('), source.indexOf('const C=function(e)'));
const filter = vm.runInNewContext(helper + ';vibeFilterProducts');
const products = [
    { _id: 'a', name: 'Áo mèo', sku: 'CAT-01', is_used: false },
    { _id: 'b', name: 'Áo mèo', sku: 'CAT-02', is_used: true },
    { _id: 'c', name: 'Cốc hoa', sku: 'FLOWER' },
];
const linkedMap = { a: { status: 'linked' } };

test('search combines with link status, independent of used status and shared names', () => {
    assert.deepEqual(filter(products, {}, linkedMap).map(p => p._id), ['a', 'b', 'c']);
    assert.deepEqual(filter(products, { link_status: 'linked' }, linkedMap).map(p => p._id), ['a']);
    assert.deepEqual(filter(products, { link_status: 'unlinked', search: '  MÈO ' }, linkedMap).map(p => p._id), ['b']);
    assert.deepEqual(filter(products, { search: 'cat-01' }, linkedMap).map(p => p._id), ['a']);
    assert.deepEqual(filter(products, { search: 'missing' }, linkedMap), []);
    assert.deepEqual(filter(products, { link_status: 'unlinked' }, { ...linkedMap, b: {} }).map(p => p._id), ['c']);
});

test('actual filter component has exactly search and link select, defaulting to all', () => {
    const start = source.indexOf('const I=function(e)');
    const end = source.indexOf(';function z(e)', start);
    const filters = { search: '', link_status: '' };
    let updated;
    const jsx = (type, props) => ({ type, props });
    const component = vm.runInNewContext(source.slice(start, end) + ';I', {
        s: { D: () => ({ selectedIds: [] }) },
        d: { P: () => ({ filters, setFilters: value => { updated = value; } }) },
        m: { jsx, jsxs: jsx }, O: Object.assign,
    });
    const controls = [];
    function visit(node) {
        if (!node || typeof node !== 'object') return;
        if (['input', 'select'].includes(node.type)) controls.push(node);
        for (const child of [].concat(node.props?.children || [])) visit(child);
    }
    visit(component({}));
    assert.equal(controls.length, 2);
    assert.equal(controls[0].props.type, 'search');
    assert.equal(controls[1].props.value, '');
    assert.deepEqual(Array.from(controls[1].props.children, c => c.props.value), ['', 'linked', 'unlinked']);
    controls[1].props.onChange({ target: { value: 'unlinked' } });
    assert.equal(updated.link_status, 'unlinked');
    controls[0].props.onChange({ target: { value: 'cat' } });
    assert.equal(updated.search, 'cat');
});
