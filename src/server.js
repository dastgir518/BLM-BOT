import express from "express";
import cors from "cors";
import { config } from "./config.js";
import { verifyWordPressSignature } from "./security.js";
import { upsertProduct, deleteProduct, clearProducts } from "./product-sync.js";
import { upsertPage, deletePage, clearPages } from "./page-sync.js";
import { semanticProductSearch, semanticPageSearch } from "./search.js";
import { answerWithCodex } from "./codex-agent.js";
import { answerFast } from "./fast-agent.js";
import { checkSupabase } from "./health.js";

const app = express();

app.use(
  cors({
    origin: [config.publicSiteOrigin],
    credentials: true
  })
);

app.use(
  express.json({
    limit: "2mb",
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

app.post("/search/products", async (req, res, next) => {
  try {
    const results = await semanticProductSearch(req.body);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.post("/search/pages", async (req, res, next) => {
  try {
    const results = await semanticPageSearch(req.body);
    res.json({ results });
  } catch (error) {
    next(error);
  }
});

app.post("/chat", async (req, res, next) => {
  try {
    const { session_id: sessionId, message } = req.body;
    if (!message) {
      return res.status(400).json({ error: "message is required" });
    }

    const result = config.answerEngine === "fast"
      ? await answerFast({ message })
      : await answerWithCodex({ sessionId, message });
    return res.json(result);
  } catch (error) {
    next(error);
  }
});

app.use((error, _req, res, _next) => {
  console.error(error);
  res.status(500).json({
    error: "Internal server error",
    detail: process.env.NODE_ENV === "production" ? undefined : error.message
  });
});

app.listen(config.port, config.host, () => {
  console.log(`Bio Lec Codex bot server listening on http://${config.host}:${config.port}`);
});
