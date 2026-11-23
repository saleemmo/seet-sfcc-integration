'use strict';

/**
 * Extends Product-Show (does not replace it) with the URLs of the Seet remote
 * includes. No Seet API call happens in the product page request itself.
 */

var server = require('server');

server.extend(module.superModule);

server.append('Show', function (req, res, next) {
    var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
    var viewData = res.getViewData();
    var seet = { enabled: false };

    if (viewData.product && viewData.product.id && SeetConfig.isReviewsEnabled()) {
        var SeetProductHelper = require('*/cartridge/scripts/helpers/SeetProductHelper');
        var URLUtils = require('dw/web/URLUtils');
        var productId = SeetProductHelper.resolveReviewProductId(viewData.product.id);
        if (productId) {
            seet = {
                enabled: true,
                productId: productId,
                ratingUrl: URLUtils.url('Seet-Rating', 'pid', productId).toString(),
                reviewsUrl: URLUtils.url('Seet-Reviews', 'pid', productId).toString()
            };
        }
    }

    viewData.seet = seet;
    res.setViewData(viewData);
    next();
});

module.exports = server.exports();
