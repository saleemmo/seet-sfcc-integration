'use strict';

const { expect } = require('chai');
const { createEnv } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

const RATING = [{ sku: 'P1', average_rating: '4.7', num_ratings: 125 }];
const REVIEWS = {
    data: [{
        id: 1, title: 'Great', content: 'Nice <b>fit</b>', rating: 5, reviewer: 'Sara', created_at: '2026-11-01 10:00:00', verified: true
    }],
    meta: {
        total: 12,
        filtered_total: 12,
        current_page: 2,
        last_page: 3,
        per_page: 5,
        average_rating: 4.7,
        distribution: {
            5: 9, 4: 3, 3: 0, 2: 0, 1: 0
        }
    }
};

describe('SeetReviewsService', () => {
    function setup(respond, options = {}) {
        const env = createEnv({ respond, ...options });
        return { env, reviews: createLoader(env)('scripts/services/SeetReviewsService') };
    }

    it('maps the product rating', () => {
        const { env, reviews } = setup(() => ({ statusCode: 200, text: JSON.stringify(RATING) }));
        const result = reviews.getProductRating('P1');
        expect(env.calls[0].url).to.equal('https://api.seet.test/api/v1/public/product/rating-batch?store=store_1&sku=P1');
        expect(result.available).to.equal(true);
        expect(result.rating).to.include({
            averageRating: 4.7, averageDisplay: '4.7', totalReviews: 125, percent: 94
        });
    });

    it('maps reviews and validates pagination before calling the API', () => {
        const { env, reviews } = setup(() => ({ statusCode: 200, text: JSON.stringify(REVIEWS) }));
        const result = reviews.getProductReviews('P 1/x', { page: '-3', pageSize: 999, locale: 'ar_SA' });
        expect(env.calls[0].url).to.equal('https://api.seet.test/api/v1/public/reviews?public_key=store_1&product_external_id=P%201%2Fx&page=1&limit=50');
        const review = result.reviews.reviews[0];
        expect(review).to.include({
            title: 'Great', content: 'Nice <b>fit</b>', authorName: 'Sara', verifiedPurchase: true, dateDisplay: 'ar_SA:2026-11-01'
        });
        expect(result.reviews.rating).to.include({ averageDisplay: '4.7', totalReviews: 12 });
        expect(result.reviews.rating.distribution[0]).to.deep.equal({ stars: 5, count: 9, percent: 75 });
        expect(result.reviews.pagination).to.include({
            page: 2, totalPages: 3, previousPage: 1, nextPage: 3
        });
    });

    it('rejects invalid product IDs without calling the API', () => {
        const { env, reviews } = setup();
        ['', ' P1', 'x'.repeat(101), '<script>', null].forEach((id) => {
            expect(reviews.getProductRating(id)).to.deep.equal({ available: false, error: 'INVALID_PRODUCT_ID' });
        });
        expect(env.calls).to.have.length(0);
    });

    it('caches successful responses per site and store', () => {
        const { env, reviews } = setup(() => ({ statusCode: 200, text: JSON.stringify(RATING) }));
        reviews.getProductRating('P1');
        reviews.getProductRating('P1');
        expect(env.calls).to.have.length(1);
        env.prefs.seetStoreId = 'store_2';
        reviews.getProductRating('P1');
        expect(env.calls).to.have.length(2);
        expect(Object.keys(env.cacheStore)).to.deep.equal(['RefArch|store_1|rating|P1', 'RefArch|store_2|rating|P1']);
    });

    it('degrades gracefully and does not cache failures', () => {
        let status = 503;
        const { env, reviews } = setup(() => ({ statusCode: status, text: status === 200 ? JSON.stringify(RATING) : '' }));
        expect(reviews.getProductRating('P1')).to.deep.equal({ available: false, error: 'HTTP' });
        status = 200;
        expect(reviews.getProductRating('P1').available).to.equal(true);
        expect(env.calls).to.have.length(2);
    });

    it('shows no reviews for products Seet does not know', () => {
        const { reviews } = setup((call) => ({
            statusCode: 200,
            text: call.url.indexOf('rating-batch') > -1
                ? JSON.stringify([{ sku: 'P1', average_rating: '0', num_ratings: 0 }])
                : JSON.stringify({
                    data: [],
                    meta: {
                        total: 0, filtered_total: 0, current_page: 1, last_page: 1, per_page: 5
                    }
                })
        }));
        expect(reviews.getProductRating('P1').rating.totalReviews).to.equal(0);
        const result = reviews.getProductReviews('P1').reviews;
        expect(result.reviews).to.deep.equal([]);
        expect(result.rating.totalReviews).to.equal(0);
    });

    it('reports an invalid public key (404) or a blocked storefront domain (403) as unavailable', () => {
        [404, 403].forEach((statusCode) => {
            const { env, reviews } = setup(() => ({ statusCode, text: '{"message":"Invalid public key."}' }));
            expect(reviews.getProductRating('P1')).to.deep.equal({ available: false, error: 'HTTP' });
            expect(reviews.getProductReviews('P1').available).to.equal(false);
            expect(Object.keys(env.cacheStore)).to.have.length(0);
        });
    });

    it('identifies the store by its public key and never sends the secret key', () => {
        const { env, reviews } = setup(() => ({ statusCode: 200, text: JSON.stringify(RATING) }), {
            credentials: { 'seet.http.api.cred': { url: 'https://api.seet.test/api/v1', password: '' } }
        });
        global.request = { httpHost: 'shop.example.com' };
        try {
            expect(reviews.getProductRating('P1').available).to.equal(true);
        } finally {
            delete global.request;
        }
        expect(env.calls[0].headers).to.not.have.property('Authorization');
        expect(env.calls[0].headers).to.include({ Origin: 'https://shop.example.com', Referer: 'https://shop.example.com/' });
        expect(reviews.getProductRating('P1;P2')).to.deep.equal({ available: false, error: 'INVALID_PRODUCT_ID' });
    });
});
