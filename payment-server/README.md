# payment-server

Xendit payment session + webhook service for Five-orites Scoop.

## Why this exists as a separate process

The Angular app cannot hold the Xendit secret key — it ships in the browser
bundle. And the project is on Firebase's **Spark** plan, so Cloud Functions
cannot be deployed (see `CUTOVER.md`). So the payment code lives here, in its
own Node/Express process, and is deployed somewhere that is not Firebase.

## What it does

| Endpoint                | Auth                                          | Purpose                                                                                                                       |
| ----------------------- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `POST /payment/session` | Firebase ID token (`Authorization: Bearer …`) | Re-prices an order server-side, creates a Xendit payment request, stores `paymentRequestId`, returns the hosted-checkout URL. |
| `POST /payment/webhook` | `x-callback-token` header                     | The **only** writer of `paymentStatus` in the system. Marks orders `paid` / `failed`, idempotently.                           |
| `GET /health`           | none                                          | Liveness. Touches no database.                                                                                                |

## Security invariants

1. The Xendit secret key and webhook token exist **only** here, via env vars.
2. The amount charged is recomputed from Firestore (`src/reprice.ts`) — never
   taken from the request body, and never from the stored `grandTotal` when the
   two disagree.
3. `paymentStatus` is written **only** by the verified webhook. A browser
   redirect is never proof of payment.
4. No card data, tokens, or full webhook payloads are logged.

## Deliberate deviation from PLAN-XENDIT-CHECKOUT.md §2

The plan says the success webhook should also advance `status` to `confirmed`.
**It does not.** Fulfilment status is advanced by staff from the fulfilment
queue, and that same client transaction is what takes stock off the shelf
(`STOCK_TAKEN_STATUSES` in `OrderService`). A server-side jump to `confirmed`
would bypass the only place stock is ever decremented. Payment and fulfilment
move independently.

The plan also says to send `amount` to v3; the actual field is `request_amount`.
See the header of `src/xendit.ts`.

## Running locally

```bash
cd payment-server
npm install
cp .env.example .env      # then fill in your test keys
npm start                 # → http://localhost:4242
```

Against the Firebase emulators (no real project needed):

```bash
USE_EMULATOR=true npm start
```

Webhooks cannot reach `localhost`. For end-to-end testing, tunnel both ports
and register the public webhook URL in the Xendit dashboard:

```bash
ngrok http 4242     # → https://xxxx.ngrok-free.app
# Xendit dashboard → Webhooks → URL: https://xxxx.ngrok-free.app/payment/webhook
```

## Deployment

Any Node 20+ host that can reach the internet — Render, Railway, Fly.io. Set
the env vars from `.env.example`, then register
`https://<your-host>/payment/webhook` in the Xendit dashboard.

Before going live: complete Xendit KYC, switch `XENDIT_LIVE=true`, use live
keys, and set `APP_BASE_URL` to the deployed app origin.
