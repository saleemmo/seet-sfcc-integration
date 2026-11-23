'use strict';

const { expect } = require('chai');
const { createEnv, createProduct } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

describe('SeetProductHelper', () => {
    const master = createProduct('MASTER-1');
    const env = createEnv();
    env.products = {
        'MASTER-1': master,
        'VARIANT-1-RED': createProduct('VARIANT-1-RED', { master }),
        'GROUP-1-RED': createProduct('GROUP-1-RED', { master, variationGroup: true }),
        OFFLINE: createProduct('OFFLINE', { online: false })
    };
    const helper = createLoader(env)('scripts/helpers/SeetProductHelper');

    it('maps variants and variation groups to the master product', () => {
        expect(helper.resolveReviewProductId('MASTER-1')).to.equal('MASTER-1');
        expect(helper.resolveReviewProductId('VARIANT-1-RED')).to.equal('MASTER-1');
        expect(helper.resolveReviewProductId('GROUP-1-RED')).to.equal('MASTER-1');
    });

    it('rejects unknown and offline products', () => {
        expect(helper.resolveReviewProductId('UNKNOWN')).to.equal(null);
        expect(helper.resolveReviewProductId('OFFLINE')).to.equal(null);
    });
});
