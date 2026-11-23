'use strict';

/**
 * Server-side access to Seet ratings and reviews. Successful responses are
 * stored in the "SeetReviews" custom cache (see caches.json); failures are
 * never cached so the storefront recovers as soon as Seet is reachable again.
 */

var CacheMgr = require('dw/system/CacheMgr');
var Logger = require('dw/system/Logger');
var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
var SeetProductHelper = require('*/cartridge/scripts/helpers/SeetProductHelper');
var SeetReviewHelper = require('*/cartridge/scripts/helpers/SeetReviewHelper');
var SeetService = require('*/cartridge/scripts/services/SeetService');

var CACHE_ID = 'SeetReviews';
var API_PREFIX = '/api/v1/integrations/sfcc/products/';

var log = Logger.getLogger('seet', 'SeetReviewsService');

/**
 * @param {string} key - cache key
 * @param {Function} loader - returns the value to cache, or undefined to skip caching
 * @returns {*} cached or freshly loaded value
 */
function getCached(key, loader) {
    var cache;
    try {
        cache = CacheMgr.getCache(CACHE_ID);
    } catch (e) {
        log.warn('Custom cache {0} is unavailable: {1}', CACHE_ID, e.message);
        return loader();
    }
    return cache.get(key, loader);
}

/**
 * Tenant-scoped cache key: site and store are always part of the key.
 * @param {string[]} parts - key segments
 * @returns {string} cache key
 */
function buildCacheKey(parts) {
    return [SeetConfig.getSiteId(), SeetConfig.getStoreId()].concat(parts).join('|');
}

/**
 * @param {string} type - error type
 * @returns {Object} unavailable result
 */
function unavailable(type) {
    return { available: false, error: type };
}

/**
 * @param {string} productId - SFCC (master) product ID
 * @returns {{available: boolean, rating: (Object|null), error: (string|undefined)}} rating result
 */
function getProductRating(productId) {
    if (!SeetProductHelper.isValidProductId(productId)) {
        return unavailable('INVALID_PRODUCT_ID');
    }

    var failure = null;
    var rating = getCached(buildCacheKey(['rating', productId]), function () {
        var result = SeetService.call({
            serviceId: SeetService.SERVICE_IDS.REVIEWS,
            method: 'GET',
            path: API_PREFIX + encodeURIComponent(productId) + '/rating'
        });
        if (result.ok) {
            return SeetReviewHelper.toRatingModel(result.data) || SeetReviewHelper.toRatingModel({ product_id: productId });
        }
        if (result.statusCode === 404) {
            return SeetReviewHelper.toRatingModel({ product_id: productId });
        }
        failure = result.error;
        return undefined;
    });

    if (!rating) {
        return unavailable(failure ? failure.type : 'UNKNOWN');
    }
    return { available: true, rating: rating };
}

/**
 * @param {string} productId - SFCC (master) product ID
 * @param {Object} [options] - options
 * @param {number} [options.page] - 1-based page number
 * @param {number} [options.pageSize] - page size
 * @param {string} [options.locale] - locale used for date formatting
 * @returns {{available: boolean, reviews: (Object|undefined), error: (string|undefined)}} reviews result
 */
function getProductReviews(productId, options) {
    if (!SeetProductHelper.isValidProductId(productId)) {
        return unavailable('INVALID_PRODUCT_ID');
    }
    var opts = options || {};
    var paging = SeetReviewHelper.parsePagination(
        opts.page,
        opts.pageSize,
        SeetConfig.getReviewPageSize(),
        SeetConfig.MAX_REVIEW_PAGE_SIZE
    );
    var locale = opts.locale || 'default';

    var failure = null;
    var key = buildCacheKey(['reviews', productId, paging.page, paging.pageSize, locale]);
    var reviews = getCached(key, function () {
        var result = SeetService.call({
            serviceId: SeetService.SERVICE_IDS.REVIEWS,
            method: 'GET',
            path: API_PREFIX + encodeURIComponent(productId) + '/reviews',
            query: { page: paging.page, per_page: paging.pageSize }
        });
        if (result.ok) {
            return SeetReviewHelper.toReviewsModel(result.data, paging, locale);
        }
        if (result.statusCode === 404) {
            return SeetReviewHelper.toReviewsModel(null, paging, locale);
        }
        failure = result.error;
        return undefined;
    });

    if (!reviews) {
        return unavailable(failure ? failure.type : 'UNKNOWN');
    }
    return { available: true, reviews: reviews };
}

module.exports = {
    CACHE_ID: CACHE_ID,
    getProductRating: getProductRating,
    getProductReviews: getProductReviews
};
