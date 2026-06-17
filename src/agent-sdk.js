import { Agent, run, tool, setDefaultOpenAIKey, setTracingDisabled, system, user, assistant } from "@openai/agents";
import { config } from "./config.js";
import { productInstructions, policyInstructions, trackingInstructions } from "./agent-prompt.js";
import { semanticProductSearch, getProductByUrl, filterRelevantProducts } from "./search.js";

// Configure the SDK once. Tracing is disabled so nothing is shipped to OpenAI's
// trace store; we keep our own logging.
setDefaultOpenAIKey(config.openaiApiKey);
setTracingDisabled(true);

function settingsForModel(model) {
  return /^(gpt-5|o\d)/i.test(model)
    ? { reasoning: { effort: "low" }, maxTokens: 2500 }
    : { temperature: 0.4, maxTokens: 800 };
}

// Specialists answer with the main model; triage routes on the cheap model.
const modelSettings = settingsForModel(config.answerModel);
const triageSettings = settingsForModel(config.triageModel);

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
    delivery: product.metadata?.next_day_delivery === true ? "next working day available (before 11am)" : "standard 3-7 working days",
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
    next_day_delivery: top.metadata?.next_day_delivery === true,
    image: (top.metadata?.images && top.metadata.images[0]) || ""
  };
}

// Delivery timing from the synced next-day flag (set in WooCommerce via the
// "Next working day Delivery" shipping class); otherwise standard 3-7 days.
function deliverySummary(product) {
  if (product && product.next_day_delivery) {
    return "Next-working-day delivery available: order before 11am on a working day; after 11am is processed the next working day.";
  }
  return "Standard delivery, usually 3-7 working days.";
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
      next_day_delivery: found.next_day_delivery === true,
      delivery: deliverySummary(found)
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

// Connect the customer with the human team. Mobi calls this itself instead of
// asking the customer to fill in a form; the widget then sends their on-file
// details + this conversation through the existing handoff path (team email +
// audit row). We record the request on the run context so the entry point can
// signal the widget and the guardrail knows a "passed to the team" claim is now
// truthful.
const escalateToSupportTool = tool({
  name: "escalate_to_support",
  description:
    "Connect the customer with the Bio Lec team by email. Use ONLY when truly needed: the customer asks for a person; it is a complaint, refund, return, cancellation, damaged/faulty item, or an account/payment problem; a safety or medical-suitability concern; or you genuinely cannot answer their request. Sends their details and this conversation to the team, who reply by email. Do not use for routine questions you can answer yourself.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "A short summary of what the customer needs and why it needs a person." }
    },
    required: ["reason"]
  },
  execute: async ({ reason }, runContext) => {
    if (runContext && runContext.context) {
      runContext.context.requested = true;
      runContext.context.reason = String(reason || "");
    }
    return JSON.stringify({
      ok: true,
      note: "Done — the team will receive this conversation and the customer's details and reply by email. Tell the customer plainly that you have passed it to the team; do not promise a specific time."
    });
  }
});

// Self-service order tracking. The MODEL decides this is an existing-order
// request (intent) and calls this; we don't gate on keywords. Returns the
// tracking link, with the order number appended when the customer gave one.
const trackOrderTool = tool({
  name: "track_order",
  description:
    "Get the self-service tracking link for a customer who wants to track an EXISTING order they have already placed (e.g. 'where is my order', 'has my parcel been dispatched', or they give an order number). Do NOT use for pre-sale 'how long will delivery take / when will I get it if I order now' questions — those are general delivery. If you don't have their order number yet, call this without one to get the base link, then ask them for the number.",
  strict: false,
  parameters: {
    type: "object",
    properties: {
      order_number: { type: "string", description: "The customer's order number, if they have given one." }
    },
    required: []
  },
  execute: async ({ order_number }) => {
    const base = config.orderTrackingUrl;
    const id = String(order_number || "").replace(/[^0-9]/g, "");
    if (id) {
      return JSON.stringify({
        has_number: true,
        tracking_url: `${base}${id}`,
        guidance: "Give this exact link as a clickable <a> (text 'Track my order') and invite them to open it for live tracking. Do not ask for a billing email and do not state the order's status yourself — the page shows it."
      });
    }
    return JSON.stringify({
      has_number: false,
      base_url: base,
      guidance: "Ask the customer for their order number, then give them their link by adding the number to the end of base_url. Do not ask for a billing email and do not state the status yourself."
    });
  }
});

