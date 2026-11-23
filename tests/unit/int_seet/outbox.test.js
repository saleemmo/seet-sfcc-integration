'use strict';

const { expect } = require('chai');
const { createEnv, createOrder } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

const NOW = new Date('2026-11-23T20:00:00Z');
const MINUTE = 60 * 1000;

describe('SeetOutboxHelper', () => {
    function setup(options = {}) {
        const env = createEnv(options);
        const load = createLoader(env);
        const outbox = load('scripts/helpers/SeetOutboxHelper');
        return {
            env, load, outbox, options: outbox.getOptions({})
        };
    }
    function record(env, orderNo = '00012345') {
        return env.customObjects[`SeetOrderOutbox|${orderNo}`];
    }
    function enqueueAndBackdate(ctx, order = createOrder()) {
        ctx.outbox.enqueue(order);
        record(ctx.env, order.getOrderNo()).custom.nextRetryAt = new Date(NOW.getTime() - MINUTE);
    }

    describe('enqueue', () => {
        it('creates a PENDING record without calling the API', () => {
            const ctx = setup();
            expect(ctx.outbox.enqueue(createOrder())).to.deep.equal({ queued: true });
            const { custom } = record(ctx.env);
            expect(custom).to.include({
                status: 'PENDING', retryCount: 0, storeId: 'store_1', siteId: 'RefArch', idempotencyKey: 'sfcc:RefArch:00012345'
            });
            expect(JSON.parse(custom.payload)).to.include({ order_id: 'RefArch-00012345', event: 'order.placed' });
            expect(ctx.env.calls).to.have.length(0);
        });

        it('prevents duplicate records for the same order', () => {
            const ctx = setup();
            ctx.outbox.enqueue(createOrder());
            expect(ctx.outbox.enqueue(createOrder())).to.deep.equal({ queued: false, reason: 'DUPLICATE' });
        });

        it('skips disabled sync and orders that were not placed', () => {
            expect(setup({ prefs: { seetOrderSyncEnabled: false } }).outbox.enqueue(createOrder()).reason).to.equal('DISABLED');
            expect(setup().outbox.enqueue(createOrder({ status: 8 })).reason).to.equal('ORDER_NOT_PLACED');
        });

        it('never throws into checkout', () => {
            const ctx = setup();
            const broken = createOrder();
            broken.getAllProductLineItems = () => { throw new Error('boom'); };
            expect(ctx.outbox.enqueue(broken)).to.deep.equal({ queued: false, reason: 'ERROR' });
        });
    });

    describe('processDue', () => {
        it('syncs due records once and clears personal data', () => {
            const ctx = setup({ respond: () => ({ statusCode: 201, text: '{"success":true,"data":{"id":1}}' }) });
            enqueueAndBackdate(ctx);
            const stats = ctx.outbox.processDue('PENDING', ctx.options, NOW);
            expect(stats).to.include({ selected: 1, synced: 1 });
            expect(record(ctx.env).custom).to.include({ status: 'SYNCED', payload: null, nextRetryAt: null });
            expect(ctx.env.calls[0].headers['Idempotency-Key']).to.equal('sfcc:RefArch:00012345');
            expect(ctx.outbox.processDue('PENDING', ctx.options, NOW).selected).to.equal(0);
        });

        it('does not retry orders Seet rejects as invalid (422)', () => {
            const ctx = setup({ respond: () => ({ statusCode: 422, text: '{"message":"The customer.name field is required."}' }) });
            enqueueAndBackdate(ctx);
            expect(ctx.outbox.processDue('PENDING', ctx.options, NOW).dead).to.equal(1);
            expect(record(ctx.env).custom).to.include({ status: 'FAILED', nextRetryAt: null });
        });

        it('does not process records scheduled in the future', () => {
            const ctx = setup();
            ctx.outbox.enqueue(createOrder());
            record(ctx.env).custom.nextRetryAt = new Date(NOW.getTime() + MINUTE);
            expect(ctx.outbox.processDue('PENDING', ctx.options, NOW).selected).to.equal(0);
        });

        it('schedules retries with exponential backoff', () => {
            const ctx = setup({ respond: () => ({ statusCode: 500, text: '' }) });
            enqueueAndBackdate(ctx);
            ctx.outbox.processDue('PENDING', ctx.options, NOW);
            const { custom } = record(ctx.env);
            expect(custom).to.include({ status: 'FAILED', retryCount: 1 });
            expect(custom.nextRetryAt.getTime() - NOW.getTime()).to.equal(5 * MINUTE);

            const later = new Date(custom.nextRetryAt.getTime());
            ctx.outbox.processDue('FAILED', ctx.options, later);
            expect(custom.retryCount).to.equal(2);
            expect(custom.nextRetryAt.getTime() - later.getTime()).to.equal(10 * MINUTE);
            expect(ctx.outbox.computeNextRetryAt(20, ctx.options, NOW).getTime() - NOW.getTime()).to.equal(720 * MINUTE);
        });

        it('stops retrying permanent errors and exhausted records', () => {
            const ctx = setup({ respond: () => ({ statusCode: 422, text: '{"success":false,"error":{"code":"VALIDATION","message":"email customer@example.com invalid"}}' }) });
            enqueueAndBackdate(ctx);
            expect(ctx.outbox.processDue('PENDING', ctx.options, NOW).dead).to.equal(1);
            const { custom } = record(ctx.env);
            expect(custom.nextRetryAt).to.equal(null);
            expect(custom.lastError).to.include('HTTP | 422');
            expect(custom.lastError).to.not.include('customer@example.com');

            const lowered = setup({ respond: () => ({ statusCode: 503, text: '' }) });
            enqueueAndBackdate(lowered);
            lowered.outbox.processDue('PENDING', lowered.options, NOW);
            const failedRecord = record(lowered.env).custom;
            failedRecord.retryCount = 3;
            const loweredOpts = lowered.outbox.getOptions({ MaxRetries: 2 });
            const due = new Date(failedRecord.nextRetryAt.getTime());
            expect(lowered.outbox.processDue('FAILED', loweredOpts, due).dead).to.equal(1);
            expect(failedRecord.nextRetryAt).to.equal(null);
            expect(lowered.outbox.processDue('FAILED', loweredOpts, due).selected).to.equal(0);

            const retry = setup({ respond: () => ({ statusCode: 503, text: '' }) });
            enqueueAndBackdate(retry);
            const opts = retry.outbox.getOptions({ MaxRetries: 1 });
            expect(retry.outbox.processDue('PENDING', opts, NOW).dead).to.equal(1);
        });

        it('aborts the batch on authentication errors without consuming retries', () => {
            const ctx = setup({ respond: () => ({ statusCode: 401, text: '' }) });
            enqueueAndBackdate(ctx, createOrder({ orderNo: 'A1' }));
            enqueueAndBackdate(ctx, createOrder({ orderNo: 'A2' }));
            const stats = ctx.outbox.processDue('PENDING', ctx.options, NOW);
            expect(stats.aborted).to.equal(true);
            expect(ctx.env.calls).to.have.length(1);
            expect(record(ctx.env, 'A1').custom).to.include({ status: 'PENDING', retryCount: 0 });
        });

        ['CIRCUIT_BROKEN', 'CONFIG_PROBLEM'].forEach((reason) => {
            it(`aborts the batch without consuming a retry when the service reports ${reason}`, () => {
                const ctx = setup({ respond: () => ({ unavailable: reason }) });
                enqueueAndBackdate(ctx);
                expect(ctx.outbox.processDue('PENDING', ctx.options, NOW).aborted).to.equal(true);
                expect(record(ctx.env).custom).to.include({ status: 'PENDING', retryCount: 0 });
            });
        });

        it('skips records already claimed by another run', () => {
            const ctx = setup();
            enqueueAndBackdate(ctx);
            const rec = record(ctx.env);
            expect(ctx.outbox.claim(rec, 'PENDING', NOW)).to.equal(true);
            expect(ctx.outbox.claim(rec, 'PENDING', NOW)).to.equal(false);
        });

        it('never sends a record to a different Seet store (tenant isolation)', () => {
            const ctx = setup();
            enqueueAndBackdate(ctx);
            ctx.env.prefs.seetStoreId = 'store_other';
            expect(ctx.outbox.processDue('PENDING', ctx.options, NOW).dead).to.equal(1);
            expect(record(ctx.env).custom.lastError).to.include('STORE_MISMATCH');
            expect(ctx.env.calls).to.have.length(0);
        });

        it('sends the current order status at delivery time', () => {
            const ctx = setup();
            enqueueAndBackdate(ctx);
            ctx.env.orders['00012345'] = createOrder({ status: 5, shippingStatus: 2 });
            ctx.outbox.processDue('PENDING', ctx.options, NOW);
            expect(ctx.env.calls[0].body).to.include({ event: 'order.delivered', delivered_at: NOW.toISOString() });
        });

        it('keeps the time a status was first seen when the delivery is retried', () => {
            let statusCode = 503;
            const ctx = setup({ respond: () => ({ statusCode, text: '{}' }) });
            enqueueAndBackdate(ctx);
            ctx.env.orders['00012345'] = createOrder({ status: 5 });
            ctx.outbox.processDue('PENDING', ctx.options, NOW);
            statusCode = 200;
            const later = new Date(NOW.getTime() + (60 * MINUTE));
            ctx.outbox.processDue('FAILED', ctx.options, later);
            expect(ctx.env.calls[1].body).to.include({ event: 'order.delivered', delivered_at: NOW.toISOString() });
        });
    });

    it('recovers records stuck in PROCESSING', () => {
        const ctx = setup();
        enqueueAndBackdate(ctx);
        const rec = record(ctx.env);
        ctx.outbox.claim(rec, 'PENDING', new Date(NOW.getTime() - (31 * MINUTE)));
        expect(ctx.outbox.recoverStale(ctx.options, NOW)).to.equal(1);
        expect(rec.custom).to.include({ status: 'FAILED', retryCount: 1 });
    });

    describe('queueOrderUpdates', () => {
        const ok = { respond: () => ({ statusCode: 200, text: '{"message":"Order event received.","data":{}}' }) };
        function syncPlacedOrder(ctx) {
            enqueueAndBackdate(ctx);
            ctx.outbox.processDue('PENDING', ctx.options, NOW);
        }

        it('remembers the delivered event and leaves unchanged orders alone', () => {
            const ctx = setup(ok);
            syncPlacedOrder(ctx);
            expect(record(ctx.env).custom).to.include({ status: 'SYNCED', lastSyncedEvent: 'order.placed' });
            ctx.env.orders['00012345'] = createOrder({ lastModified: NOW });
            expect(ctx.outbox.queueOrderUpdates(ctx.options, NOW)).to.deep.equal({
                scanned: 1, queued: 0, updated: 0, errors: 0
            });
            expect(record(ctx.env).custom.status).to.equal('SYNCED');
        });

        it('queues a synced order again when its status changes and sends the new event once', () => {
            const ctx = setup(ok);
            syncPlacedOrder(ctx);
            const later = new Date(NOW.getTime() + (60 * MINUTE));
            ctx.env.orders['00012345'] = createOrder({ status: 5, shippingStatus: 2, lastModified: later });
            expect(ctx.outbox.queueOrderUpdates(ctx.options, later)).to.include({ updated: 1 });
            expect(record(ctx.env).custom).to.include({ status: 'PENDING', retryCount: 0 });
            expect(ctx.env.calls).to.have.length(1);

            ctx.outbox.processDue('PENDING', ctx.options, later);
            expect(ctx.env.calls[1].body).to.include({
                event: 'order.delivered', order_id: 'RefArch-00012345', delivered_at: later.toISOString()
            });
            expect(record(ctx.env).custom).to.include({ status: 'SYNCED', lastSyncedEvent: 'order.delivered', payload: null });
            expect(ctx.outbox.queueOrderUpdates(ctx.options, later)).to.include({ updated: 0 });
        });

        it('queues placed orders that have no outbox record and ignores old or unplaced orders', () => {
            const ctx = setup();
            ctx.env.orders.A = createOrder({ orderNo: 'A', lastModified: NOW });
            ctx.env.orders.B = createOrder({ orderNo: 'B', status: 0, lastModified: NOW });
            ctx.env.orders.C = createOrder({ orderNo: 'C', lastModified: new Date(NOW.getTime() - (25 * 60 * MINUTE)) });
            expect(ctx.outbox.queueOrderUpdates(ctx.options, NOW)).to.deep.equal({
                scanned: 2, queued: 1, updated: 0, errors: 0
            });
            expect(record(ctx.env, 'A').custom.status).to.equal('PENDING');
            expect(record(ctx.env, 'B')).to.equal(undefined);
            expect(ctx.env.calls).to.have.length(0);
        });

        it('does not touch records that are in flight, failed or owned by another store', () => {
            const ctx = setup(ok);
            syncPlacedOrder(ctx);
            const delivered = createOrder({ status: 5, lastModified: NOW });
            ctx.env.orders['00012345'] = delivered;
            ['PROCESSING', 'FAILED', 'PENDING'].forEach((status) => {
                record(ctx.env).custom.status = status;
                expect(ctx.outbox.queueOrderUpdates(ctx.options, NOW).updated).to.equal(0);
                expect(record(ctx.env).custom.status).to.equal(status);
            });
            record(ctx.env).custom.status = 'SYNCED';
            ctx.env.prefs.seetStoreId = 'store_2';
            expect(ctx.outbox.queueOrderUpdates(ctx.options, NOW).updated).to.equal(0);
        });
    });
});
