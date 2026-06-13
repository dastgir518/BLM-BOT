import OpenAI from "openai";
import { config } from "./config.js";
import { semanticPageSearch, semanticProductSearch, getProductByUrl, filterRelevantProducts } from "./search.js";
import { instructions } from "./agent-prompt.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Read-only tools the model can call to fetch catalogue data on demand, so it
// can actually fulfil what it offers (e.g. find an alternative to compare, or
// pull exact specs) instead of guessing or repeating the same product.
const TOOLS = [
  {
    type: "function",
    name: "search_products",
    description:
      "Search the Bio Lec Mobility catalogue. Use this to find an ALTERNATIVE product for a comparison, a cheaper or lighter option, or products in a category you do not already have in the provided context. Returns matching products with name, URL, price, stock, image, and a short spec summary.",
    parameters: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "What to search for, e.g. 'folding commode chair under £70' or 'lightweight self-propelled wheelchair'."
        },
        max_results: {
          type: "integer",
          description: "How many products to return (1-8).",
          minimum: 1,
          maximum: 8
        }
      },
      required: ["query"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_product_details",
    description:
      "Get the full specifications for one product by its URL. Use this when you need exact figures (dimensions, maximum user weight, seat width, range, etc.) for a product you are about to recommend or compare.",
    parameters: {
      type: "object",
      properties: {
        url: { type: "string", description: "The product page URL." }
      },
      required: ["url"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "check_stock",
    description:
      "Check whether a specific product is in stock. Use when the customer asks if something is available. Give the product name or its URL.",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", description: "Product name or product page URL." }
      },
      required: ["product"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "get_delivery_for_product",
    description:
      "Get the delivery timing for one specific product by reading its shipping class. Use when the customer asks how soon a particular item will arrive. Give the product name or URL.",
    parameters: {
      type: "object",
      properties: {
        product: { type: "string", description: "Product name or product page URL." }
      },
      required: ["product"],
      additionalProperties: false
    }
  },
  {
    type: "function",
    name: "find_spare_part",
    description:
      "Search for a spare part, replacement, or accessory. Use when the customer needs a part for a product (e.g. a replacement wheel, brake, or basket). Describe the part and the product it is for.",
    parameters: {
      type: "object",
      properties: {
        query: { type: "string", description: "What part is needed and the product it is for." }
      },
      required: ["query"],
      additionalProperties: false
    }
  }
];

const TOOL_GUIDANCE = `
TOOLS (you can fetch live catalogue data yourself)
- You have these tools:
  - search_products: find products (e.g. an alternative for a comparison, or a cheaper/lighter option).
  - get_product_details: full specifications for one product URL.
  - check_stock: whether a specific product is in stock.
  - get_delivery_for_product: the delivery timing for a specific product (from its shipping class).
  - find_spare_part: find a spare part, replacement, or accessory.
- Always use the "Retrieved context" already provided first. Only call a tool when you need something that is NOT already there.
- Crucially: if you offer or promise the customer something (a comparison, a cheaper option, exact specs, a stock check, a delivery time, a spare part), CALL the matching tool to actually get it rather than guessing or repeating a product you already showed. If a tool returns nothing suitable, say so honestly and offer the team.
- Keep tool use minimal (at most a couple of calls). Never mention the tools, searching, or "the system" to the customer.
`;

const MAX_TOOL_ROUNDS = 2;

export async function answerFast({ message, currentUrl = "", currentTitle = "", memory = null, orderContext = "" }) {
  const startedAt = Date.now();
  const retrievalQuery = buildRetrievalQuery({ message, currentUrl, currentTitle, memory });
  const [rawProducts, pages, viewedProduct] = await Promise.all([
    semanticProductSearch({ query: retrievalQuery, matchCount: config.fastProductMatchCount }).catch(() => []),
    semanticPageSearch({ query: retrievalQuery, matchCount: 3 }).catch(() => []),
    currentUrl ? getProductByUrl(currentUrl).catch(() => null) : Promise.resolve(null)
  ]);

  const products = filterRelevantProducts(rawProducts);

  const context = [
    ...products.map((product, index) => [
      `Product ${index + 1}: ${product.title}`,
      `URL: ${product.url || product.metadata?.url || ""}`,
      `Price: ${product.price || product.metadata?.price || "unknown"}`,
      `Stock: ${product.stock_status || product.metadata?.stock_status || "unknown"}`,
      `Image: ${(product.metadata?.images && product.metadata.images[0]) || ""}`,
      formatProductMetadata(product),
      trimContext(product.content, 2000)
    ].join("\n")),
    ...pages.map((page, index) => [
      `Page ${index + 1}: ${page.title}`,
      `URL: ${page.url || page.metadata?.url || ""}`,
      trimContext(page.content, 700)
    ].join("\n"))
  ].join("\n\n---\n\n");

  // GPT-5 / o-series are reasoning models: they reject `temperature` and need a
  // larger token budget (reasoning tokens count toward the output). Standard
  // models (gpt-4.1, gpt-4o) take temperature and a smaller cap.
  const isReasoningModel = /^(gpt-5|o\d)/i.test(config.fastAnswerModel);
  const maxOutputTokens = isReasoningModel ? 2500 : 800;

  const input = [
    { role: "system", content: instructions + TOOL_GUIDANCE },
    {
      role: "user",
      content: [
        currentUrl ? `Customer is currently viewing:\nTitle: ${currentTitle || "unknown"}\nURL: ${currentUrl}` : "",
        formatMemory(memory),
        orderContext ? `WooCommerce order context:\n${orderContext}` : "",
        viewedProduct && viewedProduct.specifications
          ? `Specifications for the product the customer is viewing (${viewedProduct.title}):\n${trimContext(viewedProduct.specifications, 3000)}`
          : "",
        context ? `Retrieved context:\n${context}` : "No retrieved context was found.",
        `Customer message:\n${message}`
      ].join("\n\n")
    }
  ];

  // Chain rounds with previous_response_id so reasoning state carries between
  // tool calls (the robust pattern for reasoning models). store:true is what
  // makes that chaining possible.
  const baseParams = { model: config.fastAnswerModel, max_output_tokens: maxOutputTokens, tools: TOOLS, store: true };
  if (isReasoningModel) baseParams.reasoning = { effort: "low" };
  else baseParams.temperature = 0.4;

  let response = await openai.responses.create({ ...baseParams, input });

  let toolRounds = 0;
  while (toolRounds < MAX_TOOL_ROUNDS) {
    const calls = (response.output || []).filter((item) => item.type === "function_call");
    if (!calls.length) break;

    const toolOutputs = [];
    for (const call of calls) {
      const result = await runTool(call.name, safeJsonParse(call.arguments));
      toolOutputs.push({ type: "function_call_output", call_id: call.call_id, output: JSON.stringify(result) });
    }

    response = await openai.responses.create({
      ...baseParams,
      previous_response_id: response.id,
      input: toolOutputs
    });
    toolRounds += 1;
  }

  const answer = await fixCardImages(response.output_text, products);

  console.log(`chat.fastTotal ${Date.now() - startedAt}ms tools=${toolRounds}`);

  return {
    answer,
    products,
    pages
  };
}

// Guarantee every product card shows the image that actually belongs to the
// product its "View product" link points to. The model occasionally borrows a
// different product's image; here we overwrite each card's <img> with the
// canonical image for its linked URL (or drop the <img> if we have none).
async function fixCardImages(html, products) {
  const text = String(html || "");
  if (!text.includes("biolec-result__img")) return text;

  const imageByUrl = new Map();
  for (const product of products || []) {
    const url = product.url || product.metadata?.url || "";
    const img = (product.metadata?.images && product.metadata.images[0]) || "";
    if (url && img) imageByUrl.set(normalizeUrlKey(url), img);
  }

  const pattern = '<img\\b[^>]*class="biolec-result__img"[^>]*>([\\s\\S]*?)<a\\b[^>]*class="biolec-result__link"[^>]*href="([^"]+)"';

  // Collect linked product URLs we don't already have an image for, and look
  // them up (covers tool-fetched products not in the initial context).
  const collector = new RegExp(pattern, "g");
  const unknown = new Set();
  let match;
  while ((match = collector.exec(text)) !== null) {
    const key = normalizeUrlKey(match[2]);
    if (key && !imageByUrl.has(key)) unknown.add(match[2]);
  }
  for (const href of unknown) {
    try {
      const product = await getProductByUrl(href);
      imageByUrl.set(normalizeUrlKey(href), product?.image || "");
    } catch (_error) {
      imageByUrl.set(normalizeUrlKey(href), "");
    }
  }

  return text.replace(new RegExp(pattern, "g"), (full, between, href) => {
    const img = imageByUrl.get(normalizeUrlKey(href)) || "";
    const imgTag = img ? `<img class="biolec-result__img" src="${img}" alt="">` : "";
    const withoutOriginalImg = full.replace(/^<img\b[^>]*>/, "");
    return imgTag + withoutOriginalImg;
  });
}

function normalizeUrlKey(url) {
  return String(url || "").trim().toLowerCase().split(/[?#]/)[0].replace(/\/+$/, "");
}

async function runTool(name, args) {
  try {
    if (name === "search_products") {
      const max = Math.min(Math.max(Number(args?.max_results) || 6, 1), 8);
      const raw = await semanticProductSearch({ query: String(args?.query || "").trim(), matchCount: max });
      const found = filterRelevantProducts(raw).slice(0, max).map(toToolProduct);
      return found.length ? { products: found } : { products: [], note: "No matching products found." };
    }
    if (name === "get_product_details") {
      const product = await getProductByUrl(String(args?.url || "").trim());
      if (!product) return { found: false, note: "No product found for that URL." };
      return {
        found: true,
        title: product.title,
        url: product.url,
        specifications: trimContext(product.specifications, 2500)
      };
    }
    if (name === "check_stock") {
      const product = await resolveProduct(String(args?.product || ""));
      if (!product) return { found: false, note: "Couldn't find that product." };
      return { found: true, title: product.title, url: product.url, stock_status: product.stock_status || "unknown" };
    }
    if (name === "get_delivery_for_product") {
      const product = await resolveProduct(String(args?.product || ""));
      if (!product) return { found: false, note: "Couldn't find that product." };
      return {
        found: true,
        title: product.title,
        url: product.url,
        delivery: deliverySummary(product.shipping_class)
      };
    }
    if (name === "find_spare_part") {
      const query = `${String(args?.query || "").trim()} spare part replacement accessory`;
      const raw = await semanticProductSearch({ query, matchCount: 6 });
      const found = filterRelevantProducts(raw).slice(0, 6).map(toToolProduct);
      return found.length
        ? { products: found }
        : { products: [], note: "No matching spare part or accessory found — offer to connect them with the team." };
    }
    return { error: "unknown tool" };
  } catch (_error) {
    return { error: "tool lookup failed" };
  }
}

// Resolve a product from a name OR a URL to the fields the tools need.
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
    shipping_class: top.metadata?.shipping_class || ""
  };
}

// Map a WooCommerce shipping-class slug to a plain-English delivery summary,
// matching the DELIVERY POLICY rules in the prompt.
function deliverySummary(shippingClass) {
  const normalized = String(shippingClass || "").replace(/[-_]/g, " ").toLowerCase();
  if (!normalized) return "Usually 3-7 working days (please confirm for this item).";
  if (/next.?working.?day/.test(normalized)) {
    return "Next-working-day available: order before 11am on a working day; orders placed after 11am are processed the next working day.";
  }
  if (/free/.test(normalized)) return "Free delivery, usually 3-7 working days.";
  return "Usually 3-7 working days.";
}

function toToolProduct(product) {
  return {
    title: product.title,
    url: product.url || product.metadata?.url || "",
    price: product.price || product.metadata?.price || "unknown",
    stock: product.stock_status || product.metadata?.stock_status || "unknown",
    image: (product.metadata?.images && product.metadata.images[0]) || "",
    specifications: trimContext(product.metadata?.specifications || "", 1200)
  };
}

function safeJsonParse(value) {
  try {
    return JSON.parse(value || "{}");
  } catch (_error) {
    return {};
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
