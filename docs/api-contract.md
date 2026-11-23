# API contract

The cartridge calls three endpoints of the Seet Laravel API. They were checked against
the Laravel code (`routes/api.php`, `PublicReviewController`, `OrderWebhookController`);
the cartridge needs no changes in Laravel.

Base URL: the URL of the service credential, including the version prefix, for example
`https://<seet-host>/api/v1`.

| Call | Endpoint | Store identified by |
|---|---|---|
| Rating summary | `GET /public/product/rating-batch` | Public key (`store` query parameter) |
| Reviews | `GET /public/reviews` | Public key (`public_key` query parameter) |
| Order events | `POST /integrations/orders` | Secret key (`Authorization: Bearer sk_live_…`) |

Every request also sends `Accept: application/json`, `X-Seet-Platform: sfcc` and
`X-Seet-Site-Id: {siteId}`. Seet does not read the two `X-Seet-*` headers today; they
only help when reading logs.

## Review endpoints (public key)

The secret key is never sent to these endpoints. Seet checks two things before it
answers:

- The review widget is enabled for the store (`403` otherwise, reviews endpoint only).
- When the store has allowed domains, the request's `Origin` host is one of them
  (`403` otherwise). The request comes from the SFCC server, so the cartridge sends
  `Origin: https://{storefront host}`. The merchant must list every storefront host
  exactly as shoppers see it (`www.example.com` and `example.com` are different hosts).

An unknown public key returns `404`. The cartridge treats `403` and `404` as
"reviews unavailable" and does not cache them.

### GET /public/product/rating-batch?store={publicKey}&sku={productId}

```json
[{ "sku": "25518447M", "average_rating": "4.7", "num_ratings": 125 }]
```

A product without reviews, or one Seet does not know, returns `"0"` and `0`.

### GET /public/reviews?public_key={publicKey}&product_external_id={productId}&page=1&limit=5

`limit` is capped at 50 by Seet. The cartridge reads these fields and ignores the rest:

```json
{
  "data": [
    {
      "id": 981,
      "rating": 5,
      "title": "Great fit",
      "content": "Plain text",
      "reviewer": "Sara A.",
      "verified": true,
      "created_at": "2026-11-01 10:00:00"
    }
  ],
  "meta": {
    "total": 125,
    "filtered_total": 125,
    "current_page": 1,
    "last_page": 25,
    "per_page": 5,
    "average_rating": 4.7,
    "distribution": { "5": 100, "4": 15, "3": 5, "2": 3, "1": 2 }
  }
}
```

`created_at` has no time zone and is read as UTC. `productId` is the SFCC master
product ID. Seet splits product identifiers on `,` and `;`, so the cartridge does not
query product IDs that contain those characters.

## POST /integrations/orders (secret key)

Seet finds the store from the secret key and creates or updates the order by
`order_id`. Sending the same order again is safe, and each event carries the full
order. `order_id` is `{siteId}-{orderNo}`: SFCC order numbers are only unique per
site, so the site ID keeps two sites that share one Seet store from overwriting each
other's orders. The plain order number is in `metadata.order_no`. The cartridge also sends `Idempotency-Key: sfcc:{siteId}:{orderNo}`; Seet does
not read it today.

```json
{
  "event": "order.delivered",
  "order_id": "RefArch-00012345",
  "channel": "online",
  "country": "SA",
  "language": "ar",
  "placed_at": "2026-11-23T18:00:00.000Z",
  "delivered_at": "2026-11-25T08:00:00.000Z",
  "total": 250.5,
  "currency": "SAR",
  "customer": { "name": "Sara Ali", "email": "customer@example.com", "phone": "+966500000000" },
  "items": [
    {
      "sku": "25518447M",
      "external_id": "25518447M",
      "name": "Abaya",
      "quantity": 2,
      "url": "https://www.example.com/abaya/25518447M.html",
      "image_url": "https://www.example.com/images/25518447M.jpg"
    }
  ],
  "metadata": { "platform": "sfcc", "site_id": "RefArch", "order_no": "00012345", "locale": "ar_SA" }
}
```

| Field | Source |
|---|---|
| `order_id` | Site ID, a hyphen and the SFCC order number. |
| `event` | SFCC order status through the status mapping (see [configuration.md](configuration.md)). |
| `fulfilled_at`, `delivered_at`, `cancelled_at`, `refunded_at`, `returned_at` | Time the cartridge first saw that status. Without it Seet would use the time it received the request, which moves on every retry. |
| `customer.name` | Order customer name, else the billing name, else `Customer` (Seet requires a name). |
| `customer.email`, `customer.phone` | Order email and billing phone. Seet requires at least one. |
| `country` | Shipping country, else billing country. |
| `items[].sku`, `items[].external_id` | Master product ID, the same ID the review endpoints are queried with. Lines of the same master product are merged and their quantities added. |

| Response | Cartridge behaviour |
|---|---|
| `200` | Record becomes `SYNCED`. |
| `401` (`invalid_integration_secret`) | Batch stops; no retry is used. Fix the secret key. |
| `422` (validation) | Permanent failure; the record is not retried. `lastError` holds Seet's message. |
| `408`, `429`, `5xx`, timeout | Retried with backoff. |

## Limits of this contract

- Seet does not link the public key to the secret key in any response, so the cartridge
  cannot check that both belong to the same store. Orders always go to the store that
  owns the secret key.
- SFCC has no "delivered" status. See the status mapping.
- Review submission, votes and the eligibility endpoint are not used.
