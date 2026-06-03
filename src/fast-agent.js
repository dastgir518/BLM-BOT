import OpenAI from "openai";
import { config } from "./config.js";
import { semanticPageSearch, semanticProductSearch, getProductByUrl, filterRelevantProducts } from "./search.js";
import { instructions } from "./agent-prompt.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

export async function answerFast({ message, currentUrl = "", currentTitle = "", memory = null, orderContext = "" }) {
  const startedAt = Date.now();
  const retrievalQuery = buildRetrievalQuery({ message, currentUrl, currentTitle, memory });
  const [rawProducts, pages, viewedProduct] = await Promise.all([
    semanticProductSearch({ query: retrievalQuery, matchCount: 12 }).catch(() => []),
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
  const requestParams = {
    model: config.fastAnswerModel,
    max_output_tokens: isReasoningModel ? 2500 : 800,
    input: [
      {
        role: "system",
        content: instructions
      },
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
    ]
  };

  if (isReasoningModel) {
    requestParams.reasoning = { effort: "low" };
  } else {
    requestParams.temperature = 0.4;
  }

  const response = await openai.responses.create(requestParams);

  console.log(`chat.fastTotal ${Date.now() - startedAt}ms`);

  return {
    answer: response.output_text,
    products,
    pages
  };
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
  return [...recent, ...needFacts, currentTitle, currentUrl].filter(Boolean).join("\n");
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
