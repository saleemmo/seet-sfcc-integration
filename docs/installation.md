# Installation

## 1. Build and upload the cartridge

```bash
nvm use && npm ci
npm run check
cp dw.json.example dw.json        # hostname, username, password (Account Manager / API client), code-version
npm run upload
```

`dw.json` is git-ignored. You can also upload `cartridges/int_seet` with the Prophet
extension or another WebDAV tool.

## 2. Import metadata

```bash
npm run package:metadata -- --site <SiteID>
```

In Business Manager open **Administration > Site Development > Site Import & Export**,
upload `dist/seet_site_import.zip` and import it. The archive contains:

| File | Creates |
|---|---|
| `meta/system-objecttype-extensions.xml` | Site preferences group **Seet** |
| `meta/custom-objecttype-definitions.xml` | Custom object type `SeetOrderOutbox` (site scope, 90-day retention) |
| `services.xml` | Credential `seet.http.api.cred`, profiles and services `seet.http.reviews`, `seet.http.orders` |
| `jobs.xml` | Job `Seet-SyncOrders` (trigger disabled) |

Re-importing `services.xml` overwrites the credential URL with the placeholder. After
the first import, import only the files that changed.

## 3. Cartridge path

**Administration > Sites > Manage Sites > \<site\> > Settings**: add `int_seet` to the left of the base cartridge:

```
int_seet:app_custom_<brand>:app_storefront_base
```

`int_seet` extends `Product-Show` and `CheckoutServices-PlaceOrder` with `server.append`,
so it must sit to the left of every cartridge that defines these controllers. If a custom
cartridge replaces those routes completely, put `int_seet` to the left of it.

For the Seet job steps, also add `int_seet` to the **Business Manager cartridge path**
(Administration > Sites > Manage Sites > Business Manager - Settings) if your instance
resolves job step modules from it.

## 4. Set the Seet keys

In the Seet dashboard, copy the store's public key (`pk_live_…`) and secret key
(`sk_live_…`), enable the review widget, and add every storefront host to the allowed
domains (or leave the list empty).

**Administration > Operations > Services > Credentials > seet.http.api.cred**:

- URL: Seet API base URL (HTTPS) including the version prefix, `https://<seet-host>/api/v1`
- User: leave empty
- Password: the store's secret key (`sk_live_…`)

The public key goes into the `seetStoreId` site preference in the next step.

## 5. Configure the site

**Merchant Tools > Site Preferences > Custom Preferences > Seet**. See [configuration.md](configuration.md).

## 6. Add the templates to the product page

In your brand cartridge's copy of the PDP template (for example
`product/productDetails.isml`, and `product/setDetails.isml` / `bundleDetails.isml` if used):

```html
<!-- near the product name -->
<isinclude template="product/seetRatingInclude" />

<!-- below the description -->
<isinclude template="product/seetReviewsInclude" />
```

The includes render nothing unless Seet is enabled and configured for the site. They
register `css/seetReviews.css` and `js/seetReviews.js` with SFRA's `assets` helper.

## 7. Enable the job

**Administration > Operations > Jobs > Seet-SyncOrders**: check the site in the job's
scope, then enable the 15-minute trigger in **Schedule and History**.

## 8. Verify

1. Open a product with reviews: the rating and reviews render; page through the reviews.
2. Place an order: a `SeetOrderOutbox` record with status `PENDING` appears in
   **Merchant Tools > Custom Objects > Custom Object Editor**.
3. Run `Seet-SyncOrders`: the record becomes `SYNCED` with `lastSyncedEvent` `order.placed`,
   and the order appears in Seet.
4. Set the order to `COMPLETED` and run the job again: `lastSyncedEvent` becomes
   `order.delivered` and the order is delivered in Seet.
5. Optional: `SEET_TEST_PRODUCT_ID=<pid> npm run test:integration -- --baseUrl https://<host>/on/demandware.store/Sites-<SiteID>-Site/<locale>`.