// ---------------------------------------------------------------------------
// Agents. Each specialist carries the full shared behaviour (tone, safety,
// format, capabilities, conversation-following) plus its own focus and tools.
// ---------------------------------------------------------------------------
const productAgent = new Agent({
  name: "Product adviser",
  model: config.answerModel,
  modelSettings,
  instructions: `${productInstructions}
YOUR ROLE: You are the product adviser. Help the customer find, choose, compare, and understand products. Use your tools to fetch products, specs, stock, alternatives, and spare parts on demand. If they ask how soon a product will arrive or whether it qualifies for next-day, call get_delivery_for_product for that product. Do NOT search again just to answer a short follow-up to your own question — reply directly to what they said.`,
  tools: [searchProductsTool, getProductDetailsTool, checkStockTool, getDeliveryForProductTool, findSparePartTool, escalateToSupportTool]
});

const policyAgent = new Agent({
  name: "Policy adviser",
  model: config.answerModel,
  modelSettings,
  instructions: `${policyInstructions}
YOUR ROLE: You answer delivery, returns, VAT relief, and other general policy questions from the reliable facts above. For a SPECIFIC product's delivery timing, call get_delivery_for_product. If the customer wants to track an EXISTING order they have placed, call track_order. Handle complaints, refunds, returns, cancellations, faulty items, account/payment problems, or a request to speak to a person — when these need the team, call escalate_to_support. Do not start recommending products unless the customer asks.`,
  tools: [getDeliveryForProductTool, trackOrderTool, escalateToSupportTool]
});

const trackingAgent = new Agent({
  name: "Order tracking",
  model: config.answerModel,
  modelSettings,
  instructions: `${trackingInstructions}
YOUR ROLE: Help the customer track an EXISTING order. Call track_order to get the self-service tracking link (pass the order number if they have given one; otherwise call it without one, then ask for the number and give them the link with it on the end). Never look up orders, never ask for a billing email, and never state an order's status yourself. If there is a real problem with the order (it is late, lost, damaged, or wrong) and the customer needs a person, call escalate_to_support.`,
  tools: [trackOrderTool, escalateToSupportTool]
});

const triageAgent = Agent.create({
  name: "Mobi",
  model: config.triageModel,
  modelSettings: triageSettings,
  instructions: `You are Mobi, Bio Lec Mobility's friendly assistant. Read the latest customer message in the context of the conversation and route it to the right specialist by handing off:
- Anything about products — choosing, comparing, specs, stock, spare parts, "show me…", or a short reply continuing a product chat — hand off to the Product adviser.
- Delivery, returns, VAT relief, or other general policy questions — hand off to the Policy adviser.
- A complaint, refund, return, cancellation, damaged/faulty item, account or payment problem, or a request to speak to a person — hand off to the Policy adviser.
- Tracking an existing order ("where is my order", "track my order", an order number) — hand off to Order tracking.
For a bare greeting or thanks with no request, reply warmly in one short sentence yourself. Otherwise ALWAYS hand off — never answer product, policy, or tracking questions yourself. When unsure between product and policy, prefer the Product adviser.`,
  handoffs: [productAgent, policyAgent, trackingAgent]
});

