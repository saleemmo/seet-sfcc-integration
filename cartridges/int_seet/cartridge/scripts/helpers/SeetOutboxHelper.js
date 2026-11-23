'use strict';

/**
 * Order outbox backed by the SeetOrderOutbox custom object (site scoped, keyed
 * by order number). Checkout only writes an outbox record; scheduled jobs
 * deliver records to Seet with retries and exponential backoff.
 *
 * Lifecycle: PENDING -> PROCESSING -> SYNCED
 *                                  -> FAILED (nextRetryAt set: retried by RetryFailedOrders)
 *                                  -> FAILED (nextRetryAt empty: retries exhausted / permanent error)
 */

var CustomObjectMgr = require('dw/object/CustomObjectMgr');
var Logger = require('dw/system/Logger');
var Order = require('dw/order/Order');
var OrderMgr = require('dw/order/OrderMgr');
var Transaction = require('dw/system/Transaction');
var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');
var SeetOrdersService = require('*/cartridge/scripts/services/SeetOrdersService');
var SeetService = require('*/cartridge/scripts/services/SeetService');

var OUTBOX_TYPE = 'SeetOrderOutbox';
var STATUS = {
    PENDING: 'PENDING',
    PROCESSING: 'PROCESSING',
    SYNCED: 'SYNCED',
    FAILED: 'FAILED'
};
var DEFAULTS = {
    batchSize: 50,
    maxRetries: 8,
    baseDelayMinutes: 5,
    maxDelayMinutes: 720,
    lockTimeoutMinutes: 30
};
var MINUTE_MS = 60 * 1000;
var ABORT_UNAVAILABLE_REASONS = ['CIRCUIT_BROKEN', 'RATE_LIMITED', 'DISABLED', 'CONFIG_PROBLEM'];

var log = Logger.getLogger('seet', 'SeetOutbox');

/**
 * @param {dw.object.CustomObject} record - outbox record
 * @returns {string} status value
 */
function getStatus(record) {
    var status = record.custom.status;
    if (status && typeof status === 'object' && status.value !== undefined) {
        return status.value;
    }
    return status ? String(status) : '';
}

/**
 * @param {Object} params - raw job parameters
 * @returns {Object} options with defaults and bounds applied
 */
function getOptions(params) {
    var source = params || {};
    /**
     * @param {*} value - raw value
     * @param {number} fallback - default
     * @param {number} min - lower bound
     * @param {number} max - upper bound
     * @returns {number} bounded integer
     */
    function bounded(value, fallback, min, max) {
        var number = parseInt(value, 10);
        return isNaN(number) ? fallback : Math.min(Math.max(number, min), max);
    }
    return {
        batchSize: bounded(source.BatchSize, DEFAULTS.batchSize, 1, 500),
        maxRetries: bounded(source.MaxRetries, DEFAULTS.maxRetries, 1, 50),
        baseDelayMinutes: bounded(source.BaseDelayMinutes, DEFAULTS.baseDelayMinutes, 1, 1440),
        maxDelayMinutes: bounded(source.MaxDelayMinutes, DEFAULTS.maxDelayMinutes, 1, 10080),
        lockTimeoutMinutes: bounded(source.LockTimeoutMinutes, DEFAULTS.lockTimeoutMinutes, 5, 1440)
    };
}

/**
 * Exponential backoff: base * 2^(retryCount - 1), capped at maxDelayMinutes.
 * @param {number} retryCount - number of failed attempts so far (>= 1)
 * @param {Object} options - retry options
 * @param {Date} now - current time
 * @returns {Date} next attempt time
 */
function computeNextRetryAt(retryCount, options, now) {
    var exponent = Math.max(retryCount - 1, 0);
    var delay = Math.min(options.baseDelayMinutes * Math.pow(2, exponent), options.maxDelayMinutes);
    return new Date(now.getTime() + (delay * MINUTE_MS));
}

/**
 * @param {dw.order.Order} order - order
 * @returns {boolean} whether the order has been placed successfully
 */
function isPlaced(order) {
    var status = order.getStatus();
    var code = status && typeof status === 'object' && status.value !== undefined ? status.value : status;
    return code !== Order.ORDER_STATUS_CREATED && code !== Order.ORDER_STATUS_FAILED;
}

/**
 * Creates the outbox record for a placed order. Never throws and never calls
 * the Seet API, so it is safe to use in the checkout flow.
 * @param {dw.order.Order} order - placed order
 * @returns {{queued: boolean, reason: (string|undefined)}} result
 */
