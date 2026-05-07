import OpenAI from "openai";
import { config } from "./config.js";
import { semanticPageSearch, semanticProductSearch } from "./search.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const instructions = `
You are Bio Lec Mobility's website assistant.
Use the retrieved product and policy context as the source of truth.
Do not invent prices, stock, delivery times, or order details.
Do not claim you searched the web.
For medical suitability or diagnosis, recommend contacting Bio Lec Mobility or a qualified healthcare professional.
Keep answers clear, warm, concise, and useful.
Use a clean ecommerce format:
- Return simple HTML, not Markdown.
- Use only these tags: <div>, <p>, <strong>, <ul>, <li>, <a>.
- Start with a short <p> direct answer.
- Recommend at most 3 products unless the customer asks for more.
- For each product, use a <div class="biolec-result"> with product name, price if known, one short "Best for" sentence, and a link.
- Product links must be <a class="biolec-result__link" href="...">View product</a>; do not show raw URLs.
- Do not say "product index", "retrieved context", "similarity", or other internal system words.
- Avoid long paragraphs and avoid repeating "in stock" for every item; mention stock once if useful.
`;

export async function answerFast({ message }) {
  const startedAt = Date.now();
  const [products, pages] = await Promise.all([
    semanticProductSearch({ query: message, matchCount: 4 }).catch(() => []),
    semanticPageSearch({ query: message, matchCount: 3 }).catch(() => [])
  ]);

  const context = [
    ...products.map((product, index) => [
      `Product ${index + 1}: ${product.title}`,
      `URL: ${product.url || product.metadata?.url || ""}`,
      `Price: ${product.price || product.metadata?.price || "unknown"}`,
      `Stock: ${product.stock_status || product.metadata?.stock_status || "unknown"}`,
      trimContext(product.content, 900)
    ].join("\n")),
    ...pages.map((page, index) => [
      `Page ${index + 1}: ${page.title}`,
      `URL: ${page.url || page.metadata?.url || ""}`,
      trimContext(page.content, 700)
    ].join("\n"))
  ].join("\n\n---\n\n");

  const response = await openai.responses.create({
    model: config.fastAnswerModel,
    input: [
      {
        role: "system",
        content: instructions
      },
      {
        role: "user",
        content: [
          context ? `Retrieved context:\n${context}` : "No retrieved context was found.",
          `Customer message:\n${message}`
        ].join("\n\n")
      }
    ]
  });

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
