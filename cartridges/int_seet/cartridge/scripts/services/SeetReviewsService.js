'use strict';

/**
 * Server-side access to Seet ratings and reviews through the public review
 * endpoints, which identify the store by its public key (seetStoreId). The
 * secret key is never sent here. Successful responses are stored in the
 * "SeetReviews" custom cache (see caches.json); failures are never cached so
 * the storefront recovers as soon as Seet is reachable again.
 */

var CacheMgr = require('dw/system/CacheMgr');
var Logger = require('dw/system/Logger');
var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
var SeetProductHelper = require('*/cartridge/scripts/helpers/SeetProductHelper');
var SeetReviewHelper = require('*/cartridge/scripts/helpers/SeetReviewHelper');
var SeetService = require('*/cartridge/scripts/services/SeetService');

var CACHE_ID = 'SeetReviews';
var RATING_PATH = '/public/product/rating-batch';
var REVIEWS_PATH = '/public/reviews';
// Seet splits product identifiers on these characters.
var LIST_SEPARATORS = /[;,]/;

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
 * @returns {string} host of the current storefront request, or empty string
 */
function getStorefrontHost() {
    var host = typeof request !== 'undefined' && request ? request.httpHost : null;
    return host ? String(host).toLowerCase() : '';
}

/**
 * Seet only serves a store's reviews to its allowed storefront domains and
 * checks the Origin (or Referer) header, so the storefront host is sent on its behalf.
 * @returns {Object|null} request headers
 */
function getStorefrontHeaders() {
    var host = getStorefrontHost();
    return host ? { Origin: 'https://' + host, Referer: 'https://' + host + '/' } : null;
}

/**
 * Tenant-scoped cache key: site and store are always part of the key. The
 * storefront host is part of it too, because Seet decides per host whether
 * the store's reviews may be shown.
 * @param {string[]} parts - key segments
 * @returns {string} cache key
 */
function buildCacheKey(parts) {
    return [SeetConfig.getSiteId(), SeetConfig.getStoreId(), getStorefrontHost()].concat(parts).join('|');
}

/**
 * @param {string} type - error type
 * @returns {Object} unavailable result
 */
function unavailable(type) {
    return { available: false, error: type };
}

/**
 * @param {string} productId - candidate product ID
 * @returns {boolean} whether the ID can be sent to Seet as a single identifier
 */
function isQueryableProductId(productId) {
    return SeetProductHelper.isValidProductId(productId) && !LIST_SEPARATORS.test(productId);
}

/**
 * @param {string} path - public endpoint path
 * @param {Object} query - query parameters
 * @returns {Object} normalized SeetService result
 */
function callPublic(path, query) {
    return SeetService.call({
        serviceId: SeetService.SERVICE_IDS.REVIEWS,
        method: 'GET',
        path: path,
        query: query,
        auth: false,
        headers: getStorefrontHeaders()
    });
}

/**
 * @param {string} productId - SFCC (master) product ID
 * @returns {{available: boolean, rating: (Object|null), error: (string|undefined)}} rating result
 */
function getProductRating(productId) {
    if (!isQueryableProductId(productId)) {
        return unavailable('INVALID_PRODUCT_ID');
    }

    var failure = null;
    var rating = getCached(buildCacheKey(['rating', productId]), function () {
        var result = callPublic(RATING_PATH, { store: SeetConfig.getStoreId(), sku: productId });
        if (result.ok) {
            var entry = Array.isArray(result.data) ? result.data[0] : null;
            return SeetReviewHelper.toRatingModel({
                product_id: productId,
                average_rating: entry ? entry.average_rating : 0,
                total: entry ? entry.num_ratings : 0
            });
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
 * @returns {{available: boolean, reviews: (Object|undefined), error: (string|undefined)}} reviews result;
 *   reviews holds the review list, its pagination and the rating summary
 */
function getProductReviews(productId, options) {
    if (!isQueryableProductId(productId)) {
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
        var result = callPublic(REVIEWS_PATH, {
            public_key: SeetConfig.getStoreId(),
            product_external_id: productId,
            page: paging.page,
            limit: paging.pageSize
        });
        if (result.ok) {
            var meta = result.meta || {};
            var model = SeetReviewHelper.toReviewsModel(result.data, meta, paging, locale);
            model.rating = SeetReviewHelper.toRatingModel({
                product_id: productId,
                average_rating: meta.average_rating,
                total: meta.total,
                distribution: meta.distribution
            });
            return model;
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
