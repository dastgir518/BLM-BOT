# Bio Lec Codex Bot

Codex-powered assistant prototype for Bio Lec Mobility.

This repo contains:

- A Node.js bot server that embeds WooCommerce product data into Supabase pgvector.
- A semantic product search endpoint.
- A Codex SDK chat endpoint that retrieves product context before answering.
- A WordPress plugin that pushes WooCommerce product changes to the bot server.
- A small storefront chat widget.

## Architecture

```text
WooCommerce product save/delete
  -> WordPress plugin signs and pushes payload
  -> Node bot server validates signature
  -> OpenAI embedding model creates vectors
  -> Supabase pgvector stores searchable product chunks
  -> Chat widget sends customer question
  -> Server semantic-searches products
  -> Codex answers with retrieved product context
```

## 1. Supabase Setup

Open the Supabase SQL editor and run:

```sql
-- See supabase/schema.sql
```

The schema enables `pgvector`, creates product/page vector tables, and adds the `match_product_documents` search function.

This prototype uses `text-embedding-3-small`, which returns 1536-dimensional vectors.

## 2. Bot Server Setup

Copy the environment file:

```bash
cp .env.example .env
```

Fill in:

```text
OPENAI_API_KEY
SUPABASE_URL
SUPABASE_SERVICE_ROLE_KEY
BIOLEC_SYNC_SECRET
WOOCOMMERCE_URL
WOOCOMMERCE_CONSUMER_KEY
WOOCOMMERCE_CONSUMER_SECRET
```

Install dependencies:

```bash
npm install
```

Run locally:

```bash
npm run dev
```

On Windows, you can also double-click:

```text
scripts/start-local-server.cmd
```

Health check:

```text
GET http://127.0.0.1:8787/health
```

## 3. WordPress Plugin Setup

Copy this folder into WordPress:

```text
wordpress-plugin/biolec-codex-bot
```

Destination:

```text
wp-content/plugins/biolec-codex-bot
```

Then in WordPress admin:

1. Activate **Bio Lec Codex Bot Sync**.
2. Open **Settings -> Bio Lec Codex Bot**.
3. Set **Bot server URL**, for example `https://bot.yourdomain.com`.
4. Set **Sync secret** to the same value as `BIOLEC_SYNC_SECRET`.
5. Enable product push sync.
6. Use **Test First Product Sync**.

## 4. Push Sync Security

Every WordPress sync request includes:

```text
X-Biolec-Timestamp
X-Biolec-Signature
```

The signature is:

```text
HMAC_SHA256(timestamp + "." + raw_json_body, BIOLEC_SYNC_SECRET)
```

The bot server rejects missing, expired, or invalid signatures.

## 5. Main Endpoints

```text
GET  /health
POST /wp-sync/product-upsert
POST /wp-sync/product-delete
POST /search/products
POST /chat
```

Example product search:

```json
{
  "query": "lightweight folding electric wheelchair for car boot",
  "matchCount": 6,
  "stockStatus": "instock"
}
```

Example chat request:

```json
{
  "session_id": "visitor-123",
  "message": "I need a folding wheelchair for travel"
}
```

## 6. Production Notes

Before launch:

- Deploy the Node server behind HTTPS.
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on the server.
- Keep `BIOLEC_SYNC_SECRET` long and private.
- Add a retry queue for failed WordPress syncs.
- Add live WooCommerce verification before final product recommendations.
- Add policy page sync for delivery, returns, VAT relief, and contact pages.
- Add verified order lookup only after order number + billing email match.

## 7. Next Build Steps

The next engineering pass should add:

- WordPress retry queue for failed sync events.
- Full reindex button.
- Policy page vector sync.
- Live WooCommerce product detail lookup.
- Verified order lookup.
- Human handoff/ticket creation.
- Admin chat transcript review.
