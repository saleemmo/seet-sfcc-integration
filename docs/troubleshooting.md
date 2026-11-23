# Troubleshooting

Logs: **Administration > Site Development > Development Setup > Log Files**, files
`custom-seet*.log` and service logs with prefix `seet`.

| Symptom | Check |
|---|---|
| Nothing renders on the PDP | `seetEnabled` and `seetReviewsEnabled` on; store ID valid; base URL is HTTPS; ISML includes added; `int_seet` left of the PDP cartridges. An invalid configuration silently disables the integration. |
| "Reviews are temporarily unavailable" | Seet timed out, returned an error, or the circuit breaker is open. See the `seet` log and **Operations > Services > seet.http.reviews** status. The fallback is cached for 5 minutes. |
| Old reviews shown | Fragments are page cached for `seetCacheMinutes` and API responses for 10 minutes in the `SeetReviews` cache. Clear the page cache or wait. |
| `CONFIG` errors in the log | Credential has no password, the URL is not HTTPS, or `seetServiceCredentialId` names a credential that does not exist. |
| No `SeetOrderOutbox` records | `seetOrderSyncEnabled` off, metadata not imported, or a custom checkout that does not use `CheckoutServices-PlaceOrder`. Look for `Could not queue order for Seet` or `Seet order hook failed` in the log. |
| Job step ends with `DISABLED` | Order sync is off for the site in the job scope. |
| Job step ends with `ABORTED` | 401/403 (wrong key or store ID) or the circuit breaker is open. Fix the credential; records are not consumed. |
| Records stay `FAILED` with empty `nextRetryAt` | Permanent error or `MaxRetries` reached. Read `lastError`, fix the cause, then reset the record (see configuration.md). |
| `STORE_MISMATCH` in `lastError` | The site's store ID changed after the order was queued. Records are never sent to another store; resolve with Seet manually. |
| Records stuck in `PROCESSING` | A job run was interrupted. `RetryFailedOrders` recovers them after `LockTimeoutMinutes`. |
| Arabic page shows English labels | The site locale must be `ar` or `ar_XX`; labels come from `seet_ar.properties`. |
