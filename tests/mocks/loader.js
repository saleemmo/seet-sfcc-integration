'use strict';

const path = require('path');
const proxyquire = require('proxyquire').noCallThru().noPreserveCache();

const CARTRIDGE = path.resolve(__dirname, '../../cartridges/int_seet/cartridge');

// Dependency order: a module may only depend on modules listed before it.
const MODULES = [
    'scripts/helpers/SeetConfig',
    'scripts/helpers/SeetProductHelper',
    'scripts/helpers/SeetReviewHelper',
    'scripts/services/SeetService',
    'scripts/services/SeetReviewsService',
    'scripts/services/SeetOrdersService',
    'scripts/helpers/SeetOutboxHelper'
];

/**
 * Loads cartridge modules against the given mock environment, resolving
 * "*\/cartridge/..." requires to the real cartridge modules.
 */
function createLoader(env, extraStubs = {}) {
    const stubs = { ...env.dw, ...extraStubs };
    MODULES.forEach((modulePath) => {
        const key = `*/cartridge/${modulePath}`;
        if (!stubs[key]) {
            stubs[key] = proxyquire(path.join(CARTRIDGE, modulePath), stubs);
        }
    });
    return (modulePath) => {
        const key = `*/cartridge/${modulePath}`;
        return stubs[key] || proxyquire(path.join(CARTRIDGE, modulePath), stubs);
    };
}

module.exports = { createLoader, CARTRIDGE };
