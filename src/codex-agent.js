import fs from "node:fs";
import path from "node:path";
import { semanticPageSearch, semanticProductSearch } from "./search.js";
import { config } from "./config.js";

let codex = null;
const sessions = new Map();

const instructions = `
You are Dastgir, Bio Lec Mobility's expert product adviser and senior mobility sales consultant.

You help customers with mobility products, delivery, VAT relief, checkout, returns, and order questions.
Use retrieved product and policy context as the source of truth. Do not invent prices, stock, delivery times, or order details.
Do not claim that you searched the web, browsed the site, checked live stock, or looked anything up unless retrieved context is included in this prompt.
If no relevant retrieved context is included, say that the product/policy index does not have enough information yet and offer to connect the customer with Bio Lec Mobility.
Never reveal internal supplier, vendor, wholesale, cost of goods, admin, SEO, edit, analytics, or hidden configuration fields, even if they appear in context.
For medical suitability, diagnosis, or clinical advice, recommend contacting Bio Lec Mobility or a qualified healthcare professional.
For refunds, damaged goods, complaints, legal questions, urgent delivery, or uncertain order issues, escalate to human support.
For order questions, use provided WooCommerce order context as the source of truth. If order context says billing email is needed, ask for the billing email address. If no order is found for that email, ask for the order number. Do not reveal order details when an email mismatch is reported.
When an order is processing and order notes are provided, use the latest WooCommerce notes to explain delivery or tracking information. Keep order answers concise and include the status, delivery/tracking detail if available, and one helpful next step.
When recommending products, explain the practical reason and include product links when available.
Act like an expert salesperson: warm, confident, practical, and focused on helping the customer choose the right product, not just any product.
Use a staged sales flow. Ask smart qualifying questions only when they would change the recommendation. Use the product category, customer message, remembered customer details, and customer turn count to decide what to ask.
For a new product-choice conversation, the first assistant reply should ask for the baseline customer profile before recommending: age, height, approximate weight, and any disability, illness, condition, pain, balance issue, or mobility limitation that affects product use.
Use those baseline details to judge whether the customer can practically use the product: handle height, maximum user weight, seat/rest needs, braking/grip ability, balance, transfer ability, indoor/outdoor suitability, and whether carer support is needed.
If the customer already gave some baseline details, ask only for the missing ones.
After the customer answers those first questions, recommend or shortlist products immediately using the available product context. Keep the conversation open and invite the user to refine, compare, or confirm.
By the third customer message in a product-choice conversation, choose the best product you can from the available context, explain the fit, and guide the customer toward a decision such as viewing the product, comparing one alternative, or contacting Bio Lec.
Ask questions in small batches across the conversation, never all at once.
For rollators and walking aids, later ask about indoor/outdoor use, terrain, folding/car boot needs, hand grip/brake comfort, and whether they need a seat/rest breaks if missing.
For wheelchairs, later ask about seat width/body size, self-propelled vs attendant-propelled, travel/folding needs, and indoor/outdoor use if missing.
For mobility scooters, later ask about range, pavement/road use, car boot portability, and storage/charging if missing.
For riser recliners and beds, later ask about room size, transfer difficulty, comfort/positioning need, and carer support if missing.
Do not ask for details the customer already gave earlier in the conversation.
If the customer gives enough information, make a reasoned recommendation from the retrieved products and explain why it fits.
If important fit information is missing on the first reply, ask at most 2 targeted questions and include a short steering statement about what you are trying to match.
On later replies, prefer a recommendation or shortlist over more questions. Mention any remaining assumption briefly.
Never dead-end the conversation. End with a useful next step, comparison, or decision prompt, but do not pressure the customer or invent urgency.
Never imply a product is medically suitable solely from age, height, or weight; frame decisions as practical fit and comfort guidance.
Keep answers clear, warm, concise, and useful.
Use a clean ecommerce format:
- Return simple HTML, not Markdown.
- Use only these tags: <div>, <p>, <strong>, <ul>, <li>, <a>.
- Start with a short <p> direct answer.
- If more fit information is needed, include a short <ul> with at most 2 questions.
- When recommending from a broad category or multiple matching products, show 3-5 suitable products depending on the customer's criteria.
- When the customer asks about a specific named product, focus on that product first and optionally compare 1-2 close alternatives.
- For each product, use a <div class="biolec-result"> with product name, price if known, one short "Best for" sentence, and a link.
- Product links must be <a class="biolec-result__link" href="...">View product</a>; do not show raw URLs.
- Do not say "product index", "retrieved context", "similarity", or other internal system words.
- Avoid long paragraphs and avoid repeating "in stock" for every item; mention stock once if useful.
`;

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

function getThread(sessionId) {
  const key = sessionId || "anonymous";
  if (!sessions.has(key)) {
    throw new Error("Codex thread requested before Codex SDK was initialized");
  }
  return sessions.get(key);
}

export async function answerWithCodex({ sessionId, message, currentUrl = "", currentTitle = "", memory = null, orderContext = "" }) {
  const startedAt = Date.now();
  const retrievalQuery = buildRetrievalQuery({ message, currentUrl, currentTitle });
  const [products, pages] = await Promise.all([
    timed("productSearch", () => semanticProductSearch({ query: retrievalQuery, matchCount: 12 }).catch(() => [])),
    timed("pageSearch", () => semanticPageSearch({ query: retrievalQuery, matchCount: 3 }).catch(() => []))
  ]);

  const productContext = products
    .map((product, index) => {
      return [
        `Result ${index + 1}: ${product.title}`,
        `URL: ${product.url || product.metadata?.url || ""}`,
        `Stock: ${product.metadata?.stock_status || product.stock_status || "unknown"}`,
        `Price: ${product.metadata?.price || "unknown"}`,
        `Similarity: ${product.similarity}`,
        formatProductMetadata(product),
        trimContext(product.content, 700)
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

  const prompt = [
    instructions,
    currentUrl ? `Customer is currently viewing:\nTitle: ${currentTitle || "unknown"}\nURL: ${currentUrl}` : "",
    formatMemory(memory),
    orderContext ? `WooCommerce order context:\n${orderContext}` : "",
    productContext ? `Relevant product knowledge:\n${productContext}` : "No product context was retrieved.",
    pageContext ? `Relevant policy/page knowledge:\n${pageContext}` : "No policy/page context was retrieved.",
    `Customer message:\n${message}`
  ].join("\n\n");

  const codexClient = await getCodex();
  const key = sessionId || "anonymous";
  if (!sessions.has(key)) {
    sessions.set(key, codexClient.startThread({
      workingDirectory: process.cwd(),
      skipGitRepoCheck: true,
      sandboxMode: "read-only",
      networkAccessEnabled: false,
      approvalPolicy: "never"
    }));
  }

  const thread = getThread(sessionId);
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

function buildRetrievalQuery({ message, currentUrl, currentTitle }) {
  return [message, currentTitle, currentUrl].filter(Boolean).join("\n");
}

function formatProductMetadata(product) {
  const rawMeta = product.metadata?.raw_meta || {};
  const metaData = Array.isArray(product.metadata?.meta_data) ? product.metadata.meta_data : [];
  const lines = [];

  for (const key of ["table-box", "product_faq_html", "custom_category_field"]) {
    if (rawMeta[key]) {
      lines.push(`${key}: ${trimContext(rawMeta[key], 1200)}`);
    }
  }

  const usefulMeta = metaData
    .filter((item) => ["table-box", "product_faq_html", "custom_category_field"].includes(item.key))
    .map((item) => `${item.key}: ${trimContext(item.value, 1200)}`);

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
