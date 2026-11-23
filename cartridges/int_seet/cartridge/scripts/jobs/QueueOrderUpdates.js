'use strict';

/**
 * Job step custom.Seet.QueueOrderUpdates: queues orders whose status changed
 * (shipped, delivered, cancelled) so the export step sends the new event.
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
    var log = Logger.getLogger('seet', 'QueueOrderUpdates');
    if (!SeetConfig.isOrderSyncEnabled()) {
        log.info('Seet order sync is disabled or not configured for site {0}', SeetConfig.getSiteId());
        return new Status(Status.OK, 'DISABLED', 'Seet order sync is disabled');
    }

    var stats = SeetOutboxHelper.queueOrderUpdates(SeetOutboxHelper.getOptions(parameters));
    var summary = JSON.stringify(stats);
    log.info('Seet QueueOrderUpdates finished: {0}', summary);
    return new Status(Status.OK, 'OK', summary);
}

exports.execute = execute;
