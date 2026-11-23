'use strict';

const { expect } = require('chai');
const { createEnv, createOrder } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

describe('SeetOrdersService', () => {
    it('maps orders without payment data or option line items', () => {
        const env = createEnv();
        const service = createLoader(env)('scripts/services/SeetOrdersService');
        expect(service.buildOrderPayload(createOrder())).to.deep.equal({
            external_order_id: '00012345',
            external_site_id: 'RefArch',
            currency: 'SAR',
            locale: 'ar_SA',
            order_status: 'placed',
            shipping_status: 'not_shipped',
            customer: { external_id: 'customer_123', email: 'customer@example.com', phone: '+966500000000' },
            items: [{
                product_id: 'MASTER-1', sku: 'VARIANT-1-RED', name: 'Abaya', quantity: 2
            }],
            ordered_at: '2026-11-23T18:00:00.000Z'
        });
    });

    it('uses a stable idempotency key and configurable status mapping', () => {
        const env = createEnv({ prefs: { seetOrderStatusMapping: '{"COMPLETED":"delivered"}' } });
        const service = createLoader(env)('scripts/services/SeetOrdersService');
        expect(service.buildIdempotencyKey('RefArch', '00012345')).to.equal('sfcc:RefArch:00012345');
        expect(service.mapStatuses(createOrder({ status: 5, shippingStatus: 2 }))).to.deep.equal({ order_status: 'delivered', shipping_status: 'shipped' });
    });

    it('posts orders with the idempotency key', () => {
        const env = createEnv();
        const service = createLoader(env)('scripts/services/SeetOrdersService');
        service.sendOrder({ external_order_id: '1' }, 'sfcc:RefArch:1');
        expect(env.calls[0]).to.include({ serviceId: 'seet.http.orders', method: 'POST' });
        expect(env.calls[0].headers['Idempotency-Key']).to.equal('sfcc:RefArch:1');
        expect(env.calls[0].body).to.deep.equal({ external_order_id: '1' });
    });
});
