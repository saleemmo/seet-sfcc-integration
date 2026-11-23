'use strict';

/**
 * Reads and validates the Seet configuration stored in custom Site Preferences.
 * The API key is NOT a site preference: it lives in the service credential
 * (see SeetService.js) and is never returned by this module.
 */

var Site = require('dw/system/Site');

var DEFAULT_REVIEW_PAGE_SIZE = 5;
var MAX_REVIEW_PAGE_SIZE = 50;
var DEFAULT_CACHE_MINUTES = 60;
var MAX_CACHE_MINUTES = 1440;
var STORE_ID_PATTERN = /^[A-Za-z0-9_-]{1,64}$/;
var HTTPS_URL_PATTERN = /^https:\/\/[^\s/?#]+(\/[^\s?#]*)?$/i;

var DEFAULT_ORDER_STATUS_MAPPING = {
    CREATED: 'created',
    NEW: 'placed',
    OPEN: 'placed',
    COMPLETED: 'completed',
    CANCELLED: 'cancelled',
    REPLACED: 'replaced',
    FAILED: 'failed'
};

/**
 * @param {string} name - Site preference ID
 * @returns {*} preference value or null
 */
function getPreference(name) {
    var site = Site.getCurrent();
    if (!site) {
        return null;
    }
    var value = site.getCustomPreferenceValue(name);
    return value === undefined ? null : value;
}

/**
 * @param {string} name - Site preference ID
 * @returns {string} trimmed string value or empty string
 */
function getString(name) {
    var value = getPreference(name);
    return value === null ? '' : String(value).trim();
}

/**
 * @param {string} name - Site preference ID
 * @returns {boolean} true only when the preference is explicitly true
 */
function getBoolean(name) {
    return getPreference(name) === true;
}

/**
 * @param {string} name - Site preference ID
 * @param {number} defaultValue - value used when unset or invalid
 * @param {number} min - lower bound
 * @param {number} max - upper bound
 * @returns {number} bounded integer
 */
function getInteger(name, defaultValue, min, max) {
    var value = parseInt(getPreference(name), 10);
    if (isNaN(value)) {
        return defaultValue;
    }
    return Math.min(Math.max(value, min), max);
}

/**
 * @param {string} url - URL to check
 * @returns {boolean} whether the URL is an absolute HTTPS URL
 */
function isHttpsUrl(url) {
    return typeof url === 'string' && HTTPS_URL_PATTERN.test(url);
}

/**
 * @returns {string} current site ID
 */
function getSiteId() {
    var site = Site.getCurrent();
    return site ? site.getID() : '';
}

/**
 * @returns {boolean} master switch
 */
function isEnabled() {
    return getBoolean('seetEnabled');
}

/**
 * @returns {string} Seet Store ID for the current site
 */
function getStoreId() {
    return getString('seetStoreId');
}

/**
 * @returns {string} API base URL without trailing slash, or empty string
 */
function getApiBaseUrl() {
    return getString('seetApiBaseUrl').replace(/\/+$/, '');
}

/**
 * Optional per-site service credential override (for realms that host several
 * Seet stores). Empty means the credential bound to the service is used.
 * @returns {string} service credential ID or empty string
 */
function getServiceCredentialId() {
    return getString('seetServiceCredentialId');
}

/**
 * @returns {number} reviews page size (1..50)
 */
function getReviewPageSize() {
    return getInteger('seetReviewPageSize', DEFAULT_REVIEW_PAGE_SIZE, 1, MAX_REVIEW_PAGE_SIZE);
}

/**
 * @returns {number} page cache period for storefront fragments, in minutes
 */
function getCacheMinutes() {
    return getInteger('seetCacheMinutes', DEFAULT_CACHE_MINUTES, 1, MAX_CACHE_MINUTES);
}

/**
 * Mapping of SFCC order status names to Seet status values. Merchants can
 * override it with a JSON object in the seetOrderStatusMapping preference.
 * @returns {Object} status mapping
 */
function getOrderStatusMapping() {
    var mapping = {};
    Object.keys(DEFAULT_ORDER_STATUS_MAPPING).forEach(function (key) {
        mapping[key] = DEFAULT_ORDER_STATUS_MAPPING[key];
    });
    var raw = getString('seetOrderStatusMapping');
    if (raw) {
        try {
            var custom = JSON.parse(raw);
            if (custom && typeof custom === 'object' && !Array.isArray(custom)) {
                Object.keys(custom).forEach(function (key) {
                    if (typeof custom[key] === 'string' && custom[key]) {
                        mapping[key.toUpperCase()] = custom[key];
                    }
                });
            }
        } catch (e) {
            require('dw/system/Logger').getLogger('seet', 'SeetConfig')
                .warn('seetOrderStatusMapping is not valid JSON; using defaults');
        }
    }
    return mapping;
}

/**
 * Validates the configuration needed to call the Seet API.
 * @returns {{valid: boolean, errors: string[]}} validation result
 */
function validate() {
    var errors = [];
    var storeId = getStoreId();
    var baseUrl = getApiBaseUrl();

    if (!storeId) {
        errors.push('seetStoreId is not configured');
    } else if (!STORE_ID_PATTERN.test(storeId)) {
        errors.push('seetStoreId has an invalid format');
    }
    if (baseUrl && !isHttpsUrl(baseUrl)) {
        errors.push('seetApiBaseUrl must be an absolute HTTPS URL');
    }
    return { valid: errors.length === 0, errors: errors };
}

/**
 * @returns {boolean} whether storefront reviews should be rendered
 */
function isReviewsEnabled() {
    return isEnabled() && getBoolean('seetReviewsEnabled') && validate().valid;
}

/**
 * @returns {boolean} whether orders should be queued and exported
 */
function isOrderSyncEnabled() {
    return isEnabled() && getBoolean('seetOrderSyncEnabled') && validate().valid;
}

module.exports = {
    DEFAULT_REVIEW_PAGE_SIZE: DEFAULT_REVIEW_PAGE_SIZE,
    MAX_REVIEW_PAGE_SIZE: MAX_REVIEW_PAGE_SIZE,
    isHttpsUrl: isHttpsUrl,
    getSiteId: getSiteId,
    isEnabled: isEnabled,
    getStoreId: getStoreId,
    getApiBaseUrl: getApiBaseUrl,
    getServiceCredentialId: getServiceCredentialId,
    getReviewPageSize: getReviewPageSize,
    getCacheMinutes: getCacheMinutes,
    getOrderStatusMapping: getOrderStatusMapping,
    validate: validate,
    isReviewsEnabled: isReviewsEnabled,
    isOrderSyncEnabled: isOrderSyncEnabled
};
