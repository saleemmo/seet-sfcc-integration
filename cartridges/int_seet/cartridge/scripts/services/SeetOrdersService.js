'use strict';

/**
 * Order payload mapping and order export calls to Seet. Only the data Seet
 * needs for review invitations is sent: no payment data, no addresses.
 */

var Order = require('dw/order/Order');
var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
var SeetProductHelper = require('*/cartridge/scripts/helpers/SeetProductHelper');
var SeetService = require('*/cartridge/scripts/services/SeetService');

var ORDERS_PATH = '/api/v1/integrations/sfcc/orders';

/**
 * @returns {Object} map of SFCC order status code to status name
 */
function getOrderStatusNames() {
    var names = {};
    names[Order.ORDER_STATUS_CREATED] = 'CREATED';
    names[Order.ORDER_STATUS_NEW] = 'NEW';
    names[Order.ORDER_STATUS_OPEN] = 'OPEN';
    names[Order.ORDER_STATUS_COMPLETED] = 'COMPLETED';
    names[Order.ORDER_STATUS_CANCELLED] = 'CANCELLED';
    names[Order.ORDER_STATUS_REPLACED] = 'REPLACED';
    names[Order.ORDER_STATUS_FAILED] = 'FAILED';
    return names;
}

/**
 * @returns {Object} map of SFCC shipping status code to Seet shipping status
 */
function getShippingStatusNames() {
    var names = {};
    names[Order.SHIPPING_STATUS_NOTSHIPPED] = 'not_shipped';
    names[Order.SHIPPING_STATUS_PARTSHIPPED] = 'partially_shipped';
    names[Order.SHIPPING_STATUS_SHIPPED] = 'shipped';
    return names;
}

/**
 * @param {dw.value.EnumValue|number} status - SFCC enum value
 * @returns {number} numeric status code
 */
function enumCode(status) {
    if (status && typeof status === 'object' && status.value !== undefined) {
        return status.value;
    }
    return status;
}

/**
 * @param {dw.order.Order} order - order
 * @returns {{order_status: string, shipping_status: string}} mapped statuses
 */
function mapStatuses(order) {
    var statusName = getOrderStatusNames()[enumCode(order.getStatus())] || 'UNKNOWN';
    var mapping = SeetConfig.getOrderStatusMapping();
    return {
        order_status: mapping[statusName] || statusName.toLowerCase(),
        shipping_status: getShippingStatusNames()[enumCode(order.getShippingStatus())] || 'unknown'
    };
}

/**
 * @param {string} siteId - SFCC site ID
 * @param {string} orderNo - order number
 * @returns {string} idempotency key, stable for the lifetime of the order
 */
function buildIdempotencyKey(siteId, orderNo) {
    return 'sfcc:' + siteId + ':' + orderNo;
}

/**
 * @param {dw.util.Collection} collection - SFCC collection
 * @returns {Array} JS array
 */
function toArray(collection) {
    var items = [];
    if (!collection) {
        return items;
    }
    var iterator = collection.iterator();
    while (iterator.hasNext()) {
        items.push(iterator.next());
    }
    return items;
}

/**
 * Builds the order payload sent to Seet.
 * @param {dw.order.Order} order - placed order
 * @returns {Object} payload
 */
function buildOrderPayload(order) {
    var billingAddress = order.getBillingAddress();
    var statuses = mapStatuses(order);
    var items = toArray(order.getAllProductLineItems())
        .filter(function (lineItem) {
            return !lineItem.isOptionProductLineItem();
        })
        .map(function (lineItem) {
            return {
                product_id: SeetProductHelper.getLineItemReviewProductId(lineItem),
                sku: lineItem.getProductID(),
                name: lineItem.getProductName(),
                quantity: lineItem.getQuantityValue()
            };
        });

    return {
        external_order_id: order.getOrderNo(),
        external_site_id: SeetConfig.getSiteId(),
        currency: order.getCurrencyCode(),
        locale: order.getCustomerLocaleID() || null,
        order_status: statuses.order_status,
        shipping_status: statuses.shipping_status,
        customer: {
            external_id: order.getCustomerNo() || null,
            email: order.getCustomerEmail() || null,
            phone: (billingAddress && billingAddress.getPhone()) || null
        },
        items: items,
        ordered_at: order.getCreationDate().toISOString()
    };
}

/**
 * @param {Object} payload - order payload
 * @param {string} idempotencyKey - idempotency key
 * @returns {Object} normalized SeetService result
 */
function sendOrder(payload, idempotencyKey) {
    return SeetService.call({
        serviceId: SeetService.SERVICE_IDS.ORDERS,
        method: 'POST',
        path: ORDERS_PATH,
        body: payload,
        idempotencyKey: idempotencyKey
    });
}

module.exports = {
    ORDERS_PATH: ORDERS_PATH,
    mapStatuses: mapStatuses,
    buildIdempotencyKey: buildIdempotencyKey,
    buildOrderPayload: buildOrderPayload,
    sendOrder: sendOrder
};
