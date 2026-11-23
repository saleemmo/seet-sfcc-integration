# Seet integration for Salesforce B2C Commerce (SFRA)

`int_seet` is a private SFRA cartridge that connects a B2C Commerce storefront to
Seet. It renders Seet ratings and reviews server-side on the product page and
sends placed orders to Seet asynchronously, so Seet can request reviews after delivery.

All business logic (review moderation, review requests, analytics) stays in Seet.
The cartridge only handles configuration, data mapping, storefront rendering and synchronization.

| Feature | Implementation |
|---|---|
| Rating summary and reviews on the PDP | `Seet-Rating` / `Seet-Reviews` remote includes, ISML, page cache plus custom cache |
| Review pagination | `Seet-ReviewsList` HTML fragment, progressive enhancement (no API calls from the browser) |
| Order sync | `CheckoutServices-PlaceOrder` hook → `SeetOrderOutbox` custom object → `Seet-SyncOrders` job |
| Authentication | Per-store API key stored in a Service Framework credential |
| Localisation | English and Arabic resource bundles, RTL-safe SCSS (logical properties) |

## Requirements

- SFRA storefront (`app_storefront_base`)
- Node.js 20.19.0 or later (`.nvmrc` pins 24) and npm
- `xmllint` to validate metadata, `zip` to package it
- A Seet store and its API key

## Quick start

```bash
nvm use
npm ci
npm run check            # lint + metadata validation + unit tests + build
cp dw.json.example dw.json   # fill in sandbox host, Account Manager credentials, code version
npm run upload           # uploads cartridges/int_seet to the code version in dw.json
npm run package:metadata -- --site <SiteID>   # dist/seet_site_import.zip for Site Import & Export
```

Then follow [docs/installation.md](docs/installation.md) to import the metadata,
add the cartridge to the site path, set the API key and add the ISML includes.

## Scripts

| Script | Purpose |
|---|---|
| `npm run build` | Compile client JS and SCSS into `cartridge/static` |
| `npm run lint` | ESLint (SFCC/ES5 rules for server code) and Stylelint |
| `npm test` / `npm run cover` | Mocha unit tests with mocked `dw.*` APIs / coverage report |
| `npm run validate:metadata` | Validate site import XML against the official B2C Commerce XSDs |
| `npm run package:metadata -- --site <SiteID>` | Build the site import archive |
| `npm run upload` | Upload the cartridge with `sgmf-scripts` (needs `dw.json`) |
| `npm run test:integration` | Sandbox smoke tests (needs a configured sandbox, see the test file) |

## Documentation

- [Architecture](docs/architecture.md)
- [Installation](docs/installation.md)
- [Configuration](docs/configuration.md)
- [API contract](docs/api-contract.md)
- [Troubleshooting](docs/troubleshooting.md)

## Repository layout

```
cartridges/int_seet/            the cartridge (upload this)
  cartridge/controllers/        Seet.js, Product.js (extends Show), CheckoutServices.js (extends PlaceOrder)
  cartridge/scripts/helpers/    configuration, product, review and outbox helpers
  cartridge/scripts/services/   Service Framework client, reviews and orders services
  cartridge/scripts/hooks/      app.seet.order.placed → outbox
  cartridge/scripts/jobs/       ExportOrders, RetryFailedOrders
  cartridge/templates/          ISML (product/…) and resources (seet*.properties)
  cartridge/client/default/     source JS and SCSS
  steptypes.json                custom job step types
metadata/site_import/           site preferences, custom object, services, job
tests/unit/                     unit tests; tests/mocks has the dw.* mocks
bin/                            metadata validation and packaging scripts
```
