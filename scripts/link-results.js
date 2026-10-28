(function (root) {
    'use strict';

    // Never infer per-product success from a batch boolean or aggregate count.
    function normalize(products, response) {
        const data = response && response.data && !Array.isArray(response.results) ? response.data : (response || {});
        const structured = Array.isArray(data.results);
        const rows = structured ? data.results : [
            ...(Array.isArray(data.products) ? data.products : []),
            ...(Array.isArray(data.errors) ? data.errors.map(error => ({ ...error, action: 'failed' })) : [])
        ];
        const matches = products.map(() => []);
        rows.forEach(row => {
            if (!row || typeof row !== 'object') return;
            let indexes = [];
            if (Number.isInteger(row.input_index)) {
                if (row.input_index >= 0 && row.input_index < products.length) indexes = [row.input_index];
            } else {
                for (const key of ['ecomlap_id', 'external_id', 'handle']) {
                    if (row[key] == null || String(row[key]).trim() === '') continue;
                    indexes = products.flatMap((product, index) => String(product[key] ?? '') === String(row[key]) ? [index] : []);
                    if (indexes.length) break;
                }
            }
            if (indexes.length === 1) matches[indexes[0]].push(row);
        });
        const results = products.map((product, index) => {
            const rowsForProduct = matches[index];
            const row = rowsForProduct.length === 1 ? rowsForProduct[0] : null;
            const accepted = row && row.id && ['created', 'updated', 'skipped'].includes(row.action);
            return {
                input_index: index, ecomlap_id: product.ecomlap_id, external_id: product.external_id,
                handle: row?.handle || product.handle, id: accepted ? row.id : undefined,
                action: accepted ? row.action : 'failed',
                reason: row?.reason || (accepted ? '' : data.error || response?.error || 'Server chưa xác nhận kết quả riêng cho sản phẩm này.'),
                warnings: Array.isArray(row?.warnings) ? row.warnings : [],
            };
        });
        const count = action => results.filter(row => row.action === action).length;
        return {
            results, created_count: count('created'), updated_count: count('updated'),
            skipped_count: count('skipped'), failed_count: count('failed'),
            count: count('created') + count('updated'), success: count('failed') === 0,
            warnings: results.flatMap(row => row.warnings.map(warning => ({ ...warning, input_index: row.input_index }))),
        };
    }
    root.VibeLinkResults = { normalize };
    if (typeof module !== 'undefined' && module.exports) module.exports = root.VibeLinkResults;
})(globalThis);
