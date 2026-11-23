# Configuration

## Site preferences (group "Seet")

| Preference | Type | Default | Description |
|---|---|---|---|
| `seetEnabled` | Boolean | false | Master switch. |
| `seetStoreId` | String | – | Seet store ID (`A-Z a-z 0-9 _ -`, max 64). Must belong to the API key. |
| `seetApiBaseUrl` | String | – | Optional HTTPS base URL. Must be on the same host as the service credential URL, so a preference editor cannot redirect the API key. Empty = URL of the service credential. |
| `seetServiceCredentialId` | String | – | Optional credential override (see below). |
| `seetReviewsEnabled` | Boolean | false | Render ratings and reviews. |
| `seetOrderSyncEnabled` | Boolean | false | Queue and export orders. |
| `seetReviewPageSize` | Integer | 5 | Reviews per page (1–50). |
| `seetCacheMinutes` | Integer | 60 | Page cache of rating/review fragments (1–1440). |
| `seetOrderStatusMapping` | Text | – | JSON object overriding the order status mapping. |

The integration stays inactive (renders nothing, queues nothing) when the store ID is invalid or the base URL is not HTTPS.

## Several sites, several Seet stores

Every Seet store has its own API key. When sites in one realm belong to different
Seet stores, create one credential per store (for example `seet.http.api.cred.brandb`)
in **Operations > Services > Credentials** and set `seetServiceCredentialId` on that
site. Sites that share a store can share the default `seet.http.api.cred`.

## Order status mapping

Default mapping:

| SFCC order status | Seet `order_status` |
|---|---|
| CREATED | created |
| NEW, OPEN | placed |
| COMPLETED | completed |
| CANCELLED | cancelled |
| REPLACED | replaced |
| FAILED | failed |

Shipping status is sent as `not_shipped`, `partially_shipped` or `shipped`. Example override:

```json
{"COMPLETED": "delivered"}
```

## Services

| Service | Profile | Timeout | Circuit breaker |
|---|---|---|---|
| `seet.http.reviews` | `seet.http.reviews.profile` | 2 s | 10 errors / 60 s |
| `seet.http.orders` | `seet.http.orders.profile` | 10 s | 5 errors / 60 s |

Keep communication logging disabled in production. Enable it temporarily for
troubleshooting; the cartridge redacts the API key, emails, phone numbers and names.

## Job `Seet-SyncOrders`

| Parameter | Default | Steps | Meaning |
|---|---|---|---|
| `BatchSize` | 50 | both | Records per step run (1–500). |
| `MaxRetries` | 8 | both | Failed attempts before automatic retries stop. |
| `BaseDelayMinutes` | 5 | both | First retry delay; doubles per attempt. |
| `MaxDelayMinutes` | 720 | both | Maximum retry delay. |
| `LockTimeoutMinutes` | 30 | RetryFailedOrders | Age after which `PROCESSING` records are recovered. |

With the defaults, retries happen after 5, 10, 20, 40, 80, 160 and 320 minutes (about 10.5 hours in total).
To retry a record manually, set `status` to `FAILED`, `retryCount` to 0 and `nextRetryAt`
to the current time in the Custom Object Editor.

## Logging

Category `seet` (custom log files `custom-seet*.log`). Service logs use the prefix `seet`.
