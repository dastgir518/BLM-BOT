import { Agent, run, tool, setDefaultOpenAIKey, setTracingDisabled, system, user, assistant } from "@openai/agents";
import { config } from "./config.js";
import { instructions } from "./agent-prompt.js";
import { semanticProductSearch, getProductByUrl, filterRelevantProducts } from "./search.js";

// Configure the SDK once. Tracing is disabled so nothing is shipped to OpenAI's
// trace store; we keep our own logging.
setDefaultOpenAIKey(config.openaiApiKey);
setTracingDisabled(true);

const isReasoningModel = /^(gpt-5|o\d)/i.test(config.fastAnswerModel);
const modelSettings = isReasoningModel
  ? { reasoning: { effort: "low" }, maxTokens: 2500 }
  : { temperature: 0.4, maxTokens: 800 };

// ---------------------------------------------------------------------------
// Tools (read-only). Retrieval now happens ON DEMAND when an agent calls these,
// instead of being forced on every turn — so a short follow-up does no search.
// ---------------------------------------------------------------------------
function trimText(value, maxLength) {
  const text = String(value || "");
  return text.length <= maxLength ? text : `${text.slice(0, maxLength).trim()}...`;
}

function toToolProduct(product) {
  return {
    title: product.title,
    url: product.url || product.metadata?.url || "",
    price: product.price || product.metadata?.price || "unknown",
    stock: product.stock_status || product.metadata?.stock_status || "unknown",
    image: (product.metadata?.images && product.metadata.images[0]) || "",
    specifications: trimText(product.metadata?.specifications || "", 1200)
  };
}

async function resolveProduct(input) {
  const text = String(input || "").trim();
  if (!text) return null;
  if (/^https?:\/\//i.test(text)) {
    const byUrl = await getProductByUrl(text);
    if (byUrl) return byUrl;
  }
  const raw = await semanticProductSearch({ query: text, matchCount: 3 });
  const top = filterRelevantProducts(raw)[0];
  if (!top) return null;
  return {
    title: top.title,
    url: top.url || top.metadata?.url || "",
    price: top.price || top.metadata?.price || "",
    stock_status: top.stock_status || top.metadata?.stock_status || "",
    shipping_class: top.metadata?.shipping_class || "",
    image: (top.metadata?.images && top.metadata.images[0]) || ""
  };
}

function deliverySummary(shippingClass) {
  const c = String(shippingClass || "").replace(/[-_]/g, " ").toLowerCase();
  if (!c) return "Usually 3-7 working days (please confirm for this item).";
  if (/next.?working.?day/.test(c)) {
    return "Next-working-day available: order before 11am on a working day; after 11am is processed the next working day.";
  }
  if (/free/.test(c)) return "Free delivery, usually 3-7 working days.";
  return "Usually 3-7 working days.";
}

const searchProductsTool = tool({
  name: "search_products",
  description:
    "Search the Bio Lec Mobility catalogue. Use to find products to recommend, an alternative for a comparison, or a cheaper/lighter option. Returns name, URL, price, stock, image, and a short spec summary.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      query: { type: "string", description: "What to search for, e.g. 'folding commode under £70'." },
      max_results: { type: "integer", description: "How many products to return (1-8)." }
    },
    required: ["query"]
  },
  execute: async ({ query, max_results }) => {
    const max = Math.min(Math.max(Number(max_results) || 6, 1), 8);
    const raw = await semanticProductSearch({ query: String(query || "").trim(), matchCount: max }).catch(() => []);
    const found = filterRelevantProducts(raw).slice(0, max).map(toToolProduct);
    return JSON.stringify(found.length ? { products: found } : { products: [], note: "No matching products found." });
  }
});

