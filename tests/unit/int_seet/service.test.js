'use strict';

const { expect } = require('chai');
const { createEnv } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

describe('SeetService', () => {
    function setup(options) {
        const env = createEnv(options);
        return { env, service: createLoader(env)('scripts/services/SeetService') };
    }
    const request = { serviceId: 'seet.http.reviews', method: 'GET', path: '/api/v1/integrations/sfcc/health' };

    it('authenticates with the store API key and sends the store context', () => {
        const { env, service } = setup();
        const result = service.call({ ...request, query: { page: 2, empty: '' } });
        expect(result.ok).to.equal(true);
        const call = env.calls[0];
        expect(call.url).to.equal('https://api.seet.test/api/v1/integrations/sfcc/health?page=2');
        expect(call.headers.Authorization).to.equal('Bearer key_default');
        expect(call.headers['X-Seet-Store-Id']).to.equal('store_1');
        expect(call.headers['X-Seet-Site-Id']).to.equal('RefArch');
        expect(call.authentication).to.equal('NONE');
    });

    it('uses a per-site credential override for multi-store realms', () => {
        const { env, service } = setup({
            prefs: { seetServiceCredentialId: 'seet.http.api.cred.brandB', seetStoreId: 'store_B' },
            credentials: { 'seet.http.api.cred.brandB': { url: 'https://api.seet.test', password: 'key_B' } }
        });
        service.call(request);
        expect(env.calls[0].credentialId).to.equal('seet.http.api.cred.brandB');
        expect(env.calls[0].headers.Authorization).to.equal('Bearer key_B');
        expect(env.calls[0].headers['X-Seet-Store-Id']).to.equal('store_B');
    });

    it('falls back to the credential URL when no base URL preference is set', () => {
        const { env, service } = setup({ prefs: { seetApiBaseUrl: '' } });
        service.call(request);
        expect(env.calls[0].url).to.match(/^https:\/\/api\.seet\.test\//);
    });

    it('never sends the API key to a host other than the credential URL host', () => {
        const { env, service } = setup({ prefs: { seetApiBaseUrl: 'https://attacker.example' } });
        expect(service.call(request).error.type).to.equal('CONFIG');
        const sameHost = setup({ prefs: { seetApiBaseUrl: 'https://API.seet.test/v2' } });
        sameHost.service.call(request);
        expect(sameHost.env.calls[0].url).to.equal('https://API.seet.test/v2/api/v1/integrations/sfcc/health');
        expect(env.calls).to.have.length(0);
    });

    it('does not call the API without an API key or with an insecure URL', () => {
        let ctx = setup({ credentials: { 'seet.http.api.cred': { url: 'https://cred.seet.test', password: '' } } });
        expect(ctx.service.call(request).error.type).to.equal('CONFIG');
        ctx = setup({ prefs: { seetApiBaseUrl: '' }, credentials: { 'seet.http.api.cred': { url: 'http://cred.seet.test', password: 'k' } } });
        expect(ctx.service.call(request).error.type).to.equal('CONFIG');
        expect(ctx.env.calls).to.have.length(0);
    });

    it('classifies failures as retryable or permanent', () => {
        const responses = [
            { statusCode: 500, text: '' },
            { statusCode: 422, text: '{"success":false,"error":{"code":"VALIDATION","message":"bad"}}' },
            { statusCode: 429, text: '' },
            { unavailable: 'TIMEOUT' },
            { statusCode: 200, text: 'not json' }
        ];
        const { service } = setup({ respond: () => responses.shift() });
        const results = [1, 2, 3, 4, 5].map(() => service.call(request));
        expect(results.map((r) => r.error.retryable)).to.deep.equal([true, false, true, true, true]);
        expect(results[1].error.message).to.equal('HTTP 422: VALIDATION: bad');
        expect(results[3].error).to.include({ type: 'UNAVAILABLE', reason: 'TIMEOUT' });
        expect(results[4].error.type).to.equal('PARSE');
    });

    it('redacts secrets and personal data from log messages', () => {
        const { env, service } = setup();
        service.call(request);
        const text = '{"email":"a@b.com","phone":"+966500000000","external_order_id":"00012345"} Bearer abc.def';
        const redacted = env.lastCallbacks.getRequestLogMessage(text);
        expect(redacted).to.not.include('a@b.com');
        expect(redacted).to.not.include('+966500000000');
        expect(redacted).to.not.include('abc.def');
        expect(redacted).to.include('00012345');
    });
});