function enqueue(order) {
    if (!order) {
        return { queued: false, reason: 'NO_ORDER' };
    }
    if (!SeetConfig.isOrderSyncEnabled()) {
        return { queued: false, reason: 'DISABLED' };
    }
    var orderNo = order.getOrderNo();
    try {
        if (!isPlaced(order)) {
            return { queued: false, reason: 'ORDER_NOT_PLACED' };
        }
        var payload = JSON.stringify(SeetOrdersService.buildOrderPayload(order));
        var siteId = SeetConfig.getSiteId();
        var created = false;
        Transaction.wrap(function () {
            if (CustomObjectMgr.getCustomObject(OUTBOX_TYPE, orderNo)) {
                return;
            }
            var record = CustomObjectMgr.createCustomObject(OUTBOX_TYPE, orderNo);
            record.custom.storeId = SeetConfig.getStoreId();
            record.custom.siteId = siteId;
            record.custom.idempotencyKey = SeetOrdersService.buildIdempotencyKey(siteId, orderNo);
            record.custom.payload = payload;
            record.custom.status = STATUS.PENDING;
            record.custom.retryCount = 0;
            record.custom.nextRetryAt = new Date();
            created = true;
        });
        return created ? { queued: true } : { queued: false, reason: 'DUPLICATE' };
    } catch (e) {
        log.error('Could not queue order {0} for Seet: {1}', orderNo, e.message);
        return { queued: false, reason: 'ERROR' };
    }
}

/**
 * @param {string} query - custom object query
 * @param {string} sortString - sort expression
 * @param {number} limit - maximum number of records
 * @param {Array} args - query arguments
 * @returns {dw.object.CustomObject[]} records
 */
function queryRecords(query, sortString, limit, args) {
    var queryArgs = [OUTBOX_TYPE, query, sortString].concat(args);
    var iterator = CustomObjectMgr.queryCustomObjects.apply(CustomObjectMgr, queryArgs);
    var records = [];
    try {
        while (iterator.hasNext() && records.length < limit) {
            records.push(iterator.next());
        }
    } finally {
        iterator.close();
    }
    return records;
}

/**
 * @param {string} status - PENDING or FAILED
 * @param {Date} now - current time
 * @param {number} limit - batch size
 * @returns {dw.object.CustomObject[]} records due for delivery
 */
function findDue(status, now, limit) {
    return queryRecords('custom.status = {0} AND custom.nextRetryAt <= {1}', 'custom.nextRetryAt asc', limit, [status, now]);
}

/**
 * Atomically moves a record to PROCESSING if it still has the expected status.
 * Prevents two job runs from sending the same record.
 * @param {dw.object.CustomObject} record - outbox record
 * @param {string} expectedStatus - status the record must currently have
 * @param {Date} now - current time
 * @returns {boolean} whether the record was claimed
 */
function claim(record, expectedStatus, now) {
    var claimed = false;
    Transaction.wrap(function () {
        if (getStatus(record) !== expectedStatus) {
            return;
        }
        record.custom.status = STATUS.PROCESSING;
        record.custom.lastAttemptAt = now;
        claimed = true;
    });
    return claimed;
}

/**
 * Returns a claimed record to its previous status without counting an attempt.
 * @param {dw.object.CustomObject} record - outbox record
 * @param {string} status - status to restore
 */
function release(record, status) {
    Transaction.wrap(function () {
        record.custom.status = status;
    });
}

/**
 * Marks a record as delivered and removes the payload (personal data) from it.
 * @param {dw.object.CustomObject} record - outbox record
 */
function markSynced(record) {
    Transaction.wrap(function () {
        record.custom.status = STATUS.SYNCED;
        record.custom.lastError = null;
        record.custom.nextRetryAt = null;
        record.custom.payload = null;
    });
}

/**
 * @param {Object} error - normalized error
 * @returns {string} log-safe error summary
 */
function describeError(error) {
    var parts = [error.type || 'ERROR'];
    if (error.code) {
        parts.push(String(error.code));
    }
    if (error.message) {
        parts.push(SeetService.redact(error.message));
    }
    return parts.join(' | ').substring(0, 1000);
}

/**
 * Records a failed attempt and schedules the next retry, or stops retrying
 * when the error is permanent or the retry budget is exhausted.
 * @param {dw.object.CustomObject} record - outbox record
 * @param {Object} error - normalized error ({type, code, message, retryable})
 * @param {Object} options - retry options
 * @param {Date} now - current time
 * @returns {boolean} true when the record will not be retried automatically
 */
function markFailed(record, error, options, now) {
    var retryCount = (parseInt(record.custom.retryCount, 10) || 0) + 1;
    var exhausted = !error.retryable || retryCount >= options.maxRetries;
    Transaction.wrap(function () {
        record.custom.status = STATUS.FAILED;
        record.custom.retryCount = retryCount;
        record.custom.lastError = describeError(error);
        record.custom.nextRetryAt = exhausted ? null : computeNextRetryAt(retryCount, options, now);
    });
    return exhausted;
}

/**
 * @param {Object} error - normalized error
 * @returns {boolean} whether the rest of the batch should be skipped
 */
function shouldAbortBatch(error) {
    if (error.type === SeetService.ERROR_TYPES.CONFIG) {
        return true;
    }
    if (error.code === 401 || error.code === 403) {
        return true;
    }
    return error.type === SeetService.ERROR_TYPES.UNAVAILABLE && ABORT_UNAVAILABLE_REASONS.indexOf(error.reason) !== -1;
}

/**
 * @param {string} text - JSON text
 * @returns {Object|null} parsed payload
 */
function parsePayload(text) {
    try {
        var payload = JSON.parse(text);
        return payload && typeof payload === 'object' ? payload : null;
    } catch (e) {
        return null;
    }
}

