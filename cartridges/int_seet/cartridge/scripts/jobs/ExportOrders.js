'use strict';

/**
 * Job step custom.Seet.ExportOrders: first delivery attempt for PENDING outbox records.
 */

var Logger = require('dw/system/Logger');
var Status = require('dw/system/Status');
var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
var SeetOutboxHelper = require('*/cartridge/scripts/helpers/SeetOutboxHelper');

/**
 * @param {Object} parameters - job step parameters
 * @returns {dw.system.Status} step status
 */
function execute(parameters) {
    var log = Logger.getLogger('seet', 'ExportOrders');
    if (!SeetConfig.isOrderSyncEnabled()) {
        log.info('Seet order sync is disabled or not configured for site {0}', SeetConfig.getSiteId());
        return new Status(Status.OK, 'DISABLED', 'Seet order sync is disabled');
    }

    var stats = SeetOutboxHelper.processDue(SeetOutboxHelper.STATUS.PENDING, SeetOutboxHelper.getOptions(parameters));
    var summary = JSON.stringify(stats);
    log.info('Seet ExportOrders finished: {0}', summary);

    if (stats.aborted) {
        return new Status(Status.ERROR, 'ABORTED', 'Stopped early because of a configuration, authentication or availability error: ' + summary);
    }
    return new Status(Status.OK, 'OK', summary);
}

exports.execute = execute;
