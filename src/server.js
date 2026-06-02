import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { verifyWordPressSignature } from "./security.js";
import { upsertProduct, deleteProduct, clearProducts } from "./product-sync.js";
import { upsertPage, deletePage, clearPages } from "./page-sync.js";
import { answerWithCodex } from "./codex-agent.js";
import { answerFast } from "./fast-agent.js";
import { saveChatMessage, startChatSession, upsertAnonymousSession, isValidCustomer, getCustomerByEmail, saveCustomerProfile, saveSupportHandoff } from "./chat-store.js";
import { checkSupabase } from "./health.js";
import { buildOrderContext } from "./order-lookup.js";
import { getSessionMemory, rememberAssistantMessage, rememberCustomer, rememberUserMessage, rememberFacts, isProfileLoaded, markProfileLoaded } from "./session-memory.js";
import { extractCustomerFacts } from "./fact-extraction.js";
import { rateLimit } from "./rate-limit.js";
import { isOverDailyLimit, recordAnswer } from "./usage-guard.js";
import { isFlagged } from "./moderation.js";

const app = express();

app.use(
  cors({
    origin: [config.publicSiteOrigin],
    credentials: true
  })
);

app.use(
  express.json({
    limit: "10mb",
    verify: (req, _res, buf) => {
      req.rawBody = buf.toString("utf8");
    }
  })
);

app.get("/health", (_req, res) => {
  res.json({ ok: true });
});

app.get("/health/supabase", async (_req, res, next) => {
  try {
    const result = await checkSupabase();
    res.status(result.ok ? 200 : 500).json(result);
  } catch (error) {
    next(error);
  }
});

app.get("/health/chat", async (_req, res) => {
  res.json({
    ok: true,
    answerEngine: config.answerEngine,
    embeddingModel: config.embeddingModel,
    codexPathSet: Boolean(config.codexPath),
    fastAnswerModel: config.fastAnswerModel
  });
});

