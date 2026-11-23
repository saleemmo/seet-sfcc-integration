'use strict';

const { expect } = require('chai');
const { createEnv, createOrder } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

describe('Seet jobs', () => {
    function setup(options) {
        const env = createEnv(options);
        const load = createLoader(env);
        return {
            env, load, exportJob: load('scripts/jobs/ExportOrders'), retryJob: load('scripts/jobs/RetryFailedOrders')
        };
    }

    it('return DISABLED when order sync is off', () => {
        const ctx = setup({ prefs: { seetOrderSyncEnabled: false } });
        expect(ctx.exportJob.execute({}).code).to.equal('DISABLED');
        expect(ctx.retryJob.execute({}).code).to.equal('DISABLED');
    });

    it('export queued orders and report statistics', () => {
        const ctx = setup({ respond: () => ({ statusCode: 201, text: '{"success":true}' }) });
        ctx.load('scripts/helpers/SeetOutboxHelper').enqueue(createOrder());
        ctx.env.customObjects['SeetOrderOutbox|00012345'].custom.nextRetryAt = new Date(Date.now() - 1000);
        const status = ctx.exportJob.execute({ BatchSize: 10 });
        expect(status.status).to.equal(0);
        expect(JSON.parse(status.message)).to.include({ selected: 1, synced: 1 });
    });

    it('fail the step when the batch is aborted', () => {
        const ctx = setup({ respond: () => ({ statusCode: 403, text: '' }) });
        ctx.load('scripts/helpers/SeetOutboxHelper').enqueue(createOrder());
        ctx.env.customObjects['SeetOrderOutbox|00012345'].custom.nextRetryAt = new Date(Date.now() - 1000);
        const status = ctx.exportJob.execute({});
        expect(status).to.include({ status: 1, code: 'ABORTED' });
    });
});
