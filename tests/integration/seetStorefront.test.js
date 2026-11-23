'use strict';

/**
 * Sandbox smoke test. Requires an uploaded cartridge, configured Business
 * Manager settings and SEET_TEST_PRODUCT_ID. Run with:
 *   SEET_TEST_PRODUCT_ID=<pid> npm run test:integration -- --baseUrl https://<host>/on/demandware.store/Sites-<SiteID>-Site/<locale>
 */

const { expect } = require('chai');

const productId = process.env.SEET_TEST_PRODUCT_ID;

describe('Seet storefront endpoints (sandbox)', function () {
    this.timeout(20000);

    before(function () {
        if (!productId || !global.baseUrl) {
            this.skip();
        }
    });

    it('renders the reviews list fragment without exposing credentials', async () => {
        const response = await fetch(`${global.baseUrl}/Seet-ReviewsList?pid=${encodeURIComponent(productId)}`);
        expect(response.status).to.equal(200);
        const html = await response.text();
        expect(html).to.not.match(/Bearer|api[_-]?key/i);
    });

    it('rejects direct requests to remote-include-only endpoints', async () => {
        const response = await fetch(`${global.baseUrl}/Seet-Rating?pid=${encodeURIComponent(productId)}`);
        expect(response.status).to.not.equal(200);
    });
});
