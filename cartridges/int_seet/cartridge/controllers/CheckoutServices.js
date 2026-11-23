'use strict';

/**
 * Extends CheckoutServices-PlaceOrder to queue successfully placed orders in
 * the Seet outbox. No Seet API call is made during checkout, and failures here
 * never affect the order placement response.
 */

var server = require('server');

server.extend(module.superModule);

server.append('PlaceOrder', function (req, res, next) {
    var viewData = res.getViewData();
    if (viewData && viewData.error === false && viewData.orderID) {
        try {
            var HookMgr = require('dw/system/HookMgr');
            var OrderMgr = require('dw/order/OrderMgr');
            var order = OrderMgr.getOrder(viewData.orderID, viewData.orderToken);
            if (order && HookMgr.hasHook('app.seet.order.placed')) {
                HookMgr.callHook('app.seet.order.placed', 'orderPlaced', order);
            }
        } catch (e) {
            require('dw/system/Logger').getLogger('seet', 'CheckoutServices')
                .error('Could not queue order for Seet: {0}', e.message);
        }
    }
    next();
});

module.exports = server.exports();
