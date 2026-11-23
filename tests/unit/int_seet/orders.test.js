'use strict';

const { expect } = require('chai');
const { createEnv, createOrder } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

describe('SeetOrdersService', () => {
    function load(options) {
        const env = createEnv(options);
        return { env, service: createLoader(env)('scripts/services/SeetOrdersService') };
    }

    it('maps orders to the Seet order event payload without payment data or option line items', () => {
        const { service } = load();
        const payload = service.buildOrderPayload(createOrder());
        expect(JSON.parse(JSON.stringify(payload))).to.deep.equal({
            event: 'order.placed',
            order_id: '00012345',
            channel: 'online',
            country: 'SA',
            language: 'ar',
            placed_at: '2026-11-23T18:00:00.000Z',
            total: 250.5,
            currency: 'SAR',
            customer: { name: 'Sara Ali', email: 'customer@example.com', phone: '+966500000000' },
            items: [{
                sku: 'MASTER-1',
                external_id: 'MASTER-1',
                name: 'Abaya',
                quantity: 2,
                url: 'https://shop.example.com/Product-Show?pid=MASTER-1',
                image_url: 'https://cdn.example.com/VARIANT-1-RED.jpg'
            }],
            metadata: { platform: 'sfcc', site_id: 'RefArch', locale: 'ar_SA' }
        });
    });

    it('always sends a customer name and merges line items of the same master product', () => {
        const { service } = load();
        const order = createOrder({ customerName: null });
        expect(service.buildOrderPayload(order).customer.name).to.equal('Billing Name');
        const lineItem = order.getAllProductLineItems().toArray()[0];
        const twice = createOrder({ lineItems: [lineItem, lineItem] });
        expect(service.buildOrderPayload(twice).items).to.have.length(1);
        expect(service.buildOrderPayload(twice).items[0].quantity).to.equal(4);
        const odd = { ...lineItem, getProduct: () => null, getProductID: () => 'constructor' };
        expect(service.buildOrderPayload(createOrder({ lineItems: [odd] })).items.map((item) => item.sku)).to.deep.equal(['constructor']);
        const proto = { ...lineItem, getProduct: () => null, getProductID: () => '__proto__' };
        const merged = service.buildOrderPayload(createOrder({ lineItems: [proto, proto] })).items;
        expect(merged).to.have.length(1);
        expect(merged[0]).to.include({ sku: '__proto__', quantity: 4 });
    });

    it('sends a language only when the order locale starts with a language code', () => {
        const { service } = load();
        expect(service.buildOrderPayload(createOrder({ locale: 'en' })).language).to.equal('en');
        expect(service.buildOrderPayload(createOrder({ locale: 'default' })).language).to.equal(undefined);
        expect(service.buildOrderPayload(createOrder({ locale: null })).language).to.equal(undefined);
    });

    it('maps the SFCC order state to a Seet event', () => {
        const { service } = load();
        expect(service.mapEvent(createOrder({ status: 4 }))).to.equal('order.placed');
        expect(service.mapEvent(createOrder({ status: 4, shippingStatus: 2 }))).to.equal('order.shipped');
        expect(service.mapEvent(createOrder({ status: 5, shippingStatus: 2 }))).to.equal('order.delivered');
        expect(service.mapEvent(createOrder({ status: 6 }))).to.equal('order.cancelled');
        const custom = load({ prefs: { seetOrderStatusMapping: '{"COMPLETED":"order.shipped","SHIPPED":"order.delivered"}' } }).service;
        expect(custom.mapEvent(createOrder({ status: 5, shippingStatus: 2 }))).to.equal('order.shipped');
        expect(custom.mapEvent(createOrder({ status: 4, shippingStatus: 2 }))).to.equal('order.delivered');
        const paid = load({ prefs: { seetOrderStatusMapping: '{"OPEN":"order.paid"}' } }).service;
        expect(paid.mapEvent(createOrder({ status: 4 }))).to.equal('order.paid');
        expect(paid.mapEvent(createOrder({ status: 4, shippingStatus: 2 }))).to.equal('order.shipped');
    });

    it('records when a status was first seen and keeps it on later sends', () => {
        const { service } = load();
        const seen = new Date('2026-11-25T08:00:00Z');
        const payload = service.buildOrderPayload(createOrder({ status: 5 }), seen);
        expect(payload).to.include({ event: 'order.delivered', delivered_at: '2026-11-25T08:00:00.000Z' });
        service.applyEvent(payload, 'order.delivered', new Date('2026-11-26T08:00:00Z'));
        expect(payload.delivered_at).to.equal('2026-11-25T08:00:00.000Z');
    });

    it('posts order events with the secret key', () => {
        const { env, service } = load();
        expect(service.buildIdempotencyKey('RefArch', '00012345')).to.equal('sfcc:RefArch:00012345');
        service.sendOrder({ order_id: '1' }, 'sfcc:RefArch:1');
        expect(env.calls[0]).to.include({
            serviceId: 'seet.http.orders', method: 'POST', url: 'https://api.seet.test/api/v1/integrations/orders'
        });
        expect(env.calls[0].headers.Authorization).to.equal('Bearer key_default');
        expect(env.calls[0].headers['Idempotency-Key']).to.equal('sfcc:RefArch:1');
        expect(env.calls[0].body).to.deep.equal({ order_id: '1' });
    });
});
