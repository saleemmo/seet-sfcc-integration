# API contract (proposed)

These endpoints are what the cartridge calls. They are a proposal for the Seet Laravel
API and must be confirmed against the backend before production.

## Common

Every request:

```
Authorization: Bearer {STORE_API_KEY}
X-Seet-Store-Id: {seetStoreId}
X-Seet-Site-Id: {SFCC site ID}
X-Seet-Platform: sfcc
Accept: application/json
```

Seet must resolve the tenant from the API key and return `403` when `X-Seet-Store-Id`
belongs to another store. The cartridge never trusts a store ID without the key.

Responses use `{ "success": true, "data": … }`. Errors:

```json
{ "success": false, "error": { "code": "VALIDATION_ERROR", "message": "…" } }
```

| Status | Cartridge behaviour |
|---|---|
| 2xx | Success |
| 404 (reviews, rating) | Product has no reviews |
| 409 (orders) | Already received → `SYNCED` |
| 401 / 403 | Configuration error; job batch stops |
| 408 / 429 / 5xx / timeout | Retry with backoff |
| other 4xx | Permanent failure, no automatic retry |

## GET /api/v1/integrations/sfcc/products/{productId}/rating

`productId` is the URL-encoded SFCC master product ID.

```json
{
  "success": true,
  "data": {
    "product_id": "25592581M",
    "average_rating": 4.7,
    "total_reviews": 125,
    "rating_distribution": { "5": 100, "4": 15, "3": 5, "2": 3, "1": 2 }
  }
}
```

## GET /api/v1/integrations/sfcc/products/{productId}/reviews?page=1&per_page=5

Only published reviews. `content` and `title` are plain text; the cartridge HTML-encodes them.

```json
{
  "success": true,
  "data": {
    "reviews": [
      {
        "id": 981,
        "title": "Great quality",
        "content": "The fabric is excellent.",
        "rating": 5,
        "author_name": "Sara A.",
        "created_at": "2026-11-01T10:00:00Z",
        "verified_purchase": true
      }
    ],
    "pagination": { "page": 1, "page_size": 5, "total": 125, "total_pages": 25 }
  }
}
```

## POST /api/v1/integrations/sfcc/orders

Header `Idempotency-Key: sfcc:{siteId}:{orderNo}`. Seet must treat repeated keys as the
same order (return `200`/`409`, never create a duplicate) and may update statuses.

```json
{
  "external_order_id": "00012345",
  "external_site_id": "RefArch",
  "currency": "SAR",
  "locale": "ar_SA",
  "order_status": "placed",
  "shipping_status": "not_shipped",
  "customer": { "external_id": "00001234", "email": "customer@example.com", "phone": "+966500000000" },
  "items": [ { "product_id": "25592581M", "sku": "701644031206M", "name": "Abaya", "quantity": 2 } ],
  "ordered_at": "2026-11-23T18:00:00.000Z"
}
```

`customer.external_id` is `null` for guest orders. Response: `201` (created), `200` or `409` (already known).

## Not used yet

`GET /health`, `POST /reviews` (review submission from the storefront) and
`POST /products/sync` are not implemented in the cartridge.
