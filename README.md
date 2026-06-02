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
POST /chat/register
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

## 6. Chat Access and Abuse Protection

The chat uses a **soft gate**: a visitor can send a few messages with no email
(`FREE_MESSAGE_LIMIT`, default 3), after which the widget asks for a name and
email to continue. Anonymous messages are stored against the session and linked
to the customer once they register, so nothing is lost.

Because each message costs an OpenAI call, the bot server protects itself with:

- **HMAC-signed proxy** – `/chat` and `/chat/register` only accept requests that
  came through the WordPress proxy, signed with `BIOLEC_SYNC_SECRET` (same scheme
  as product sync). Set `CHAT_REQUIRE_SIGNATURE=false` for local dev only.
- **Rate limiting** – per client IP (`RATE_LIMIT_PER_MIN`, `RATE_LIMIT_PER_DAY`)
  and per session (`SESSION_RATE_LIMIT_PER_MIN`); returns `429` with `Retry-After`.
- **Daily spend circuit-breaker** – `DAILY_ANSWER_LIMIT` caps answer generations
  per day; over the cap the bot returns a graceful high-demand message.
- **Honeypot field** – a hidden form input; submissions that fill it are silently
  discarded with no OpenAI call.
- **Message hygiene** – length cap (`MAX_MESSAGE_LENGTH`) and a duplicate-resend
  guard.
- **Moderation** – a free OpenAI moderation pre-check (`MODERATION_ENABLED`) drops
  abusive messages before the expensive answer call.

Rate-limit and spend state are in-memory (single instance). For multi-instance
deployments, back them with Redis or a shared store.

### Returning customers and "New chat"

When a known email registers again, the bot greets them by name
("Welcome back, …") and **reloads their saved profile** (age, weight, mobility
condition, preferences) from `chat_customers.profile` into the conversation so it
remembers their details without re-asking. The profile is loaded once per
session. Note the email is **self-entered and not verified**, so anyone entering
a customer's email will see that customer's saved details surfaced in chat; order
details still require the in-chat verification (order number + billing-email
match).

Clicking **New chat** asks for confirmation, then starts a fresh thread while
**keeping** the customer's name/email — they stay identified (no re-gate) and are
greeted back. A new `chat_sessions` row is created and linked to the same
customer.

### Human handoff / callback

A **"Talk to a team member"** button is always available in the widget, and the
bot also offers it when it detects a customer wants a person ("speak to someone",
"call me", etc.). Submitting the handoff form emails your team via WordPress
`wp_mail` with the conversation and the customer's details, and sets **Reply-To
to the customer** so the team can reply straight from their inbox. Each handoff
is also recorded in `support_handoffs` (name, email, phone, reason, transcript,
status `new`).

Set the recipient under **Settings → Bio Lec AI Bot → Support team email**
(comma-separated addresses allowed; defaults to the site admin email). Delivery
relies on the site's existing email setup — use an SMTP plugin if the host's PHP
mail is unreliable.

## 7. Production Notes

Before launch:

- Deploy the Node server behind HTTPS.
- Keep `SUPABASE_SERVICE_ROLE_KEY` only on the server.
- Keep `BIOLEC_SYNC_SECRET` long and private.
- Add a retry queue for failed WordPress syncs.
- Add live WooCommerce verification before final product recommendations.
- Add policy page sync for delivery, returns, VAT relief, and contact pages.
- Add verified order lookup only after order number + billing email match.

## 8. Product Specifications and Customer Profiling

The bot reads product specifications from the indexed `specifications` blob
(attributes + dimensions + weight + the `table-box` spec field). Spec fields are
indexed with a large budget so full spec tables are retained, and the agent is
told to answer spec questions from that section (or offer to check with the team
if a figure is missing). When a customer is on a product page, that product's
specs are fetched directly by URL so direct questions are answered reliably.

> **After deploying spec changes, run "Clear & Reindex Catalog" once** in the
> admin so existing products are re-chunked with the larger spec budget. New and
> edited products pick it up automatically via push sync.

Customer details (age, weight, condition, mobility needs) are extracted from each
message by a cheap LLM call (`FACT_MODEL`, defaults to `FAST_ANSWER_MODEL`; set
`FACT_EXTRACTION_ENABLED=false` to disable), with the regex extractor as a
fallback. Extracted facts feed the conversation memory and `chat_customers.profile`.

## 9. Accessibility

The chat widget includes free, browser-native accessibility aids (no API cost):

- **Voice input** — a mic button (Web Speech `SpeechRecognition`) for dictating
  messages, shown only where the browser supports it (Chrome/Edge/Safari).
- **Read-aloud** — a speaker button on every reply, plus an "Read replies aloud"
  toggle that auto-speaks new answers (`SpeechSynthesis`).
- **Larger text** and **High contrast** toggles, remembered across visits.

These live behind the header **"Aa"** button (display toggles) and inline (mic,
speaker). They are entirely client-side — no server or configuration changes.

## 10. Next Build Steps

The next engineering pass should add:

- WordPress retry queue for failed sync events.
- Full reindex button.
- Policy page vector sync.
- Live WooCommerce product detail lookup.
- Verified order lookup.
- Human handoff/ticket creation.
- Admin chat transcript review.
