'use strict';

/**
 * Order payload mapping and order event calls to Seet
 * (POST /integrations/orders). Seet upserts an order by its order_id, so every
 * event carries the full order snapshot. Only the data Seet needs for review
 * invitations is sent: no payment data, no street addresses.
 */

var Order = require('dw/order/Order');
var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
var SeetProductHelper = require('*/cartridge/scripts/helpers/SeetProductHelper');
var SeetService = require('*/cartridge/scripts/services/SeetService');

var ORDERS_PATH = '/integrations/orders';
var PLACED_EVENT = 'order.placed';
var MAX_URL_LENGTH = 2048;
// Seet stamps these with its own receive time when they are missing, so the
// time the cartridge first saw the status is sent and survives retries.
var EVENT_TIME_FIELDS = {
    'order.shipped': 'fulfilled_at',
    'order.delivered': 'delivered_at',
    'order.cancelled': 'cancelled_at',
    'order.refunded': 'refunded_at',
    'order.returned': 'returned_at'
};

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
 * Maps the current SFCC order state to the Seet order event. An order that is
 * still open but fully shipped uses the SHIPPED mapping.
 * @param {dw.order.Order} order - order
 * @returns {string} Seet order event
 */
function mapEvent(order) {
    var mapping = SeetConfig.getOrderStatusMapping();
    var statusName = getOrderStatusNames()[enumCode(order.getStatus())];
    var event = mapping[statusName] || PLACED_EVENT;
    var isOpen = statusName === 'NEW' || statusName === 'OPEN';
    if (isOpen && enumCode(order.getShippingStatus()) === Order.SHIPPING_STATUS_SHIPPED) {
        event = mapping.SHIPPED || event;
    }
    return event;
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
 * Sets the event on a payload and records when the cartridge first saw it.
 * @param {Object} payload - order payload
 * @param {string} event - Seet order event
 * @param {Date} [now] - current time
 * @returns {Object} the payload
 */
function applyEvent(payload, event, now) {
    var field = EVENT_TIME_FIELDS[event];
    payload.event = event;
    if (field && !payload[field]) {
        payload[field] = (now || new Date()).toISOString();
    }
    return payload;
}

/**
 * @param {*} url - candidate URL (dw.web.URL or string)
 * @returns {string|undefined} absolute HTTPS URL or undefined
 */
function toHttpsUrl(url) {
    var text = url ? String(url) : '';
    return /^https:\/\/\S+$/.test(text) && text.length <= MAX_URL_LENGTH ? text : undefined;
}

/**
 * @param {dw.order.ProductLineItem} lineItem - order line item
 * @param {string} productId - Seet product ID (master product ID)
 * @returns {Object} Seet order item
 */
function buildItem(lineItem, productId) {
    var item = {
        sku: productId,
        external_id: productId,
        name: lineItem.getProductName() || productId,
        quantity: Math.max(1, Math.round(lineItem.getQuantityValue() || 1))
    };
    try {
        var product = lineItem.getProduct();
        var image = product && product.getImage('medium', 0);
        item.url = toHttpsUrl(require('dw/web/URLUtils').https('Product-Show', 'pid', productId));
        item.image_url = toHttpsUrl(image && image.getHttpsURL());
    } catch (e) {
        // links are optional
    }
    return item;
}

/**
 * One item per reviewed (master) product: Seet keeps a single order item per product.
 * @param {dw.order.Order} order - order
 * @returns {Object[]} Seet order items
 */
function buildItems(order) {
    var items = [];
    var byProductId = {};
    toArray(order.getAllProductLineItems()).forEach(function (lineItem) {
        if (lineItem.isOptionProductLineItem()) {
            return;
        }
        var productId = SeetProductHelper.getLineItemReviewProductId(lineItem);
        if (!productId) {
            return;
        }
        // Prefixed so no product ID can name a built-in Object property such as "constructor" or "__proto__".
        var key = 'id:' + productId;
        if (byProductId[key]) {
            byProductId[key].quantity += Math.max(1, Math.round(lineItem.getQuantityValue() || 1));
            return;
        }
        byProductId[key] = buildItem(lineItem, productId);
        items.push(byProductId[key]);
    });
    return items;
}

/**
 * @param {dw.order.Order} order - order
 * @returns {string|undefined} two-letter country code of the shipping (or billing) address
 */
function getCountryCode(order) {
    var shipment = order.getDefaultShipment();
    var address = (shipment && shipment.getShippingAddress()) || order.getBillingAddress();
    var code = address && address.getCountryCode();
    var value = code && code.value !== undefined ? code.value : code;
    return value && /^[A-Za-z]{2}$/.test(String(value)) ? String(value).toUpperCase() : undefined;
}

/**
 * Builds the order event payload sent to Seet.
 * @param {dw.order.Order} order - placed order
 * @param {Date} [now] - current time
 * @returns {Object} payload
 */
function buildOrderPayload(order, now) {
    var billingAddress = order.getBillingAddress();
    var locale = order.getCustomerLocaleID() || '';
    // "default" and other IDs that do not start with a language code carry no language.
    var languageMatch = /^([A-Za-z]{2})(_|$)/.exec(locale);
    var total = order.getTotalGrossPrice();

    return applyEvent({
        order_id: order.getOrderNo(),
        channel: 'online',
        country: getCountryCode(order),
        language: languageMatch ? languageMatch[1].toLowerCase() : undefined,
        placed_at: order.getCreationDate().toISOString(),
        total: total && total.isAvailable() ? total.getValue() : undefined,
        currency: order.getCurrencyCode(),
        customer: {
            name: order.getCustomerName() || (billingAddress && billingAddress.getFullName()) || 'Customer',
            email: order.getCustomerEmail() || undefined,
            phone: (billingAddress && billingAddress.getPhone()) || undefined
        },
        items: buildItems(order),
        metadata: {
            platform: 'sfcc',
            site_id: SeetConfig.getSiteId(),
            locale: locale || undefined
        }
    }, mapEvent(order), now);
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
    PLACED_EVENT: PLACED_EVENT,
    mapEvent: mapEvent,
    applyEvent: applyEvent,
    buildIdempotencyKey: buildIdempotencyKey,
    buildOrderPayload: buildOrderPayload,
    sendOrder: sendOrder
};
