# Configuration

## Site preferences (group "Seet")

| Preference | Type | Default | Description |
|---|---|---|---|
| `seetEnabled` | Boolean | false | Master switch. |
| `seetStoreId` | String | – | The Seet store's public key (`pk_live_…`). Must come from the same Seet store as the secret key in the service credential. |
| `seetApiBaseUrl` | String | – | Optional HTTPS base URL. Must be on the same host as the service credential URL, so a preference editor cannot redirect the secret key. Empty = URL of the service credential. Include the version prefix (`/api/v1`). |
| `seetServiceCredentialId` | String | – | Optional credential override (see below). |
| `seetReviewsEnabled` | Boolean | false | Render ratings and reviews. |
| `seetOrderSyncEnabled` | Boolean | false | Queue and export orders. |
| `seetReviewPageSize` | Integer | 5 | Reviews per page (1–50). |
| `seetCacheMinutes` | Integer | 60 | Page cache of rating/review fragments (1–1440). |
| `seetOrderStatusMapping` | Text | – | JSON object overriding the order status to Seet event mapping. |

The integration stays inactive (renders nothing, queues nothing) when the public key is missing or malformed, or the base URL is not HTTPS.

## Seet store settings

Reviews only render when, in the Seet dashboard:

- the review widget is enabled for the store, and
- the store's allowed domains are empty or contain every storefront host exactly as
  shoppers see it (for example both `www.example.com` and `example.com`, plus sandbox hosts).

## Several sites, several Seet stores

Every Seet store has its own public key and secret key. When sites in one realm belong to different
Seet stores, create one credential per store (for example `seet.http.api.cred.brandb`)
in **Operations > Services > Credentials** and set `seetServiceCredentialId` on that
site, together with that store's public key in `seetStoreId`. Sites that share a store can share the default `seet.http.api.cred`.

## Order status mapping

Seet receives order events. The event is derived from the SFCC order status:

| SFCC status | Seet event |
|---|---|
| NEW, OPEN | `order.placed` |
| OPEN with shipping status SHIPPED (key `SHIPPED`) | `order.shipped` |
| COMPLETED | `order.delivered` |
| CANCELLED, REPLACED | `order.cancelled` |

Seet makes an order eligible for a review request only on `order.delivered`. SFCC has no
"delivered" status, so `COMPLETED` is used by default. If your order management marks
orders `COMPLETED` before the customer has the goods, change the mapping and send
`order.delivered` from the status that fits, for example:

```json
{"COMPLETED": "order.shipped"}
```

Keys: `NEW`, `OPEN`, `SHIPPED`, `COMPLETED`, `CANCELLED`, `REPLACED`. Values:
`order.placed`, `order.paid`, `order.shipped`, `order.delivered`, `order.cancelled`,
`order.refunded`, `order.returned`. Other values are ignored.

## Services

| Service | Profile | Timeout | Circuit breaker |
|---|---|---|---|
| `seet.http.reviews` | `seet.http.reviews.profile` | 2 s | 10 errors / 60 s |
| `seet.http.orders` | `seet.http.orders.profile` | 10 s | 5 errors / 60 s |

Keep communication logging disabled in production. Enable it temporarily for
troubleshooting; the cartridge redacts the secret key, emails, phone numbers and names.

## Job `Seet-SyncOrders`

| Parameter | Default | Steps | Meaning |
|---|---|---|---|
| `LookbackHours` | 24 | QueueOrderUpdates | Orders modified within this many hours are checked for a status change (1–720). Keep it longer than the longest gap between job runs. |
| `BatchSize` | 50 | export, retry | Records per step run (1–500). |
| `MaxRetries` | 8 | export, retry | Failed attempts before automatic retries stop. |
| `BaseDelayMinutes` | 5 | export, retry | First retry delay; doubles per attempt. |
| `MaxDelayMinutes` | 720 | export, retry | Maximum retry delay. |
| `LockTimeoutMinutes` | 30 | RetryFailedOrders | Age after which `PROCESSING` records are recovered. |

With the defaults, retries happen after 5, 10, 20, 40, 80, 160 and 320 minutes (about 10.5 hours in total).
The first run after order sync is enabled also queues placed orders modified within
`LookbackHours` that have no outbox record yet.

To retry a record manually, set `status` to `FAILED`, `retryCount` to 0 and `nextRetryAt`
to the current time in the Custom Object Editor.

## Logging

Category `seet` (custom log files `custom-seet*.log`). Service logs use the prefix `seet`.