// ---------------------------------------------------------------------------
// Entry point. Returns { answer, products, pages, handoff? } for server.js.
// ---------------------------------------------------------------------------
export async function answerWithSdk({ message, currentUrl = "", currentTitle = "", memory = null, orderContext = "" }) {
  const startedAt = Date.now();
  const items = buildInputItems({ currentUrl, currentTitle, memory, orderContext, message });
  // Shared run context: the escalate_to_support tool records here when Mobi
  // connects the customer to the team this turn.
  const handoff = { requested: false, reason: "" };
  const result = await run(triageAgent, items, { maxTurns: 8, context: handoff });

  let raw = String(result.finalOutput || "");
  let guardrail = "ok";

  // Output guardrail: Mobi must never claim to do things it cannot (email a
  // link, add to basket, set up checkout, place an order). Claiming it passed
  // the request to the team is fine ONLY when escalate_to_support really ran
  // this turn. If the draft makes a forbidden claim, re-run once with a
  // reminder; if it still slips, append an honest clarification.
  if (violatesCapabilities(raw, handoff.requested)) {
    guardrail = "retried";
    const corrected = await run(triageAgent, [...items, system(CAPABILITY_REMINDER)], { maxTurns: 8, context: handoff }).catch(() => null);
    const retryText = corrected ? String(corrected.finalOutput || "") : "";
    if (retryText && !violatesCapabilities(retryText, handoff.requested)) {
      raw = retryText;
    } else {
      guardrail = "appended";
      raw = `${retryText || raw}\n<p>Just so you know, I can't email you, add items to your basket, or check out myself. If you need a person, I can pass this to our team and they'll email you back.</p>`;
    }
  }

  const answer = await fixCardImages(raw);
  console.log(`chat.sdkTotal ${Date.now() - startedAt}ms agent=${result.lastAgent?.name || "?"} guardrail=${guardrail} handoff=${handoff.requested}`);
  const out = { answer, products: [], pages: [] };
  if (handoff.requested) out.handoff = { reason: handoff.reason };
  return out;
}

// Flags a reply that claims an action Mobi cannot perform. Kept high-precision
// so it doesn't trip on legitimate text (e.g. "our team will email you", a
// tracking link, or "head to checkout").
const CAPABILITY_REMINDER =
  "REMINDER: You cannot email the customer, add items to a basket, create checkout/payment links, or place orders yourself. Never claim you have done any of those. You CAN connect the customer with the team, but ONLY by actually calling escalate_to_support — do not claim you have passed their details to the team unless you called that tool this turn.";

// `escalated` is true when escalate_to_support actually ran this turn; when it
// did, claiming the request was passed to the team is truthful and allowed.
function violatesCapabilities(text, escalated = false) {
  const t = String(text || "");
  // Always forbidden — Mobi can never do these.
  const always = [
    /\b(added|adding|popped|put)\b[^.?!\n]*\b(basket|cart)\b/i,
    /\bin your (basket|cart)\b/i,
    /\bi['’\s]*(?:ve|have|ll|will|'ll|m)?\s*(?:just\s+)?(?:e-?mail(?:ed|ing)?|sent)\b[^.?!\n]*\b(?:link|it|this)\b/i,
    /\bcheckout link\b/i,
    /\bi['’\s]*(?:ve|have)\s*(?:just\s+)?(?:placed|set up|processed|created)\b[^.?!\n]*\b(order|checkout)\b/i
  ];
  if (always.some((re) => re.test(t))) return true;

  // Claiming the request reached the team is only OK if escalate_to_support ran.
  if (!escalated) {
    const teamClaims = [
      /\b(?:opened|raised|created|submitted|logged)\b[^.?!\n]*\bticket\b/i,
      /\byour (?:support )?ticket (?:is|has been)\b/i,
      /\b(?:passed|forwarded|sent|shared)\b[^.?!\n]*\b(?:your )?details\b[^.?!\n]*\bteam\b/i,
      /\bi['’\s]*(?:ve|have)\s*(?:just\s+)?(?:contacted|notified|emailed|messaged|alerted)\b[^.?!\n]*\bteam\b/i
    ];
    if (teamClaims.some((re) => re.test(t))) return true;
  }
  return false;
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
