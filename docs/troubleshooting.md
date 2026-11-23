# Troubleshooting

Logs: **Administration > Site Development > Development Setup > Log Files**, files
`custom-seet*.log` and service logs with prefix `seet`.

| Symptom | Check |
|---|---|
| Nothing renders on the PDP | `seetEnabled` and `seetReviewsEnabled` on; store ID valid; base URL is HTTPS; ISML includes added; `int_seet` left of the PDP cartridges. An invalid configuration silently disables the integration. |
| "Reviews are temporarily unavailable" | Seet timed out, returned an error, or the circuit breaker is open. `HTTP 404` in the log: `seetStoreId` is not a valid public key. `HTTP 403`: the review widget is disabled in Seet, or the storefront host is missing from the store's allowed domains. See the `seet` log and **Operations > Services > seet.http.reviews** status. The fallback is cached for 5 minutes. |
| Old reviews shown | Fragments are page cached for `seetCacheMinutes` and API responses for 10 minutes in the `SeetReviews` cache. Clear the page cache or wait. |
| `CONFIG` errors in the log | Credential has no password (orders only), the URL is not HTTPS, or `seetServiceCredentialId` names a credential that does not exist. |
| No `SeetOrderOutbox` records | `seetOrderSyncEnabled` off, metadata not imported, or a custom checkout that does not use `CheckoutServices-PlaceOrder`. Look for `Could not queue order for Seet` or `Seet order hook failed` in the log. |
| Order not found in Seet by its order number | Seet stores the order as `{siteId}-{orderNo}`, for example `RefArch-00012345`. |
| Job step ends with `DISABLED` | Order sync is off for the site in the job scope. |
| Job step ends with `ABORTED` | 401 (`invalid_integration_secret`: the credential password is not the store's `sk_live_…` secret key) or the circuit breaker is open. Fix the credential; records are not consumed. |
| `HTTP 404` on order export | The credential URL lacks the `/api/v1` prefix. |
| Order never becomes delivered in Seet | The SFCC order status does not map to `order.delivered` (see the status mapping), the order was modified longer ago than `LookbackHours`, or the `QueueOrderUpdates` step is missing from the job. |
| Records stay `FAILED` with empty `nextRetryAt` | Permanent error or `MaxRetries` reached. Read `lastError`, fix the cause, then reset the record (see configuration.md). |
| `STORE_MISMATCH` in `lastError` | The site's public key (`seetStoreId`) changed after the order was queued. Records are never sent to another store; resolve with Seet manually. |
| Records stuck in `PROCESSING` | A job run was interrupted. `RetryFailedOrders` recovers them after `LockTimeoutMinutes`. |
| Arabic page shows English labels | The site locale must be `ar` or `ar_XX`; labels come from `seet_ar.properties`. |