/**
 * Sends one claimed record to Seet.
 * @param {dw.object.CustomObject} record - claimed record
 * @param {string} fromStatus - status before the claim
 * @param {Object} options - retry options
 * @param {Date} now - current time
 * @returns {string} SYNCED | RETRY | DEAD | ABORT
 */
function deliver(record, fromStatus, options, now) {
    var orderNo = record.custom.orderNumber;

    if (record.custom.storeId !== SeetConfig.getStoreId()) {
        markFailed(record, { type: 'STORE_MISMATCH', message: 'Record belongs to another Seet store', retryable: false }, options, now);
        return 'DEAD';
    }

    var payload = parsePayload(record.custom.payload);
    if (!payload) {
        markFailed(record, { type: 'PAYLOAD', message: 'Outbox payload is missing or invalid', retryable: false }, options, now);
        return 'DEAD';
    }

    var order = OrderMgr.getOrder(orderNo);
    if (order) {
        var statuses = SeetOrdersService.mapStatuses(order);
        payload.order_status = statuses.order_status;
        payload.shipping_status = statuses.shipping_status;
    }

    var result = SeetOrdersService.sendOrder(payload, record.custom.idempotencyKey);
    if (result.ok || result.statusCode === 409) {
        markSynced(record);
        return 'SYNCED';
    }

    if (shouldAbortBatch(result.error)) {
        release(record, fromStatus);
        log.error('Seet order export stopped at order {0}: {1}', orderNo, describeError(result.error));
        return 'ABORT';
    }

    var dead = markFailed(record, result.error, options, now);
    var retryCount = record.custom.retryCount;
    var message = 'Seet order export failed order={0} retryCount={1} final={2} error={3}';
    log.warn(message, orderNo, retryCount, dead, describeError(result.error));
    return dead ? 'DEAD' : 'RETRY';
}

/**
 * Removes a record that reached MaxRetries (e.g. after MaxRetries was lowered)
 * from the retry schedule so it no longer occupies batch slots.
 * @param {dw.object.CustomObject} record - outbox record
 */
function stopRetrying(record) {
    Transaction.wrap(function () {
        record.custom.nextRetryAt = null;
    });
}

/**
 * Delivers due records with the given status.
 * @param {string} fromStatus - PENDING (first attempts) or FAILED (retries)
 * @param {Object} options - job options
 * @param {Date} [currentTime] - injectable clock
 * @returns {Object} batch statistics
 */
function processDue(fromStatus, options, currentTime) {
    var now = currentTime || new Date();
    var stats = {
        selected: 0,
        synced: 0,
        retry: 0,
        dead: 0,
        skipped: 0,
        aborted: false
    };
    var records = findDue(fromStatus, now, options.batchSize);
    stats.selected = records.length;

    for (var i = 0; i < records.length; i += 1) {
        var record = records[i];
        if (fromStatus === STATUS.FAILED && (parseInt(record.custom.retryCount, 10) || 0) >= options.maxRetries) {
            stopRetrying(record);
            stats.dead += 1;
        } else if (!claim(record, fromStatus, now)) {
            stats.skipped += 1;
        } else {
            var outcome;
            try {
                outcome = deliver(record, fromStatus, options, now);
            } catch (e) {
                log.error('Unexpected error exporting order {0}: {1}', record.custom.orderNumber, e.message);
                markFailed(record, { type: 'UNEXPECTED', message: e.message, retryable: true }, options, now);
                outcome = 'RETRY';
            }
            if (outcome === 'ABORT') {
                stats.aborted = true;
                break;
            }
            stats[outcome.toLowerCase()] += 1;
        }
    }
    return stats;
}

/**
 * Records stuck in PROCESSING (job crashed or timed out mid-request) are moved
 * to FAILED so they are retried. Resending is safe thanks to the idempotency key.
 * @param {Object} options - job options
 * @param {Date} [currentTime] - injectable clock
 * @returns {number} number of recovered records
 */
function recoverStale(options, currentTime) {
    var now = currentTime || new Date();
    var cutoff = new Date(now.getTime() - (options.lockTimeoutMinutes * MINUTE_MS));
    var records = queryRecords('custom.status = {0} AND custom.lastAttemptAt <= {1}', 'custom.lastAttemptAt asc', options.batchSize, [STATUS.PROCESSING, cutoff]);
    records.forEach(function (record) {
        markFailed(record, { type: 'STALE_LOCK', message: 'Processing lock expired', retryable: true }, options, now);
    });
    return records.length;
}

module.exports = {
    OUTBOX_TYPE: OUTBOX_TYPE,
    STATUS: STATUS,
    DEFAULTS: DEFAULTS,
    getStatus: getStatus,
    getOptions: getOptions,
    computeNextRetryAt: computeNextRetryAt,
    enqueue: enqueue,
    findDue: findDue,
    claim: claim,
    markSynced: markSynced,
    markFailed: markFailed,
    shouldAbortBatch: shouldAbortBatch,
    processDue: processDue,
    recoverStale: recoverStale
};
