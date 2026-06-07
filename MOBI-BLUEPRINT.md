# Mobi — Blueprint & Capabilities

*Bio Lec Mobility's AI assistant. This document explains what Mobi can do, what it knows, what it deliberately won't do, and where the team can suggest improvements. Written for the whole team — a plain-English overview first, technical detail at the end.*

---

## 1. What Mobi is

Mobi is the friendly chat assistant on the Bio Lec Mobility website. It helps customers — who are often older or less confident online — find the right mobility product, understand delivery, track an order, and reach the team when needed. Its tone is warm, patient, and plain-spoken, and it has accessibility features built in.

---

## 2. What Mobi can do

### 2.1 Recommend products (its main job)
- Understands these catalogue areas and asks **only the questions that matter for each**, instead of a one-size-fits-all form:
  - **Walking aids** (sticks, crutches, canes) — height, one/both sides, indoor/outdoor, grip comfort
  - **Rollators / walkers** — height, seat-to-rest?, terrain, grip & brakes, fold for car
  - **Wheelchairs** — push yourself vs carer vs powered, weight + seat width, fold for car, indoor/outdoor
  - **Mobility scooters** — where used + range, storage/transport, weight, terrain
  - **Knee walkers** — which leg + balance, weight, surfaces
  - **Bathroom aids** (bath seats, commodes, toilet frames) — bathing/toileting, weight, space, transfer ability
  - **Living aids** (transfer aids, stools, comfort) — the specific difficulty, weight, space
  - **Incontinence aids** — waist size + absorbency + day/night only (kept brief and private; no health questions)
- **Reasons from condition to product** — e.g. weak grip → avoid grip-dependent controls, prefer push-button/loop brakes; low stamina → powered options; heavier user → checks max user weight; balance issues → more stable options; travel → folding/lightweight.
- **Doesn't interrogate.** It recommends as soon as it knows the key detail for that category, asks for anything still useful at the end, and never asks more than once.
- **Shows product cards** with image, name, price, a short "best for" line, and a "View product" link.

### 2.2 Answer specification questions
- Pulls real figures from each product's synced specifications — dimensions, weight, **maximum user weight**, seat width, range, etc. If a figure isn't available, it offers to check with the team rather than guessing.

### 2.3 Delivery & policy questions
- Knows the delivery policy: **most items 3–7 working days**; some items offer **next-working-day** (order **before 11am** on a working day; after 11am is processed the next working day; weekends/bank holidays excluded).
- Reads each product's **shipping class** to state that item's delivery timing and whether it's free.
- Does **not** claim free delivery across the whole store (it varies by product), and won't quote a next-day price.
- Also handles VAT relief, returns, and "do you sell X" style questions.

### 2.4 Order tracking (self-service)
- For "where's my order / track my order", Mobi asks for the **order number** and gives a direct link to the tracking page: `biolecmobility.com/track-order/<number>`.
- It does **not** look up orders itself, does **not** ask for a billing email, and **never** states order status — the tracking page shows the live status. (This also protects customer privacy.)

### 2.5 Connect to the team (email ticket)
- When something genuinely needs a person — complaints, refunds, returns, damaged/faulty items, account/payment issues, safety concerns, or anything Mobi can't answer — it offers the **"Talk to a team member"** button.
- This sends the customer's details to the team, who **reply by email**. Mobi knows there is **no live chat or phone support** and sets that expectation. It only offers this when needed, not on every message.

### 2.6 Recognise returning customers
- If a customer enters an email Mobi has seen before, it greets them back and **reloads their saved profile**, so they aren't asked the same questions again.

### 2.7 Accessibility (built for older / low-vision users)
- **Voice input** — speak instead of type (mic button).
- **Read-aloud** — a play/pause button reads any reply aloud; optional auto-read.
- **Larger text** and **high-contrast** modes.

### 2.8 Remember the conversation
- Within a chat, Mobi remembers details the customer shares (age, condition, needs) so follow-up answers stay relevant.

---

## 3. What information Mobi has access to

