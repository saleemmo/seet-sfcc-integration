'use strict';

/**
 * Hook "app.seet.order.placed": queues a placed order for asynchronous export
 * to Seet. Called from CheckoutServices-PlaceOrder (see controllers) and can be
 * called by custom checkouts with:
 *   HookMgr.callHook('app.seet.order.placed', 'orderPlaced', order);
 */

var Logger = require('dw/system/Logger');

/**
 * @param {dw.order.Order} order - placed order
 * @returns {{queued: boolean, reason: (string|undefined)}} result
 */
function orderPlaced(order) {
    try {
        return require('*/cartridge/scripts/helpers/SeetOutboxHelper').enqueue(order);
    } catch (e) {
        Logger.getLogger('seet', 'OrderPlaced').error('Seet order hook failed: {0}', e.message);
        return { queued: false, reason: 'ERROR' };
    }
}

exports.orderPlaced = orderPlaced;
