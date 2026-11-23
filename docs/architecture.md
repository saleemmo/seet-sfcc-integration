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
 hook app.seet.order.placed ──► SeetOrderOutbox (custom object)                 │  reviews: public key
                                         ▲                                      │  orders: Authorization: Bearer <secret key>
                                         │ job Seet-SyncOrders                  ▼
     QueueOrderUpdates (status changes) ─┴── ExportOrders / RetryFailedOrders ──► Seet Laravel API (multi-tenant)
```

## Principles

- **Server-side only.** Browser JavaScript never calls Seet. Pagination fetches the
  `Seet-ReviewsList` HTML fragment from the storefront itself.
- **Credentials stay on the server.** The store secret key (`sk_live_…`) is the password
  of a Service Framework credential. It is sent only with order events, as
  `Authorization: Bearer …`, and redacted from service logs. Review calls use the store's
  public key, which also never reaches the browser.
- **Checkout never waits for Seet.** Order placement only writes a custom object. A
  failing hook is logged and never fails the order.
- **Seet owns business logic.** The cartridge maps data and renders what Seet returns.

## Product identity

Reviews are attached to the SFCC product ID (`product.ID`). Variants are normalised to
their master product, so all colours and sizes share one review set. Order items send
the master product ID as both `sku` and `external_id`, so Seet attaches the order to the
product the reviews are read from.

## Reviews flow and caching

1. `Product-Show` (extended with `server.append`) adds `pdict.seet` with the remote-include URLs.
   The product page cache is not affected by Seet.
2. `Seet-Rating` and `Seet-Reviews` (include-only routes) call `SeetReviewsService`, which
   reads Seet's public review endpoints with the store's public key and the storefront
   host as `Origin` (Seet only answers for the store's allowed domains).
3. Successful responses are stored in the `SeetReviews` custom cache (10 minutes) under keys
   scoped by site ID, store ID and storefront host. Failures are never cached.
4. Fragments are page cached for `seetCacheMinutes`; a fallback (Seet unavailable) is cached for 5 minutes.
5. The `seet.http.reviews` profile has a 2 s timeout and a circuit breaker. When Seet is down,
   the rating renders nothing and the reviews section shows a "temporarily unavailable" message.

## Order synchronization

| Step | Detail |
|---|---|
| Enqueue | After a successful `PlaceOrder`, the `app.seet.order.placed` hook creates `SeetOrderOutbox` (key = order number) with status `PENDING`, the payload, store ID and site ID. Duplicates are ignored. |
| Status changes | `QueueOrderUpdates` scans orders modified in the last `LookbackHours`. A `SYNCED` record whose order now maps to a different Seet event (shipped, delivered, cancelled) is set back to `PENDING` with a fresh payload. Placed orders without a record (for example orders created through an API) are queued too. This step never calls Seet. |
| Export | `ExportOrders` selects due `PENDING` records, claims each one (`PENDING → PROCESSING`) and posts it to `POST /integrations/orders`. The order status is re-read at delivery time, so the event is always the current one. |
| Success | `2xx` → `SYNCED`, the sent event is stored in `lastSyncedEvent`, payload cleared (no personal data retained). |
| Failure | Retryable errors (timeout, 408, 429, 5xx) → `FAILED` with exponential backoff `base × 2^(n-1)` capped at `MaxDelayMinutes`. Permanent errors (other 4xx such as 422, store mismatch) or `MaxRetries` reached → `FAILED` with no next attempt. |
| Abort | 401/403 or an open circuit breaker stop the batch; the current record is released without using a retry. |
| Recovery | `RetryFailedOrders` resets records stuck in `PROCESSING` longer than `LockTimeoutMinutes` and retries due `FAILED` records. |

All steps run in one job so they never overlap. The job does not start a new run while the previous one is active.

One record per order carries the latest event. Seet creates or updates an order by its
number, so resending is safe and events cannot arrive out of order.

Order placement is not delivery. Seet makes an order eligible for a review request only
when it receives `order.delivered`, which the cartridge sends when the SFCC order status
maps to it (by default `COMPLETED`). Seet decides when to send review requests.

## Multi-tenancy

- Each site has its own public key (`seetStoreId`) and can use its own service credential (`seetServiceCredentialId`).
- Seet derives the store from the key: the public key for reviews, the secret key for orders.
  Both keys of a site must come from the same Seet store; Seet offers no way to check this from the cartridge.
- Cache keys include site ID, store ID and storefront host.
- Outbox records keep the store ID they were created for. A record is never sent if the
  site is now configured for another store.

## Data sent to Seet

Order number, site ID, order event, order total, currency, locale, shipping country,
customer name, email, billing phone, master product IDs, product names, product and image
URLs, quantities, order date. No payment data and no street addresses. Merchants must
cover this processing in their privacy notice.