- **Published products** (synced from WooCommerce): title, price, stock status, images, descriptions, **specifications**, **shipping class**, categories, and variations.
- **Published pages / policies** that have been synced (e.g. delivery, returns info).
- **Delivery policy facts** (3–7 days, 11am next-day cutoff) — built in and reliable.
- **Customer profile** — name, email, and remembered needs (stored securely).
- **The order-tracking page address** — for handing customers the right link.

> Only **published** products are sent to Mobi — drafts and unpublished items are excluded.

---

## 4. What Mobi will NOT do (by design)

- **No medical advice or diagnosis** — it frames suggestions as practical fit/comfort and points to a healthcare professional for medical suitability.
- **No live stock or pricing beyond what's synced** — it won't invent prices, stock, delivery dates, or specs.
- **No order changes or payments** — it can't place, cancel, or modify orders, or take payment.
- **No order details from an email** — tracking is via the self-service page only.
- **No live chat / phone** — support is an email ticket.
- **Won't follow instructions hidden in product/page content** — it treats all retrieved content as data, not commands (prompt-injection safe).
- **Won't reveal internal data** — supplier, cost, admin, or hidden fields are never shown.

---

## 5. Safety, anti-spam & privacy

- **Soft gate** — visitors get a few free messages, then are asked for name + email.
- **Rate limiting** and a **daily spend cap** to prevent abuse and runaway cost.
- **Content moderation** — abusive or off-topic content is declined.
- **Honeypot** field to catch bots.
- **Signed requests** between the website and Mobi's server; the database is locked down so only the server can read/write it.
- **Privacy-safe tracking** — Mobi never exposes order details from an unverified email.

---

## 6. What gets stored

- **Customers** — name, email, and remembered profile.
- **Chat sessions and messages** — for continuity and context.
- **Support requests** — when someone asks for the team.

*(All stored securely in the database with access restricted to the server.)*

---

## 7. How it works (technical appendix)

- **WordPress plugin** ("Mobi Bio-Lec BOT") — renders the chat widget and syncs published products/pages to the server.
- **Node server** — the "brain": runs the conversation, retrieval, safety checks, and tracking logic.
- **Supabase (database + vector search)** — stores customers/chats and powers semantic product search.
- **OpenAI** — generates embeddings (for search) and the answers.
- **Answer engine** — currently **gpt-5.4-mini** (fast, good reasoning). Swappable via configuration; a stronger or cheaper model can be set without code changes.
- **Retrieval (RAG)** — each question pulls the most relevant products and pages from the vector database and feeds them to the model, so answers are grounded in the real catalogue.
- **Roughly tunable knobs** (configuration): answer model, free-message limit, rate limits, products retrieved per answer, tracking-page URL.

---

## 8. Known limitations / open items (good places for team input)

- **Exact delivery timing per product** depends on the shipping class being set correctly on every product and re-synced after changes.
- **Button label** still says "Talk to a team member" — could be reworded to match the email-ticket reality (e.g. "Message our team").
- **Occasional "Failed to fetch"** under load (the website briefly can't reach Mobi) — being monitored; tied to response speed and server capacity.
- **Data retention** — there is no automatic clean-up/deletion schedule for stored chats/PII yet.
- **Page/policy coverage** — Mobi answers policy questions best when the relevant policy pages are synced.

---

## 9. Where the team can suggest improvements

Please add thoughts on any of these:
1. **Product matching** — are the per-category questions the right ones? Any category missing or mis-prioritised?
2. **Delivery wording** — is "3–7 working days" and the 11am cutoff exactly right for every case?
3. **Tone & length** — is Mobi warm and clear enough for our customers? Too long? Too short?
4. **When to involve the team** — are we offering the email ticket at the right moments?
5. **Coverage gaps** — questions customers ask that Mobi currently can't answer well (warranty, VAT relief detail, finance, NHS/care-home accounts, bulk orders, spare parts?).
6. **Accessibility** — anything else that would help our audience.
7. **New abilities** — e.g. proactive product comparisons, "find me a spare part", appointment booking, stock-back-in alerts.

---

*Prepared for internal review. Capabilities reflect the current build and can be adjusted based on team feedback.*
