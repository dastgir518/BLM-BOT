import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { semanticPageSearch, semanticProductSearch, getProductByUrl, filterRelevantProducts } from "./search.js";
import { config } from "./config.js";
import { instructions } from "./agent-prompt.js";

let codex = null;

// Run Codex in an empty, isolated temp directory rather than the app source
// tree, so a prompt injection in retrieved content cannot read project files.
const CODEX_WORKDIR = path.join(os.tmpdir(), "biolec-codex-sandbox");
try {
  fs.mkdirSync(CODEX_WORKDIR, { recursive: true });
} catch (_error) {
  // best effort; Codex will fall back to its default if this fails
}

// Codex conversation threads, one per chat session. Bounded by a 1-hour idle
// TTL (matching session-memory) plus a hard cap, so the map cannot grow without
// limit as new visitors arrive.
const THREAD_TTL_MS = 60 * 60 * 1000;
const MAX_THREADS = 1000;
const sessions = new Map();

async function getCodex() {
  if (!codex) {
    const { Codex } = await import("@openai/codex-sdk");
    const codexPath = resolveCodexPath();
    codex = new Codex(codexPath ? { codexPathOverride: codexPath } : undefined);
  }

  return codex;
}

function resolveCodexPath() {
  if (config.codexPath && fs.existsSync(config.codexPath)) {
    return config.codexPath;
  }

  const globalWindowsPath = path.join(
    process.env.APPDATA || "",
    "npm",
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "codex",
    "codex.exe"
  );

  if (process.platform === "win32" && fs.existsSync(globalWindowsPath)) {
    return globalWindowsPath;
  }

  const localWindowsPath = path.resolve(
    "node_modules",
    "@openai",
    "codex",
    "node_modules",
    "@openai",
    "codex-win32-x64",
    "vendor",
    "x86_64-pc-windows-msvc",
    "codex",
    "codex.exe"
  );

  if (process.platform === "win32" && fs.existsSync(localWindowsPath)) {
    return localWindowsPath;
  }

  return "";
}

function pruneThreads() {
  const now = Date.now();
  for (const [key, entry] of sessions) {
    if (now - entry.updatedAt > THREAD_TTL_MS) sessions.delete(key);
  }
  // Hard ceiling: evict the least-recently-used (oldest in insertion order).
  while (sessions.size > MAX_THREADS) {
    const oldest = sessions.keys().next().value;
    sessions.delete(oldest);
  }
}

// Return the session's Codex thread, creating it on first use. Reused threads
// are refreshed and moved to the most-recent position (LRU).
function getOrCreateThread(sessionId, codexClient) {
  const key = sessionId || "anonymous";
  pruneThreads();

  const existing = sessions.get(key);
  if (existing) {
    existing.updatedAt = Date.now();
    sessions.delete(key);
    sessions.set(key, existing);
    return existing.thread;
  }

  const thread = codexClient.startThread({
    workingDirectory: CODEX_WORKDIR,
    skipGitRepoCheck: true,
    sandboxMode: "read-only",
    networkAccessEnabled: false,
    approvalPolicy: "never"
  });
  sessions.set(key, { thread, updatedAt: Date.now() });
  return thread;
}

