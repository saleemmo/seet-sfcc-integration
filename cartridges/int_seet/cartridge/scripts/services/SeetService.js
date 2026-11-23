'use strict';

/**
 * Shared HTTP layer for all Seet API calls, built on the B2C Commerce Service
 * Framework. Timeouts, circuit breaker and rate limiting are configured on the
 * service profiles in Business Manager (see metadata/site_import/services.xml).
 */

var LocalServiceRegistry = require('dw/svc/LocalServiceRegistry');
var Logger = require('dw/system/Logger');
var SeetConfig = require('*/cartridge/scripts/helpers/SeetConfig');

var SERVICE_IDS = {
    REVIEWS: 'seet.http.reviews',
    ORDERS: 'seet.http.orders'
};

var ERROR_TYPES = {
    CONFIG: 'CONFIG',
    HTTP: 'HTTP',
    UNAVAILABLE: 'UNAVAILABLE',
    PARSE: 'PARSE'
};

var SENSITIVE_KEYS = 'email|phone|first_name|last_name|name|address|address1|address2|postal_code|api_key|token|password|authorization';
var SENSITIVE_JSON_PATTERN = new RegExp('("(?:' + SENSITIVE_KEYS + ')"\\s*:\\s*)"(?:[^"\\\\]|\\\\.)*"', 'gi');
var EMAIL_PATTERN = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
var BEARER_PATTERN = /(bearer\s+)[A-Za-z0-9._~+/=-]+/gi;

var log = Logger.getLogger('seet', 'SeetService');

/**
 * Removes credentials and personal data from text before it is logged.
 * @param {string} message - raw message
 * @returns {string} redacted message
 */
function redact(message) {
    if (message === null || message === undefined) {
        return '';
    }
    return String(message)
        .replace(SENSITIVE_JSON_PATTERN, '$1"***"')
        .replace(BEARER_PATTERN, '$1***')
        .replace(EMAIL_PATTERN, '***@***');
}

/**
 * @param {string} text - response body
 * @returns {*} parsed JSON or null
 */
function parseJson(text) {
    if (!text) {
        return null;
    }
    try {
        return JSON.parse(text);
    } catch (e) {
        return undefined;
    }
}

/**
 * @param {Object} query - key/value query parameters
 * @returns {string} encoded query string including leading "?" or empty string
 */
function buildQueryString(query) {
    if (!query) {
        return '';
    }
    var parts = [];
    Object.keys(query).forEach(function (key) {
        var value = query[key];
        if (value !== null && value !== undefined && value !== '') {
            parts.push(encodeURIComponent(key) + '=' + encodeURIComponent(String(value)));
        }
    });
    return parts.length ? '?' + parts.join('&') : '';
}

/**
 * @param {string} serviceId - registered service ID
 * @returns {dw.svc.HTTPService} service instance
 */
function createService(serviceId) {
    return LocalServiceRegistry.createService(serviceId, {
        createRequest: function (svc, request) {
            svc.setAuthentication('NONE');
            svc.setURL(request.url);
            svc.setRequestMethod(request.method);
            svc.addHeader('Accept', 'application/json');
            if (request.apiKey) {
                svc.addHeader('Authorization', 'Bearer ' + request.apiKey);
            }
            svc.addHeader('X-Seet-Platform', 'sfcc');
            svc.addHeader('X-Seet-Site-Id', request.siteId);
            Object.keys(request.headers || {}).forEach(function (name) {
                svc.addHeader(name, request.headers[name]);
            });
            if (request.idempotencyKey) {
                svc.addHeader('Idempotency-Key', request.idempotencyKey);
            }
            if (request.body !== undefined && request.body !== null) {
                svc.addHeader('Content-Type', 'application/json; charset=utf-8');
                return JSON.stringify(request.body);
            }
            return null;
        },
        parseResponse: function (svc, client) {
            return {
                statusCode: client.statusCode,
                body: parseJson(client.text)
            };
        },
        filterLogMessage: function (message) {
            return redact(message);
        },
        getRequestLogMessage: function (requestBody) {
            return redact(requestBody);
        },
        getResponseLogMessage: function (client) {
            return client ? 'HTTP ' + client.statusCode + ' ' + redact(client.text) : '';
        }
    });
}

/**
 * @param {string} type - error type
 * @param {number|null} statusCode - HTTP status code
 * @param {string} message - safe error message
 * @param {boolean} retryable - whether a retry may succeed
 * @param {string} [reason] - service framework unavailable reason
 * @returns {Object} failure result
 */
function failure(type, statusCode, message, retryable, reason) {
    return {
        ok: false,
        statusCode: statusCode,
        data: null,
        error: {
            type: type,
            code: statusCode,
            message: redact(message).substring(0, 500),
            retryable: retryable,
            reason: reason || null
        }
    };
}

/**
 * @param {number} statusCode - HTTP status code
 * @returns {boolean} whether the HTTP error is transient
 */
function isRetryableStatus(statusCode) {
    return !statusCode || statusCode === 408 || statusCode === 429 || statusCode >= 500;
}

/**
 * Extracts a safe message from a Seet error body ({ message, code }).
 * @param {string} errorText - raw error response body
 * @returns {string} message
 */
function extractErrorMessage(errorText) {
    var body = parseJson(errorText);
    if (body && body.error) {
        return [body.error.code, body.error.message].filter(Boolean).join(': ');
    }
    if (body && body.message) {
        return [body.code, body.message].filter(Boolean).join(': ');
    }
    return '';
}