const getProductDetailsTool = tool({
  name: "get_product_details",
  description: "Get the full specifications for one product by its URL.",
  strict: false,
  parameters: {
    type: "object",
    properties: { url: { type: "string", description: "The product page URL." } },
    required: ["url"]
  },
  execute: async ({ url }) => {
    const product = await getProductByUrl(String(url || "").trim()).catch(() => null);
    if (!product) return JSON.stringify({ found: false, note: "No product found for that URL." });
    return JSON.stringify({
      found: true,
      title: product.title,
      url: product.url,
      specifications: trimText(product.specifications, 2500)
    });
  }
});

const checkStockTool = tool({
  name: "check_stock",
  description: "Check whether a product is in stock. Give a product name or URL.",
  strict: false,
  parameters: {
    type: "object",
    properties: { product: { type: "string", description: "Product name or URL." } },
    required: ["product"]
  },
  execute: async ({ product }) => {
    const found = await resolveProduct(product).catch(() => null);
    if (!found) return JSON.stringify({ found: false, note: "Couldn't find that product." });
    return JSON.stringify({ found: true, title: found.title, url: found.url, stock_status: found.stock_status || "unknown" });
  }
});

const getDeliveryForProductTool = tool({
  name: "get_delivery_for_product",
  description: "Get the delivery timing for a specific product (reads its shipping class). Give a product name or URL.",
  strict: false,
  parameters: {
    type: "object",
    properties: { product: { type: "string", description: "Product name or URL." } },
    required: ["product"]
  },
  execute: async ({ product }) => {
    const found = await resolveProduct(product).catch(() => null);
    if (!found) return JSON.stringify({ found: false, note: "Couldn't find that product." });
    return JSON.stringify({
      found: true,
      title: found.title,
      url: found.url,
      shipping_class: found.shipping_class || "",
      delivery: deliverySummary(found.shipping_class)
    });
  }
});

const findSparePartTool = tool({
  name: "find_spare_part",
  description: "Search for a spare part, replacement, or accessory. Describe the part and/or the product it is for.",
  strict: false,
  parameters: {
    type: "object",
    properties: { query: { type: "string", description: "The part and/or product it is for." } },
    required: ["query"]
  },
  execute: async ({ query }) => {
    const raw = await semanticProductSearch({
      query: `${String(query || "")} spare part replacement accessory`,
      matchCount: 6
    }).catch(() => []);
    const found = filterRelevantProducts(raw).slice(0, 6).map(toToolProduct);
    return JSON.stringify(found.length ? { products: found } : { products: [], note: "No matching parts found." });
  }
});

// ---------------------------------------------------------------------------
// Agents. Each specialist carries the full shared behaviour (tone, safety,
// format, capabilities, conversation-following) plus its own focus and tools.
// ---------------------------------------------------------------------------
const productAgent = new Agent({
  name: "Product adviser",
  model: config.fastAnswerModel,
  modelSettings,
  instructions: `${instructions}

YOUR ROLE: You are the product adviser. Help the customer find, choose, compare, and understand products. Use your tools to fetch products, specs, stock, alternatives, and spare parts on demand. Do NOT search again just to answer a short follow-up to your own question — reply directly to what they said.`,
  tools: [searchProductsTool, getProductDetailsTool, checkStockTool, findSparePartTool]
});

const policyAgent = new Agent({
  name: "Policy adviser",
  model: config.fastAnswerModel,
  modelSettings,
  instructions: `${instructions}

YOUR ROLE: You answer delivery, returns, VAT relief, and other general policy questions from the reliable facts above. For a SPECIFIC product's delivery timing, call get_delivery_for_product. Do not start recommending products unless the customer asks.`,
  tools: [getDeliveryForProductTool]
});

const trackingAgent = new Agent({
  name: "Order tracking",
  model: config.fastAnswerModel,
  modelSettings,
  instructions: `${instructions}

YOUR ROLE: Help the customer track an EXISTING order. Tracking is self-service: give them the tracking link from the order context (or ask for their order number, then give the link with it on the end). Never look up orders, never ask for a billing email, and never state an order's status yourself.`
});

