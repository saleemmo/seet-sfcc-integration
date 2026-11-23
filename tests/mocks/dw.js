'use strict';

/**
 * In-memory mocks of the B2C Commerce script API (dw.*) used by int_seet.
 */

function createIterator(items) {
    let index = 0;
    return {
        hasNext: () => index < items.length,
        next: () => { index += 1; return items[index - 1]; },
        close: () => {}
    };
}

function createCollection(items) {
    return { iterator: () => createIterator(items), toArray: () => items.slice() };
}

function createEnv(options = {}) {
    const env = {
        siteId: options.siteId || 'RefArch',
        prefs: {
            seetEnabled: true,
            seetStoreId: 'store_1',
            seetApiBaseUrl: '',
            seetReviewsEnabled: true,
            seetOrderSyncEnabled: true,
            seetReviewPageSize: 5,
            ...(options.prefs || {})
        },
        credentials: {
            'seet.http.api.cred': { url: 'https://api.seet.test/api/v1', password: 'key_default' },
            ...(options.credentials || {})
        },
        calls: [],
        respond: options.respond || (() => ({ statusCode: 200, text: '{"success":true,"data":{}}' })),
        cacheStore: {},
        customObjects: {},
        orders: {},
        products: {},
        logs: []
    };

    const logger = {
        debug: (...args) => env.logs.push(['debug', ...args]),
        info: (...args) => env.logs.push(['info', ...args]),
        warn: (...args) => env.logs.push(['warn', ...args]),
        error: (...args) => env.logs.push(['error', ...args])
    };

    const Site = {
        getCurrent: () => ({
            getID: () => env.siteId,
            getCustomPreferenceValue: (name) => env.prefs[name]
        })
    };

    function createResult(response, parseResponse, svc) {
        if (response.unavailable) {
            return {
                isOk: () => false,
                getStatus: () => 'SERVICE_UNAVAILABLE',
                getUnavailableReason: () => response.unavailable,
                getError: () => 0,
                getErrorMessage: () => null,
                getObject: () => null
            };
        }
        if (response.statusCode >= 200 && response.statusCode < 300) {
            const object = parseResponse(svc, { statusCode: response.statusCode, text: response.text });
            return { isOk: () => true, getStatus: () => 'OK', getObject: () => object };
        }
        return {
            isOk: () => false,
            getStatus: () => 'ERROR',
            getError: () => response.statusCode,
            getErrorMessage: () => response.text || null,
            getUnavailableReason: () => null,
            getObject: () => null
        };
    }

    const LocalServiceRegistry = {
        createService: (serviceId, callbacks) => {
            const svc = {
                credentialId: null,
                headers: {},
                authentication: 'BASIC',
                setCredentialID(id) { this.credentialId = id; },
                getConfiguration() {
                    return {
                        getCredential: () => {
                            const credential = env.credentials[svc.credentialId || 'seet.http.api.cred'];
                            return credential ? { getURL: () => credential.url, getPassword: () => credential.password } : null;
                        }
                    };
                },
                setAuthentication(value) { this.authentication = value; },
                setURL(url) { this.url = url; },
                setRequestMethod(method) { this.method = method; },
                addHeader(name, value) { this.headers[name] = value; },
                call(params) {
                    const body = callbacks.createRequest(svc, params);
                    const call = {
                        serviceId,
                        url: svc.url,
                        method: svc.method,
                        headers: { ...svc.headers },
                        body: body ? JSON.parse(body) : null,
                        credentialId: svc.credentialId,
                        authentication: svc.authentication
                    };
                    env.calls.push(call);
                    svc.headers = {};
                    return createResult(env.respond(call), callbacks.parseResponse, svc);
                }
            };
            env.lastCallbacks = callbacks;
            return svc;
        }
    };

    const CacheMgr = {
        getCache: () => ({
            get: (key, loader) => {
                if (Object.prototype.hasOwnProperty.call(env.cacheStore, key)) {
                    return env.cacheStore[key];
                }
                const value = loader();
                if (value !== undefined) {
                    env.cacheStore[key] = value;
                }
                return value;
            }
        })
    };

    const CustomObjectMgr = {
        getCustomObject: (type, key) => env.customObjects[`${type}|${key}`] || null,
        createCustomObject: (type, key) => {
            const id = `${type}|${key}`;
            if (env.customObjects[id]) {
                throw new Error('Duplicate key');
            }
            env.customObjects[id] = { type, creationDate: new Date(), custom: { orderNumber: key } };
            return env.customObjects[id];
        },
        queryCustomObjects: (type, query, sort, ...args) => {
            const match = /custom\.status = \{0\} AND custom\.(\w+) <= \{1\}/.exec(query);
            if (!match) {
                throw new Error(`Unsupported query in mock: ${query}`);
            }
            const field = match[1];
            const items = Object.values(env.customObjects)
                .filter((record) => record.type === type && record.custom.status === args[0]
                    && record.custom[field] && record.custom[field].getTime() <= args[1].getTime())
                .sort((a, b) => a.custom[field] - b.custom[field]);
            return createIterator(items);
        }
    };

    function Status(status, code, message) {
        this.status = status;
        this.code = code;
        this.message = message;
    }
    Status.OK = 0;
    Status.ERROR = 1;

    const Order = {
        ORDER_STATUS_CREATED: 0,
        ORDER_STATUS_NEW: 3,
        ORDER_STATUS_OPEN: 4,
        ORDER_STATUS_COMPLETED: 5,
        ORDER_STATUS_CANCELLED: 6,
        ORDER_STATUS_REPLACED: 7,
        ORDER_STATUS_FAILED: 8,
        SHIPPING_STATUS_NOTSHIPPED: 0,
        SHIPPING_STATUS_PARTSHIPPED: 1,
        SHIPPING_STATUS_SHIPPED: 2
    };

    function Calendar(date) { this.date = date; }
    Calendar.LONG_DATE_PATTERN = 1;

    env.dw = {
        'dw/system/Site': Site,
        'dw/system/Logger': { getLogger: () => logger },
        'dw/system/Transaction': { wrap: (fn) => fn() },
        'dw/system/Status': Status,
        'dw/system/CacheMgr': CacheMgr,
        'dw/svc/LocalServiceRegistry': LocalServiceRegistry,
        'dw/object/CustomObjectMgr': CustomObjectMgr,
        'dw/order/Order': Order,
        'dw/order/OrderMgr': {
            getOrder: (orderNo) => env.orders[orderNo] || null,
            processOrders: (callback, query, since) => {
                if (query !== 'lastModified >= {0}') {
                    throw new Error(`Unsupported query in mock: ${query}`);
                }
                Object.values(env.orders).filter((order) => order.getLastModified() >= since).forEach(callback);
            }
        },
        'dw/catalog/ProductMgr': { getProduct: (id) => env.products[id] || null },
        'dw/web/URLUtils': { https: (route, name, value) => `https://shop.example.com/${route}?${name}=${encodeURIComponent(value)}` },
        'dw/util/Calendar': Calendar,
        'dw/util/StringUtils': { formatCalendar: (calendar, locale) => `${locale}:${calendar.date.toISOString().substring(0, 10)}` }
    };
    return env;
}

