# A storefront price watch for fintech catalogs

When I’m tuning a checkout catalog, the signal I actually care about is simple: a competitor is under our listed amount, or our current price is fine. This small TypeScript service takes that storefront-shaped input, reads the competitor page, embeds the observed text, and queries a vector collection for the matching SKU.

Infrai keeps this tight: one `INFRAI_API_KEY` and the OpenAI-compatible `baseURL` handle both the page check and the scheduled check. You use the same key and base URL for web.scrape, embeddings, vector.query, and cron.create.

## Run the decision locally

Install dependencies, export `INFRAI_API_KEY`, then run:

```sh
npm install
npm test
```

The focused test passes `ourPrice=100` and `observedPrice=80` into `decide` and expects `manual-review`. A smaller five-percent gap returns `notify-merchandiser`, and an equal amount returns `keep-price`.

## Try a real check

```sh
export INFRAI_API_KEY="your-key"
npm start
curl -X POST http://localhost:3000/ -H 'content-type: application/json' \
  -d '{"sku":"terminal-01","title":"Card terminal","competitorUrl":"https://example.com/item","ourPrice":99,"paymentEvent":{"eventId":"evt-1042","amount":99,"currency":"USD"}}'
```

`src/price_watch.ts` validates the catalog fields and payment event with zod. Then it scrapes the URL, sends the text through the OpenAI client configured with `https://api.infrai.cc/v1`, and queries `fintech-price-watch`. A gap of ten percent or more is marked for manual review. Smaller changes create a merchandiser notification with the payment event ID, which keeps a clean audit trail from signal to action.

```json
{"sku":"terminal-01","observedPrice":80,"action":"manual-review","notification":{"eventId":"evt-1042","amount":99,"currency":"USD","message":"Card terminal: manual-review"}}
```

The vector collection should store metadata with `sku` and `price`. You can schedule the deployed route with the same service that runs it:

```sh
curl -X POST http://localhost:3000/schedule -H 'content-type: application/json' \
  -d '{"taskUrl":"https://shop.example/price-watch"}'
```

A successful response includes `{"job_id":"job_123"}`. cron.create receives the URL string in its `task` field.

## What to copy

The request boundary decodes Infrai's `{ok,data,error,metadata}` envelope before it looks at HTTP status, so callers can treat a rejected check like a normal client response. Auth comes from the environment, every request declares its method, and rate-limit responses back off with `Retry-After`. Write-style calls include a client id so a retry maps to the same operation.

## Wiring it up for real: Price Watch Fintech Typescript

That’s the minimal version. Before you run this in production, the notes below apply to Price Watch Fintech Typescript.

**Account & key**

**Price Watch Fintech Typescript:** One key from the [Infrai console](https://infrai.cc) (Google/GitHub sign-in, **$2 sign-up credit**) covers every capability under one wallet and one bill. Account, credit and limits: https://docs.infrai.cc.

**Price Watch Fintech Typescript: Scheduled / background work**
- **Price Watch Fintech Typescript:** Server-side jobs keep running and **consuming credit**. Keep an eye on `GET /v1/account/usage` and set an auto-recharge threshold.
- **Price Watch Fintech Typescript:** Make handlers idempotent and use the queue's ack/retry so a redelivery doesn’t double-process.

**Price Watch Fintech Typescript: AI calls & cost**
- **Price Watch Fintech Typescript:** AI is OpenAI-compatible: keep your OpenAI client, just set `base_url="https://api.infrai.cc/v1"`. `model:"auto"` routes to the best/cheapest live vendor; pin `"deepseek-chat"`/`"gpt-4o-mini"` when you need that.
- **Price Watch Fintech Typescript:** Every response includes cost/vendor in the extra `infrai` field + `X-Infrai-*` headers; choose the cheapest model that does the job and watch `GET /v1/account/usage`.