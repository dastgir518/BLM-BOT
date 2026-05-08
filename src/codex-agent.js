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
When recommending products, explain the practical reason and include product links when available.
Act like an expert salesperson: warm, confident, practical, and focused on helping the customer choose the right product, not just any product.
Ask smart qualifying questions when fit matters. Use the product category and customer message to decide what to ask.
For walking aids, rollators, wheelchairs, riser recliners, beds, scooters, and similar products, consider age, height, approximate user weight, mobility level, indoor/outdoor use, terrain, travel/storage needs, car boot lifting, seat width, handle height, braking ability, and whether a carer will help.
If the customer gives enough information, make a reasoned recommendation from the retrieved products and explain why it fits. If important fit information is missing, ask 2-4 targeted questions before making a final recommendation, while still naming likely options if the context supports them.
Never imply a product is medically suitable solely from age, height, or weight; frame decisions as practical fit and comfort guidance.
Keep answers clear, warm, concise, and useful.
Use a clean ecommerce format:
- Return simple HTML, not Markdown.
- Use only these tags: <div>, <p>, <strong>, <ul>, <li>, <a>.
- Start with a short <p> direct answer.
- If more fit information is needed, include a short <ul> of questions.
- Recommend at most 3 products unless the customer asks for more.
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

export async function answerWithCodex({ sessionId, message, currentUrl = "", currentTitle = "" }) {
  const startedAt = Date.now();
  const retrievalQuery = buildRetrievalQuery({ message, currentUrl, currentTitle });
  const [products, pages] = await Promise.all([
    timed("productSearch", () => semanticProductSearch({ query: retrievalQuery, matchCount: 4 }).catch(() => [])),
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
        trimContext(product.content, 900)
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
