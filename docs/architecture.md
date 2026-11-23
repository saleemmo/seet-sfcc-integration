# Architecture

```
 Shopper browser
      │  HTML only (no Seet calls, no credentials)
      ▼
 SFRA storefront ── Product-Show ──remote include──► Seet-Rating / Seet-Reviews ─┐
      │                                                                         │ SeetReviewsService
      │                                                                         │ (custom cache "SeetReviews")
      │ CheckoutServices-PlaceOrder (append)                                    ▼
      ▼                                                                   SeetService (Service Framework)
 hook app.seet.order.placed ──► SeetOrderOutbox (custom object)                 │  Authorization: Bearer <store key>
                                         ▲                                      │  X-Seet-Store-Id / X-Seet-Site-Id
                                         │ job Seet-SyncOrders                  ▼
                                         └── ExportOrders / RetryFailedOrders ──► Seet Laravel API (multi-tenant)
```

## Principles

- **Server-side only.** Browser JavaScript never calls Seet. Pagination fetches the
  `Seet-ReviewsList` HTML fragment from the storefront itself.
- **Credentials stay on the server.** The store API key is the password of a Service
  Framework credential. It is sent as `Authorization: Bearer …` and redacted from service logs.
- **Checkout never waits for Seet.** Order placement only writes a custom object. A
  failing hook is logged and never fails the order.
- **Seet owns business logic.** The cartridge maps data and renders what Seet returns.

## Product identity

Reviews are attached to the SFCC product ID (`product.ID`). Variants are normalised to
their master product, so all colours and sizes share one review set. Order items send
`product_id` (master) and `sku` (the ordered variant).

## Reviews flow and caching

1. `Product-Show` (extended with `server.append`) adds `pdict.seet` with the remote-include URLs.
   The product page cache is not affected by Seet.
2. `Seet-Rating` and `Seet-Reviews` (include-only routes) call `SeetReviewsService`.
3. Successful responses are stored in the `SeetReviews` custom cache (10 minutes) under keys
   scoped by site ID and store ID. Failures are never cached.
4. Fragments are page cached for `seetCacheMinutes`; a fallback (Seet unavailable) is cached for 5 minutes.
5. The `seet.http.reviews` profile has a 2 s timeout and a circuit breaker. When Seet is down,
   the rating renders nothing and the reviews section shows a "temporarily unavailable" message.

## Order synchronization

| Step | Detail |
|---|---|
| Enqueue | After a successful `PlaceOrder`, the `app.seet.order.placed` hook creates `SeetOrderOutbox` (key = order number) with status `PENDING`, the payload, store ID, site ID and idempotency key `sfcc:<siteId>:<orderNo>`. Duplicates are ignored. |
| Export | `ExportOrders` selects due `PENDING` records, claims each one (`PENDING → PROCESSING`) and posts it with the `Idempotency-Key` header. At delivery time the current order and shipping status are re-read, so Seet sees status changes made before the first export. |
| Success | `2xx` or `409` → `SYNCED`, payload cleared (no personal data retained). |
| Failure | Retryable errors (timeout, 408, 429, 5xx) → `FAILED` with exponential backoff `base × 2^(n-1)` capped at `MaxDelayMinutes`. Permanent errors (other 4xx, store mismatch) or `MaxRetries` reached → `FAILED` with no next attempt. |
| Abort | 401/403 or an open circuit breaker stop the batch; the current record is released without using a retry. |
| Recovery | `RetryFailedOrders` resets records stuck in `PROCESSING` longer than `LockTimeoutMinutes` and retries due `FAILED` records. |

Both steps run in one job so they never overlap. The job does not start a new run while the previous one is active.

Order placement is not delivery. The cartridge sends `order_status` and `shipping_status`.
Seet decides when to send review requests.

## Multi-tenancy

- Each site has its own store ID and can use its own service credential (`seetServiceCredentialId`).
- Seet must derive the tenant from the API key and reject requests where `X-Seet-Store-Id` does not match.
- Cache keys include site ID and store ID.
- Outbox records keep the store ID they were created for. A record is never sent if the
  site is now configured for another store.

## Data sent to Seet

Order number, site ID, currency, locale, order/shipping status, customer number, email,
billing phone, product IDs, SKU, product names, quantities, order date. No payment data
and no addresses. Merchants must cover this processing in their privacy notice.
