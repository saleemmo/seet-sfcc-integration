'use strict';

/**
 * Maps Seet API responses to storefront view models and validates pagination
 * input. Contains presentation mapping only; review business rules stay in Seet.
 */

var MAX_PAGE = 1000;
var MAX_TEXT_LENGTH = 5000;

/**
 * @param {*} value - candidate number
 * @param {number} fallback - value used when not numeric
 * @returns {number} finite number
 */
function toNumber(value, fallback) {
    var number = Number(value);
    return isFinite(number) ? number : fallback;
}

/**
 * @param {*} value - candidate count
 * @returns {number} non-negative integer
 */
function toCount(value) {
    return Math.max(0, Math.floor(toNumber(value, 0)));
}

/**
 * @param {*} value - candidate text
 * @returns {string} trimmed, bounded text
 */
function toText(value) {
    if (value === null || value === undefined) {
        return '';
    }
    return String(value).trim().substring(0, MAX_TEXT_LENGTH);
}

/**
 * @param {*} value - candidate rating
 * @returns {number} rating clamped to 0..5 with one decimal
 */
function toRating(value) {
    var rating = Math.min(Math.max(toNumber(value, 0), 0), 5);
    return Math.round(rating * 10) / 10;
}

/**
 * Parses and bounds pagination parameters coming from the storefront request.
 * @param {*} page - requested page
 * @param {*} pageSize - requested page size
 * @param {number} defaultPageSize - configured page size
 * @param {number} maxPageSize - maximum page size
 * @returns {{page: number, pageSize: number}} safe pagination values
 */
function parsePagination(page, pageSize, defaultPageSize, maxPageSize) {
    var parsedPage = parseInt(page, 10);
    var parsedSize = parseInt(pageSize, 10);
    return {
        page: isNaN(parsedPage) || parsedPage < 1 ? 1 : Math.min(parsedPage, MAX_PAGE),
        pageSize: isNaN(parsedSize) || parsedSize < 1 ? defaultPageSize : Math.min(parsedSize, maxPageSize)
    };
}

/**
 * @param {string} dateText - ISO-8601 or "YYYY-MM-DD HH:mm:ss" date string
 * @param {string} locale - request locale ID
 * @returns {string} localized date or empty string
 */
function formatDate(dateText, locale) {
    if (!dateText) {
        return '';
    }
    var date = new Date(String(dateText).replace(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2})$/, '$1T$2Z'));
    if (isNaN(date.getTime())) {
        return '';
    }
    try {
        var Calendar = require('dw/util/Calendar');
        var StringUtils = require('dw/util/StringUtils');
        return StringUtils.formatCalendar(new Calendar(date), locale, Calendar.LONG_DATE_PATTERN);
    } catch (e) {
        return date.toISOString().substring(0, 10);
    }
}

/**
 * @param {Object} data - rating summary
 * @param {string} data.product_id - product ID the summary belongs to
 * @param {number|string} data.average_rating - average rating
 * @param {number} data.total - number of reviews
 * @param {Object} [data.distribution] - review count per star value
 * @returns {Object|null} rating view model
 */
function toRatingModel(data) {
    if (!data || typeof data !== 'object') {
        return null;
    }
    var total = toCount(data.total);
    var average = toRating(data.average_rating);
    var distributionSource = data.distribution || {};
    var distribution = [5, 4, 3, 2, 1].map(function (stars) {
        var count = toCount(distributionSource[String(stars)]);
        return {
            stars: stars,
            count: count,
            percent: total > 0 ? Math.round((count / total) * 100) : 0
        };
    });

    return {
        productId: toText(data.product_id),
        averageRating: average,
        averageDisplay: average.toFixed(1),
        percent: Math.round((average / 5) * 100),
        totalReviews: total,
        distribution: distribution
    };
}

/**
 * @param {Object} review - review from the Seet API
 * @param {string} locale - request locale ID
 * @returns {Object} review view model
 */
function toReviewModel(review, locale) {
    var rating = Math.round(toRating(review.rating));
    return {
        id: toText(review.id),
        title: toText(review.title),
        content: toText(review.content),
        rating: rating,
        percent: rating * 20,
        authorName: toText(review.reviewer),
        date: toText(review.created_at),
        dateDisplay: formatDate(review.created_at, locale),
        verifiedPurchase: review.verified === true
    };
}

/**
 * @param {Array} data - "data" array of GET /public/reviews
 * @param {Object} meta - "meta" object of GET /public/reviews
 * @param {Object} requested - requested pagination
 * @param {string} locale - request locale ID
 * @returns {Object} reviews view model
 */
function toReviewsModel(data, meta, requested, locale) {
    var source = Array.isArray(data) ? data : [];
    var pagination = meta || {};
    var page = toCount(pagination.current_page) || requested.page;
    var pageSize = toCount(pagination.per_page) || requested.pageSize;
    var total = toCount(pagination.filtered_total !== undefined ? pagination.filtered_total : pagination.total);
    var totalPages = toCount(pagination.last_page) || (total ? Math.ceil(total / pageSize) : 1);

    return {
        reviews: source.filter(function (review) {
            return review && typeof review === 'object';
        }).map(function (review) {
            return toReviewModel(review, locale);
        }),
        pagination: {
            page: page,
            pageSize: pageSize,
            total: total,
            totalPages: totalPages,
            hasPrevious: page > 1,
            hasNext: page < totalPages,
            previousPage: page > 1 ? page - 1 : null,
            nextPage: page < totalPages ? page + 1 : null
        }
    };
}

module.exports = {
    MAX_PAGE: MAX_PAGE,
    parsePagination: parsePagination,
    formatDate: formatDate,
    toRatingModel: toRatingModel,
    toReviewModel: toReviewModel,
    toReviewsModel: toReviewsModel
};