/**
 * @param {dw.svc.Result} result - service framework result
 * @returns {Object} normalized result
 */
function normalizeResult(result) {
    if (result.isOk()) {
        var response = result.getObject();
        if (response.body === undefined) {
            return failure(ERROR_TYPES.PARSE, response.statusCode, 'Invalid JSON response from Seet API', true);
        }
        var body = response.body || {};
        if (body.success === false) {
            return failure(ERROR_TYPES.HTTP, response.statusCode, extractErrorMessage(JSON.stringify(body)), false);
        }
        return {
            ok: true,
            statusCode: response.statusCode,
            data: body.data !== undefined ? body.data : body,
            meta: body.meta || null,
            error: null
        };
    }

    if (result.getStatus() === 'SERVICE_UNAVAILABLE') {
        var reason = result.getUnavailableReason() || 'UNKNOWN';
        return failure(ERROR_TYPES.UNAVAILABLE, null, 'Service unavailable: ' + reason, true, reason);
    }

    var statusCode = result.getError() || null;
    var message = 'HTTP ' + (statusCode || 'error');
    var detail = extractErrorMessage(result.getErrorMessage());
    if (detail) {
        message += ': ' + detail;
    }
    return failure(ERROR_TYPES.HTTP, statusCode, message, isRetryableStatus(statusCode));
}

/**
 * @param {string} url - absolute URL
 * @returns {string} lower-case scheme://host[:port], without the default HTTPS port
 */
function getOrigin(url) {
    var match = /^https?:\/\/[^/?#]+/i.exec(url);
    return match ? match[0].toLowerCase().replace(/^(https:\/\/[^/]+):443$/, '$1') : '';
}

/**
 * Performs a call to the Seet API for the current site's store. The secret key
 * is only attached when options.auth is not false; the public review endpoints
 * identify the store by its public key instead.
 *
 * @param {Object} options - call options
 * @param {string} options.serviceId - one of SERVICE_IDS
 * @param {string} options.method - HTTP method
 * @param {string} options.path - API path starting with "/"
 * @param {Object} [options.query] - query parameters
 * @param {Object} [options.body] - JSON body
 * @param {string} [options.idempotencyKey] - Idempotency-Key header value
 * @param {boolean} [options.auth] - false to call a public endpoint without the secret key
 * @param {Object} [options.headers] - additional request headers
 * @returns {{ok: boolean, statusCode: (number|null), data: *, meta: *, error: (Object|null)}} normalized result
 */
function call(options) {
    var validation = SeetConfig.validate();
    if (!validation.valid) {
        return failure(ERROR_TYPES.CONFIG, null, validation.errors.join('; '), false);
    }

    var service;
    var credential;
    try {
        service = createService(options.serviceId);
        var credentialId = SeetConfig.getServiceCredentialId();
        if (credentialId) {
            service.setCredentialID(credentialId);
        }
        credential = service.getConfiguration().getCredential();
    } catch (e) {
        log.error('Seet service {0} could not be initialised: {1}', options.serviceId, e.message);
        return failure(ERROR_TYPES.CONFIG, null, 'Service ' + options.serviceId + ' is not configured', false);
    }

    var useSecretKey = options.auth !== false;
    var apiKey = useSecretKey && credential ? credential.getPassword() : null;
    if (useSecretKey && !apiKey) {
        return failure(ERROR_TYPES.CONFIG, null, 'Secret key (service credential password) is not configured', false);
    }

    // The credential URL (managed with the secret key by administrators) defines
    // where the key may be sent; the site preference may only refine the path.
    var credentialUrl = String((credential && credential.getURL()) || '').replace(/\/+$/, '');
    if (!SeetConfig.isHttpsUrl(credentialUrl)) {
        return failure(ERROR_TYPES.CONFIG, null, 'Service credential URL must be an absolute HTTPS URL', false);
    }
    var baseUrl = SeetConfig.getApiBaseUrl() || credentialUrl;
    if (!SeetConfig.isHttpsUrl(baseUrl) || getOrigin(baseUrl) !== getOrigin(credentialUrl)) {
        return failure(ERROR_TYPES.CONFIG, null, 'seetApiBaseUrl must be an HTTPS URL on the host of the service credential URL', false);
    }

    var result;
    try {
        result = service.call({
            url: baseUrl + options.path + buildQueryString(options.query),
            method: options.method || 'GET',
            apiKey: apiKey,
            siteId: SeetConfig.getSiteId(),
            headers: options.headers || null,
            idempotencyKey: options.idempotencyKey || null,
            body: options.body
        });
    } catch (e) {
        log.error('Seet service {0} call failed: {1}', options.serviceId, redact(e.message));
        return failure(ERROR_TYPES.UNAVAILABLE, null, 'Unexpected service error', true);
    }

    var normalized = normalizeResult(result);
    if (!normalized.ok) {
        log.warn(
            'Seet API call failed service={0} method={1} path={2} type={3} code={4}',
            options.serviceId,
            options.method || 'GET',
            options.path,
            normalized.error.type,
            normalized.error.code
        );
    }
    return normalized;
}

module.exports = {
    SERVICE_IDS: SERVICE_IDS,
    ERROR_TYPES: ERROR_TYPES,
    call: call,
    redact: redact,
    buildQueryString: buildQueryString,
    isRetryableStatus: isRetryableStatus
};
