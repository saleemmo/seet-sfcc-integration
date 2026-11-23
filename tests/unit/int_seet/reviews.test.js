'use strict';

const { expect } = require('chai');
const { createEnv } = require('../../mocks/dw');
const { createLoader } = require('../../mocks/loader');

const RATING = {
    success: true,
    data: {
        product_id: 'P1',
        average_rating: 4.66,
        total_reviews: 125,
        rating_distribution: {
            5: 100, 4: 15, 3: 5, 2: 3, 1: 2
        }
    }
};
const REVIEWS = {
    success: true,
    data: {
        reviews: [{
            id: 1, title: 'Great', content: 'Nice <b>fit</b>', rating: 5, author_name: 'Sara', created_at: '2026-11-01T10:00:00Z', verified_purchase: true
        }],
        pagination: {
            page: 2, page_size: 5, total: 12, total_pages: 3
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
        expect(env.calls[0].url).to.equal('https://api.seet.test/api/v1/integrations/sfcc/products/P1/rating');
        expect(result.available).to.equal(true);
        expect(result.rating).to.include({
            averageRating: 4.7, averageDisplay: '4.7', totalReviews: 125, percent: 94
        });
        expect(result.rating.distribution[0]).to.deep.equal({ stars: 5, count: 100, percent: 80 });
    });

    it('maps reviews and validates pagination before calling the API', () => {
        const { env, reviews } = setup(() => ({ statusCode: 200, text: JSON.stringify(REVIEWS) }));
        const result = reviews.getProductReviews('P 1/x', { page: '-3', pageSize: 999, locale: 'ar_SA' });
        expect(env.calls[0].url).to.equal('https://api.seet.test/api/v1/integrations/sfcc/products/P%201%2Fx/reviews?page=1&per_page=50');
        const review = result.reviews.reviews[0];
        expect(review).to.include({
            title: 'Great', content: 'Nice <b>fit</b>', verifiedPurchase: true, dateDisplay: 'ar_SA:2026-11-01'
        });
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

    it('treats unknown products in Seet as having no reviews', () => {
        const { reviews } = setup(() => ({ statusCode: 404, text: '' }));
        expect(reviews.getProductRating('P1').rating.totalReviews).to.equal(0);
        expect(reviews.getProductReviews('P1').reviews.reviews).to.deep.equal([]);
    });
});
