'use strict';

const { expect } = require('chai');
const { createEnv } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

describe('SeetConfig', () => {
    function load(prefs) {
        return createLoader(createEnv({ prefs }))('scripts/helpers/SeetConfig');
    }

    it('accepts a valid configuration', () => {
        const config = load();
        expect(config.validate()).to.deep.equal({ valid: true, errors: [] });
        expect(config.isReviewsEnabled()).to.equal(true);
        expect(config.isOrderSyncEnabled()).to.equal(true);
    });

    it('rejects missing or malformed store IDs and non-HTTPS URLs', () => {
        expect(load({ seetStoreId: '' }).validate().valid).to.equal(false);
        expect(load({ seetStoreId: 'bad id!' }).validate().valid).to.equal(false);
        const insecure = load({ seetApiBaseUrl: 'http://api.seet.test' });
        expect(insecure.validate().errors).to.include('seetApiBaseUrl must be an absolute HTTPS URL');
        expect(insecure.isReviewsEnabled()).to.equal(false);
    });

    it('honours the master switch and feature switches', () => {
        expect(load({ seetEnabled: false }).isReviewsEnabled()).to.equal(false);
        expect(load({ seetReviewsEnabled: false }).isReviewsEnabled()).to.equal(false);
        expect(load({ seetOrderSyncEnabled: null }).isOrderSyncEnabled()).to.equal(false);
    });

    it('bounds the review page size and strips trailing slashes', () => {
        expect(load({ seetReviewPageSize: 500 }).getReviewPageSize()).to.equal(50);
        expect(load({ seetReviewPageSize: null }).getReviewPageSize()).to.equal(5);
        expect(load({ seetApiBaseUrl: 'https://api.seet.test/' }).getApiBaseUrl()).to.equal('https://api.seet.test');
    });

    it('merges a custom order status mapping and ignores invalid JSON', () => {
        expect(load({ seetOrderStatusMapping: '{"completed":"order.shipped"}' }).getOrderStatusMapping().COMPLETED).to.equal('order.shipped');
        expect(load({ seetOrderStatusMapping: '{"COMPLETED":"delivered"}' }).getOrderStatusMapping().COMPLETED).to.equal('order.delivered');
        expect(load({ seetOrderStatusMapping: '{not json' }).getOrderStatusMapping().COMPLETED).to.equal('order.delivered');
    });
});
