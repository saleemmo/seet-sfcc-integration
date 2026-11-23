#!/usr/bin/env node

'use strict';

// Validates site import XML against the official B2C Commerce XSDs shipped in sfcc-schemas.
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const xsdDir = path.join(path.dirname(require.resolve('sfcc-schemas/package.json')), 'xsd');
const importDir = path.join(root, 'metadata/site_import');

const files = [
    ['meta/system-objecttype-extensions.xml', 'metadata.xsd'],
    ['meta/custom-objecttype-definitions.xml', 'metadata.xsd'],
    ['services.xml', 'services.xsd'],
    ['jobs.xml', 'jobs.xsd']
];

try {
    execFileSync('xmllint', ['--version'], { stdio: 'ignore' });
} catch (e) {
    console.error('xmllint is required (Debian/Ubuntu: apt-get install libxml2-utils, macOS: preinstalled).');
    process.exit(1);
}

let failed = false;
files.forEach(([file, xsd]) => {
    const filePath = path.join(importDir, file);
    if (!fs.existsSync(filePath)) {
        console.error(`Missing ${file}`);
        failed = true;
        return;
    }
    try {
        execFileSync('xmllint', ['--noout', '--schema', path.join(xsdDir, xsd), filePath], { stdio: 'pipe' });
        console.log(`valid   ${file} (${xsd})`);
    } catch (e) {
        failed = true;
        console.error(`INVALID ${file} (${xsd})\n${e.stderr.toString()}`);
    }
});

const steptypes = path.join(root, 'cartridges/int_seet/steptypes.json');
try {
    JSON.parse(fs.readFileSync(steptypes, 'utf8'));
    console.log('valid   cartridges/int_seet/steptypes.json (JSON)');
} catch (e) {
    failed = true;
    console.error(`INVALID steptypes.json: ${e.message}`);
}

process.exit(failed ? 1 : 0);
