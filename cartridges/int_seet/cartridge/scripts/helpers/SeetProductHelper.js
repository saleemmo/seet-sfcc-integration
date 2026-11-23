'use strict';

/**
 * Product identification for Seet. Reviews are attached to the SFCC product ID
 * of the master product, so all variants of a product share the same reviews,
 * and order items report the same ID (variant ID is sent as "sku").
 */

var MAX_PRODUCT_ID_LENGTH = 100;
var INVALID_CHARACTERS = /[\u0000-\u001f\u007f<>"'`\\]/; // eslint-disable-line no-control-regex

/**
 * @param {*} productId - candidate product ID
 * @returns {boolean} whether the value is a syntactically valid SFCC product ID
 */
function isValidProductId(productId) {
    if (typeof productId !== 'string') {
        return false;
    }
    if (!productId.length || productId.length > MAX_PRODUCT_ID_LENGTH) {
        return false;
    }
    if (productId !== productId.trim()) {
        return false;
    }
    return !INVALID_CHARACTERS.test(productId);
}

/**
 * @param {dw.catalog.Product} product - API product
 * @returns {string|null} ID used as Seet external product ID
 */
function getReviewProductId(product) {
    if (!product) {
        return null;
    }
    if (product.isVariant() || product.isVariationGroup()) {
        var master = product.getMasterProduct();
        if (master) {
            return master.getID();
        }
    }
    return product.getID();
}

/**
 * Resolves a storefront product ID to the Seet product ID, rejecting unknown
 * or offline products so arbitrary IDs never reach the Seet API.
 * @param {string} productId - product ID from the request
 * @returns {string|null} Seet product ID or null
 */
function resolveReviewProductId(productId) {
    if (!isValidProductId(productId)) {
        return null;
    }
    var ProductMgr = require('dw/catalog/ProductMgr');
    var product = ProductMgr.getProduct(productId);
    if (!product || !product.isOnline()) {
        return null;
    }
    return getReviewProductId(product);
}

/**
 * @param {dw.order.ProductLineItem} lineItem - order line item
 * @returns {string} Seet product ID for the line item
 */
function getLineItemReviewProductId(lineItem) {
    var product = lineItem.getProduct();
    return product ? getReviewProductId(product) : lineItem.getProductID();
}

module.exports = {
    MAX_PRODUCT_ID_LENGTH: MAX_PRODUCT_ID_LENGTH,
    isValidProductId: isValidProductId,
    getReviewProductId: getReviewProductId,
    resolveReviewProductId: resolveReviewProductId,
    getLineItemReviewProductId: getLineItemReviewProductId
};