export async function answerWithCodex({ sessionId, message, currentUrl = "", currentTitle = "", memory = null, orderContext = "" }) {
  const startedAt = Date.now();
  const retrievalQuery = buildRetrievalQuery({ message, currentUrl, currentTitle, memory });
  const [rawProducts, pages, viewedProduct] = await Promise.all([
    timed("productSearch", () => semanticProductSearch({ query: retrievalQuery, matchCount: 12 }).catch(() => [])),
    timed("pageSearch", () => semanticPageSearch({ query: retrievalQuery, matchCount: 3 }).catch(() => [])),
    currentUrl ? getProductByUrl(currentUrl).catch(() => null) : Promise.resolve(null)
  ]);

  const products = filterRelevantProducts(rawProducts);

  const productContext = products
    .map((product, index) => {
      return [
        `Result ${index + 1}: ${product.title}`,
        `URL: ${product.url || product.metadata?.url || ""}`,
        `Stock: ${product.metadata?.stock_status || product.stock_status || "unknown"}`,
        `Price: ${product.metadata?.price || "unknown"}`,
        `Image: ${(product.metadata?.images && product.metadata.images[0]) || ""}`,
        `Similarity: ${product.similarity}`,
        formatProductMetadata(product),
        trimContext(product.content, 2000)
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const pageContext = pages
    .map((page, index) => {
      return [
        `Page result ${index + 1}: ${page.title}`,
        `URL: ${page.url || page.metadata?.url || ""}`,
        `Similarity: ${page.similarity}`,
        trimContext(page.content, 700)
      ].join("\n");
    })
    .join("\n\n---\n\n");

  const viewedProductContext = viewedProduct && viewedProduct.specifications
    ? `Specifications for the product the customer is viewing (${viewedProduct.title}):\n${trimContext(viewedProduct.specifications, 3000)}`
    : "";

  const prompt = [
    instructions,
    currentUrl ? `Customer is currently viewing:\nTitle: ${currentTitle || "unknown"}\nURL: ${currentUrl}` : "",
    formatMemory(memory),
    orderContext ? `WooCommerce order context:\n${orderContext}` : "",
    viewedProductContext,
    productContext ? `Relevant product knowledge:\n${productContext}` : "No product context was retrieved.",
    pageContext ? `Relevant policy/page knowledge:\n${pageContext}` : "No policy/page context was retrieved.",
    `Customer message:\n${message}`
  ].join("\n\n");

  const codexClient = await getCodex();
  const thread = getOrCreateThread(sessionId, codexClient);
  const result = await timed("codexRun", () => thread.run(prompt));
  console.log(`chat.total ${Date.now() - startedAt}ms`);

  return {
    answer: typeof result === "string"
      ? result
      : result?.finalResponse || result?.text || result?.output_text || String(result),
    products,
    pages
  };
}

async function timed(label, callback) {
  const startedAt = Date.now();
  try {
    return await callback();
  } finally {
    console.log(`chat.${label} ${Date.now() - startedAt}ms`);
  }
}

function trimContext(value, maxLength) {
  const text = String(value || "");
  if (text.length <= maxLength) return text;
  return `${text.slice(0, maxLength).trim()}...`;
}

function buildRetrievalQuery({ message, currentUrl, currentTitle, memory }) {
  // Include the last couple of customer turns and key need-facts so follow-ups
  // ("is there a lighter one?") still retrieve on the original topic.
  const customerTurns = (memory?.messages || [])
    .filter((item) => item.role === "customer")
    .map((item) => item.content);
  const recent = customerTurns.length ? customerTurns.slice(-2) : [message];
  const facts = memory?.facts || {};
  const needFacts = ["condition", "mobility_needs", "use_area", "transport", "weight"]
    .map((key) => facts[key])
    .filter(Boolean);
  // For short/affirmative follow-ups ("yes", "yes please") the customer's words
  // carry no product signal, so fold in the last assistant turn (e.g. an offer
  // to compare with a cheaper model), stripped of HTML, so retrieval can surface
  // the alternative product that was proposed instead of just the same one.
  const lastAssistant = [...(memory?.messages || [])].reverse().find((item) => item.role === "assistant");
  const isShortFollowUp = String(message).trim().split(/\s+/).length <= 4;
  const assistantHint = isShortFollowUp && lastAssistant ? stripHtml(lastAssistant.content).slice(0, 400) : "";
  return [...recent, assistantHint, ...needFacts, currentTitle, currentUrl].filter(Boolean).join("\n");
}

function stripHtml(value = "") {
  return String(value).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function formatProductMetadata(product) {
  // Preferred: the full specifications blob built at index time.
  const specifications = product.metadata?.specifications;
  if (specifications) {
    return `Specifications:\n${trimContext(specifications, 3000)}`;
  }

  // Fallback for rows indexed before the specifications blob existed.
  const rawMeta = product.metadata?.raw_meta || {};
  const metaData = Array.isArray(product.metadata?.meta_data) ? product.metadata.meta_data : [];
  const lines = [];

  for (const key of ["table-box", "product_faq_html", "custom_category_field"]) {
    if (rawMeta[key]) {
      lines.push(`${key}: ${trimContext(rawMeta[key], 2000)}`);
    }
  }

  const usefulMeta = metaData
    .filter((item) => ["table-box", "product_faq_html", "custom_category_field"].includes(item.key))
    .map((item) => `${item.key}: ${trimContext(item.value, 2000)}`);

  lines.push(...usefulMeta);
  return lines.length ? `Useful product details:\n${lines.join("\n")}` : "";
}

function formatMemory(memory) {
  if (!memory) return "";

  const turnCount = Number(memory.customerTurns || 0);
  const facts = Object.entries(memory.facts || {})
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");
  const messages = (memory.messages || [])
    .slice(-6)
    .map((item) => `${item.role}: ${trimContext(item.content, 350)}`)
    .join("\n");

  return [
    `Customer turn count in this chat: ${turnCount}`,
    facts ? `Remembered customer details:\n${facts}` : "",
    messages ? `Recent conversation:\n${messages}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");
}
