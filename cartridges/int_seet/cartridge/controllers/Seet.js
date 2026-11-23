'use strict';

/**
 * Storefront endpoints for Seet ratings and reviews. Seet-Rating and
 * Seet-Reviews are remote includes (page cached independently of the product
 * page); Seet-ReviewsList returns the paginated list fragment for AJAX paging.
 * The browser never talks to the Seet API directly.
 */

var server = require('server');

var FALLBACK_CACHE_MINUTES = 5;

/**
 * Successful fragments are cached for the configured period; fallbacks only
 * briefly, so the storefront recovers quickly once Seet is reachable.
 * @param {Object} res - SFRA response
 * @param {boolean} success - whether Seet data was available
 */
function applyCache(res, success) {
    var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
    res.cachePeriod = success ? SeetConfig.getCacheMinutes() : FALLBACK_CACHE_MINUTES; // eslint-disable-line no-param-reassign
    res.cachePeriodUnit = 'minutes'; // eslint-disable-line no-param-reassign
    res.personalized = false; // eslint-disable-line no-param-reassign
}

/**
 * @param {Object} req - SFRA request
 * @returns {Object|null} reviews view data, or null when nothing should render
 */
function getReviewsViewData(req) {
    var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
    var SeetProductHelper = require('*/cartridge/scripts/helpers/SeetProductHelper');
    var SeetReviewsService = require('*/cartridge/scripts/services/SeetReviewsService');

    if (!SeetConfig.isReviewsEnabled()) {
        return null;
    }
    var productId = SeetProductHelper.resolveReviewProductId(req.querystring.pid);
    if (!productId) {
        return null;
    }

    var reviewsResult = SeetReviewsService.getProductReviews(productId, {
        page: req.querystring.page,
        locale: req.locale && req.locale.id
    });

    return {
        productId: productId,
        available: reviewsResult.available,
        rating: reviewsResult.available ? reviewsResult.reviews.rating : null,
        reviews: reviewsResult.available ? reviewsResult.reviews.reviews : [],
        pagination: reviewsResult.available ? reviewsResult.reviews.pagination : null
    };
}

server.get('Rating', server.middleware.include, function (req, res, next) {
    var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
    var SeetProductHelper = require('*/cartridge/scripts/helpers/SeetProductHelper');
    var SeetReviewsService = require('*/cartridge/scripts/services/SeetReviewsService');

    var rating = null;
    var success = true;
    if (SeetConfig.isReviewsEnabled()) {
        var productId = SeetProductHelper.resolveReviewProductId(req.querystring.pid);
        if (productId) {
            var result = SeetReviewsService.getProductRating(productId);
            success = result.available;
            rating = result.available ? result.rating : null;
        }
    }

    applyCache(res, success);
    res.render('product/seetRating', { seetRating: rating });
    next();
});

server.get('Reviews', server.middleware.include, function (req, res, next) {
    var viewData = getReviewsViewData(req);
    applyCache(res, !viewData || viewData.available);
    res.render('product/seetReviews', { seetReviews: viewData });
    next();
});

server.get('ReviewsList', function (req, res, next) {
    var viewData = getReviewsViewData(req);
    applyCache(res, !viewData || viewData.available);
    res.render('product/components/seetReviewList', { seetReviews: viewData });
    next();
});

module.exports = server.exports();
