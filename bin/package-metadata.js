#!/usr/bin/env node

'use strict';

// Creates dist/seet_site_import.zip for Business Manager > Site Import & Export.
// Usage: npm run package:metadata -- --site <SiteID>
const { execFileSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const root = path.resolve(__dirname, '..');
const siteArgIndex = process.argv.indexOf('--site');
const siteId = siteArgIndex > -1 ? process.argv[siteArgIndex + 1] : 'RefArch';
if (!/^[A-Za-z0-9_-]{1,32}$/.test(siteId || '')) {
    console.error('Invalid --site value');
    process.exit(1);
}

const dist = path.join(root, 'dist');
const staging = path.join(dist, 'seet_site_import');
fs.rmSync(dist, { recursive: true, force: true });
fs.cpSync(path.join(root, 'metadata/site_import'), staging, { recursive: true });

const jobsFile = path.join(staging, 'jobs.xml');
fs.writeFileSync(jobsFile, fs.readFileSync(jobsFile, 'utf8').replace(/site-id="RefArch"/g, `site-id="${siteId}"`));

try {
    execFileSync('zip', ['-rq', 'seet_site_import.zip', 'seet_site_import'], { cwd: dist, stdio: 'inherit' });
} catch (e) {
    console.error('The "zip" command is required to build the archive. The unzipped folder is in dist/seet_site_import.');
    process.exit(1);
}
console.log(`Created dist/seet_site_import.zip (job context site: ${siteId})`);