app.post("/wp-sync/product-upsert", verifyWordPressSignature, async (req, res, next) => {
  try {
    const result = await upsertProduct(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    console.error(`product sync failed product_id=${req.body?.product_id || "unknown"}`);
    next(error);
  }
});

app.post("/wp-sync/product-delete", verifyWordPressSignature, async (req, res, next) => {
  try {
    const result = await deleteProduct(req.body.product_id);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/wp-sync/products-clear", verifyWordPressSignature, async (_req, res, next) => {
  try {
    const result = await clearProducts();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/wp-sync/page-upsert", verifyWordPressSignature, async (req, res, next) => {
  try {
    const result = await upsertPage(req.body);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/wp-sync/page-delete", verifyWordPressSignature, async (req, res, next) => {
  try {
    const result = await deletePage(req.body.page_id);
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

app.post("/wp-sync/pages-clear", verifyWordPressSignature, async (_req, res, next) => {
  try {
    const result = await clearPages();
    res.json({ ok: true, ...result });
  } catch (error) {
    next(error);
  }
});

// Only accept chat traffic that came through the signed WordPress proxy. This
// removes the direct-to-Node attack path and makes the forwarded client IP
// trustworthy. Toggle off (CHAT_REQUIRE_SIGNATURE=false) for local dev.
function chatSignature(req, res, next) {
  if (!config.requireChatSignature) return next();
  return verifyWordPressSignature(req, res, next);
}

const MODERATION_REFUSAL =
  "<p>I'm sorry, but I can't help with that. If you have a question about our mobility products, delivery, or an order, I'm happy to help.</p>";
const HIGH_DEMAND_REPLY =
  "<p>We're experiencing very high demand right now, so I can't reply this moment. Please try again shortly, or contact Bio Lec Mobility directly and the team will be glad to help.</p>";
const DUPLICATE_REPLY =
  "<p>It looks like that was just sent. Could you add a little more detail so I can help you better?</p>";

function escapeHtml(value) {
  return String(value || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

const HANDOFF_INTENT_PATTERN =
  /\b(speak|talk|chat|connect)\s+(to|with)\s+(a\s+|an\s+|the\s+)?(human|person|someone|agent|advisor|adviser|representative|rep|staff|team|member|consultant|operator|assistant)\b|\b(real\s+person|human\s+being|call\s+me|phone\s+me|ring\s+me|customer\s+service|customer\s+support|complaint|make\s+a\s+complaint)\b/i;

function detectHandoffIntent(message) {
  return HANDOFF_INTENT_PATTERN.test(String(message || ""));
}

app.post("/chat/register", chatSignature, rateLimit, async (req, res, next) => {
  try {
    const {
      session_id: sessionId,
      current_url: currentUrl,
      current_title: currentTitle,
      customer_name: customerName,
      customer_email: customerEmail,
      hp_field: honeypot
    } = req.body;

    // Honeypot: only bots fill this hidden field. Pretend success, do no work.
    if (honeypot) {
      return res.json({ ok: true });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "session_id is required" });
    }
    if (!isValidCustomer(customerName, customerEmail)) {
      return res.status(400).json({ error: "A valid name and email are required to start chat" });
    }

    // Recognise a returning customer by email and reload their saved profile so
    // the bot remembers their details without re-asking.
    const existing = await getCustomerByEmail(customerEmail).catch(() => null);
    const returning = Boolean(existing);

    await startChatSession({ sessionId, name: customerName, email: customerEmail, currentUrl, currentTitle });
    rememberCustomer(sessionId, { name: customerName, email: customerEmail });
    if (existing?.profile) rememberFacts(sessionId, existing.profile);
    markProfileLoaded(sessionId);

    const greeting = returning
      ? `<p>Welcome back, ${escapeHtml(customerName.trim())}! Lovely to see you again. How can I help today?</p>`
      : null;
    return res.json({ ok: true, returning, greeting });
  } catch (error) {
    next(error);
  }
});

// Record a human-handoff request. WordPress sends the actual email to the team;
// this endpoint persists the audit row in support_handoffs.
app.post("/handoff", chatSignature, rateLimit, async (req, res, next) => {
  try {
    const {
      session_id: sessionId,
      customer_name: customerName,
      customer_email: customerEmail,
      phone,
      message,
      transcript,
      hp_field: honeypot
    } = req.body;

    if (honeypot) {
      return res.json({ ok: true });
    }
    if (!isValidCustomer(customerName, customerEmail)) {
      return res.status(400).json({ error: "A valid name and email are required" });
    }

    await saveSupportHandoff({
      sessionId,
      name: customerName,
      email: customerEmail,
      phone,
      reason: message,
      transcript
    });
    return res.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/chat", chatSignature, rateLimit, async (req, res, next) => {
  try {
    const {
      session_id: sessionId,
      message,
      current_url: currentUrl,
      current_title: currentTitle,
      customer_name: customerName,
      customer_email: customerEmail,
      hp_field: honeypot
    } = req.body;

    // Honeypot: silently accept and discard bot submissions (no OpenAI spend).
    if (honeypot) {
      return res.json({ answer: "<p>Thanks, your message has been received.</p>" });
    }
    if (!sessionId) {
      return res.status(400).json({ error: "session_id is required" });
    }

    const trimmed = String(message || "").trim();
    if (!trimmed) {
      return res.status(400).json({ error: "message is required" });
    }
    if (trimmed.length > config.maxMessageLength) {
      return res.status(400).json({ error: "Your message is too long. Please shorten it and try again." });
    }

    const hasEmail = isValidCustomer(customerName, customerEmail);
    const priorMemory = getSessionMemory(sessionId);

    // Soft gate: anonymous visitors get a few free messages, then must register.
    // Returns before any OpenAI call so the gate is free to enforce.
    if (!hasEmail && priorMemory.customerTurns >= config.freeMessageLimit) {
      return res.json({ require_email: true });
    }

    // Cheap duplicate guard: do not re-bill OpenAI for an identical resend.
    const lastCustomer = [...priorMemory.messages].reverse().find((item) => item.role === "customer");
    if (lastCustomer && lastCustomer.content.trim() === trimmed) {
      return res.json({ answer: DUPLICATE_REPLY });
    }

    let customerId = null;
    if (hasEmail) {
      customerId = await startChatSession({ sessionId, name: customerName, email: customerEmail, currentUrl, currentTitle });
      rememberCustomer(sessionId, { name: customerName, email: customerEmail });
      // Reload the saved profile once per session (covers paths that skip
      // /chat/register, e.g. an already-identified visitor after a restart).
      if (!isProfileLoaded(sessionId)) {
        const existing = await getCustomerByEmail(customerEmail).catch(() => null);
        if (existing?.profile) rememberFacts(sessionId, existing.profile);
        markProfileLoaded(sessionId);
      }
    } else {
      await upsertAnonymousSession({ sessionId, currentUrl, currentTitle });
    }

    rememberUserMessage(sessionId, trimmed);
    const memory = getSessionMemory(sessionId);
    await saveChatMessage({
      sessionId,
      role: "user",
      content: trimmed,
      metadata: { current_url: currentUrl || null, current_title: currentTitle || null }
    });

    // Moderation pre-check (free) before the expensive answer call.
    if (await isFlagged(trimmed)) {
      rememberAssistantMessage(sessionId, MODERATION_REFUSAL);
      await saveChatMessage({ sessionId, role: "assistant", content: MODERATION_REFUSAL, metadata: { moderated: true } });
      return res.json({ answer: MODERATION_REFUSAL });
    }

    // Daily spend circuit-breaker.
    if (isOverDailyLimit()) {
      await saveChatMessage({ sessionId, role: "assistant", content: HIGH_DEMAND_REPLY, metadata: { rate_limited: true } });
      return res.json({ answer: HIGH_DEMAND_REPLY });
    }

    // Extract structured facts (LLM) in parallel with the order lookup, then
    // merge them so the answer engine sees an enriched profile.
    const [extractedFacts, orderContext] = await Promise.all([
      extractCustomerFacts(trimmed).catch(() => ({})),
      buildOrderContext({ message: trimmed, memory }).catch((error) => {
        console.error("order lookup failed");
        console.error(error);
        return "Order lookup status: lookup_error\nSay you could not check the order just now and offer to connect the customer with Bio Lec Mobility.";
      })
    ]);
    rememberFacts(sessionId, extractedFacts);
    const enrichedMemory = getSessionMemory(sessionId);
    const result = config.answerEngine === "fast"
      ? await answerFast({ message: trimmed, currentUrl, currentTitle, memory: enrichedMemory, orderContext })
      : await answerWithCodexFallback({ sessionId, message: trimmed, currentUrl, currentTitle, memory: enrichedMemory, orderContext });
    recordAnswer();
    rememberAssistantMessage(sessionId, result.answer);
    await saveChatMessage({
      sessionId,
      role: "assistant",
      content: result.answer,
      metadata: {
        answer_engine: config.answerEngine,
        answer_engine_fallback: result.answer_engine_fallback || null
      }
    });

    // Best-effort: snapshot the learned facts to the customer profile. Never let
    // a storage hiccup break the reply that was already generated.
    if (customerId) {
      saveCustomerProfile({ customerId, profile: getSessionMemory(sessionId).facts }).catch((error) => {
        console.error("profile save failed");
        console.error(error);
      });
    }

    // Nudge the widget to surface the "Talk to a team member" option when the
    // customer seems to want a person.
    if (detectHandoffIntent(trimmed)) {
      result.offer_handoff = true;
    }
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

async function answerWithCodexFallback({ sessionId, message, currentUrl, currentTitle, memory, orderContext }) {
  try {
    return await answerWithCodex({ sessionId, message, currentUrl, currentTitle, memory, orderContext });
  } catch (error) {
    console.error("codex answer failed; falling back to fast answer");
    console.error(error);
    const result = await answerFast({ message, currentUrl, currentTitle, memory, orderContext });
    return {
      ...result,
      answer_engine_fallback: "fast"
    };
  }
}

app.use((error, _req, res, _next) => {
  console.error(error);
  const status = error.status || error.statusCode || 500;
  res.status(status).json({
    error: status === 500 ? "Internal server error" : error.message,
    detail: process.env.NODE_ENV === "production" ? undefined : error.message
  });
});

app.listen(config.port, config.host, () => {
  console.log(`Bio Lec Codex bot server listening on http://${config.host}:${config.port}`);
});