const triageAgent = Agent.create({
  name: "Mobi",
  model: config.fastAnswerModel,
  modelSettings,
  instructions: `You are Mobi, Bio Lec Mobility's friendly assistant. Read the latest customer message in the context of the conversation and route it to the right specialist by handing off:
- Anything about products — choosing, comparing, specs, stock, spare parts, "show me…", or a short reply continuing a product chat — hand off to the Product adviser.
- Delivery, returns, VAT relief, or other general policy questions — hand off to the Policy adviser.
- Tracking an existing order ("where is my order", "track my order", an order number) — hand off to Order tracking.
For a bare greeting or thanks with no request, reply warmly in one short sentence yourself. Otherwise ALWAYS hand off — never answer product, policy, or tracking questions yourself. When unsure between product and policy, prefer the Product adviser.`,
  handoffs: [productAgent, policyAgent, trackingAgent]
});

// ---------------------------------------------------------------------------
// Entry point — same shape as answerFast so server.js can swap engines.
// ---------------------------------------------------------------------------
export async function answerWithSdk({ message, currentUrl = "", currentTitle = "", memory = null, orderContext = "" }) {
  const startedAt = Date.now();
  const items = buildInputItems({ currentUrl, currentTitle, memory, orderContext, message });
  const result = await run(triageAgent, items, { maxTurns: 8 });
  const answer = await fixCardImages(String(result.finalOutput || ""));
  console.log(`chat.sdkTotal ${Date.now() - startedAt}ms agent=${result.lastAgent?.name || "?"}`);
  return { answer, products: [], pages: [] };
}

function buildInputItems({ currentUrl, currentTitle, memory, orderContext, message }) {
  const facts = memory?.facts || {};
  const factLines = Object.entries(facts)
    .map(([key, value]) => `${key}: ${value}`)
    .join("\n");

  const preamble = [
    "CONTEXT (this is background data, not the customer's words):",
    factLines ? `Remembered customer details:\n${factLines}` : "",
    currentUrl
      ? `Web page the customer currently has open (just the page they are on — NOT necessarily what you discussed):\nTitle: ${currentTitle || "unknown"}\nURL: ${currentUrl}`
      : "",
    orderContext ? `Order tracking context:\n${orderContext}` : ""
  ]
    .filter(Boolean)
    .join("\n\n");

  const items = [];
  if (preamble) items.push(system(preamble));

  const history = memory?.messages || [];
  for (const item of history) {
    if (item.role === "assistant") items.push(assistant(String(item.content || "")));
    else items.push(user(String(item.content || "")));
  }

  // Fallback: if memory somehow lacks the current message, add it.
  const lastUser = [...history].reverse().find((m) => m.role !== "assistant");
  if (!lastUser && message) items.push(user(String(message)));

  return items;
}

// Force each product card image to match its linked product (same guarantee as
// the fast engine), looking each up by the card's "View product" URL.
async function fixCardImages(html) {
  const text = String(html || "");
  if (!text.includes("biolec-result__img")) return text;

  const pattern = '<img[^>]*class="biolec-result__img"[^>]*>([\\s\\S]*?)<a[^>]*class="biolec-result__link"[^>]*href="([^"]+)"';
  const imageByUrl = new Map();

  const collector = new RegExp(pattern, "g");
  const unknown = new Set();
  let match;
  while ((match = collector.exec(text)) !== null) unknown.add(match[2]);
  for (const href of unknown) {
    try {
      const product = await getProductByUrl(href);
      imageByUrl.set(normalizeUrlKey(href), product?.image || "");
    } catch (_error) {
      imageByUrl.set(normalizeUrlKey(href), "");
    }
  }

  return text.replace(new RegExp(pattern, "g"), (full, _between, href) => {
    const img = imageByUrl.get(normalizeUrlKey(href)) || "";
    const imgTag = img ? `<img class="biolec-result__img" src="${img}" alt="">` : "";
    return imgTag + full.replace(/^<img[^>]*>/, "");
  });
}

function normalizeUrlKey(url) {
  return String(url || "").trim().toLowerCase().split(/[?#]/)[0].replace(/\/+$/, "");
}