function createProduct(id, { master = null, online = true, variationGroup = false } = {}) {
    return {
        getID: () => id,
        isVariant: () => Boolean(master) && !variationGroup,
        isVariationGroup: () => variationGroup,
        getMasterProduct: () => master,
        getImage: () => ({ getHttpsURL: () => `https://cdn.example.com/${id}.jpg` }),
        isOnline: () => online
    };
}

function createOrder(overrides = {}) {
    const master = createProduct('MASTER-1');
    const variant = createProduct('VARIANT-1-RED', { master });
    const lineItems = overrides.lineItems || [
        {
            getProduct: () => variant,
            getProductID: () => 'VARIANT-1-RED',
            getProductName: () => 'Abaya',
            getQuantityValue: () => 2,
            isOptionProductLineItem: () => false
        },
        {
            getProduct: () => null,
            getProductID: () => 'GIFT-WRAP',
            getProductName: () => 'Gift wrap',
            getQuantityValue: () => 1,
            isOptionProductLineItem: () => true
        }
    ];
    return {
        getOrderNo: () => overrides.orderNo || '00012345',
        getStatus: () => ({ value: overrides.status === undefined ? 3 : overrides.status }),
        getShippingStatus: () => ({ value: overrides.shippingStatus || 0 }),
        getCurrencyCode: () => 'SAR',
        getCustomerLocaleID: () => (overrides.locale === undefined ? 'ar_SA' : overrides.locale),
        getCustomerNo: () => overrides.customerNo === undefined ? 'customer_123' : overrides.customerNo,
        getCustomerEmail: () => 'customer@example.com',
        getCustomerName: () => (overrides.customerName === undefined ? 'Sara Ali' : overrides.customerName),
        getBillingAddress: () => ({
            getPhone: () => '+966500000000',
            getFullName: () => 'Billing Name',
            getCountryCode: () => ({ value: 'ae' })
        }),
        getDefaultShipment: () => ({ getShippingAddress: () => ({ getCountryCode: () => ({ value: 'sa' }) }) }),
        getTotalGrossPrice: () => ({ isAvailable: () => true, getValue: () => 250.5 }),
        getAllProductLineItems: () => createCollection(lineItems),
        getCreationDate: () => new Date('2026-11-23T18:00:00Z'),
        getLastModified: () => overrides.lastModified || new Date('2026-11-23T18:00:00Z'),
        getPaymentInstruments: () => { throw new Error('payment data must not be read'); }
    };
}

module.exports = {
    createEnv, createProduct, createOrder, createCollection
};
