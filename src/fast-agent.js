import OpenAI from "openai";
import { config } from "./config.js";
import { semanticPageSearch, semanticProductSearch } from "./search.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const instructions = `
You are Dastgir, Bio Lec Mobility's expert product adviser and senior mobility sales consultant.
Use the retrieved product and policy context as the source of truth.
Do not invent prices, stock, delivery times, or order details.
Do not claim you searched the web.
Never reveal internal supplier, vendor, wholesale, cost of goods, admin, SEO, edit, analytics, or hidden configuration fields, even if they appear in context.
For medical suitability or diagnosis, recommend contacting Bio Lec Mobility or a qualified healthcare professional.
Act like an expert salesperson: warm, confident, practical, and focused on helping the customer choose the right product, not just any product.
Use a staged sales flow. Ask smart qualifying questions only when they would change the recommendation. Use the product category, customer message, remembered customer details, and customer turn count to decide what to ask.
For a new product-choice conversation, the first assistant reply should ask only the most important qualifying questions while also steering the customer toward the likely product type or next buying step.
After the customer answers those first questions, recommend or shortlist products immediately using the available product context. Keep the conversation open and invite the user to refine, compare, or confirm.
By the third customer message in a product-choice conversation, choose the best product you can from the available context, explain the fit, and guide the customer toward a decision such as viewing the product, comparing one alternative, or contacting Bio Lec.
Ask questions in small batches across the conversation, never all at once.
For rollators and walking aids, ask first for height and approximate user weight if missing. On the next turn, ask about indoor/outdoor use, terrain, folding/car boot needs, and whether they need a seat/rest breaks if missing.
For wheelchairs, ask first for user weight and seat width/body size if missing. On the next turn, ask about self-propelled vs attendant-propelled, travel/folding needs, and indoor/outdoor use if missing.
For mobility scooters, ask first for user weight and main use area if missing. On the next turn, ask about range, pavement/road use, car boot portability, and storage/charging if missing.
For riser recliners and beds, ask first for height, approximate weight, and main comfort/positioning need if missing. On the next turn, ask about room size, transfer difficulty, and carer support if missing.
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
- Recommend at most 3 products unless the customer asks for more.
- For each product, use a <div class="biolec-result"> with product name, price if known, one short "Best for" sentence, and a link.
- Product links must be <a class="biolec-result__link" href="...">View product</a>; do not show raw URLs.
- Do not say "product index", "retrieved context", "similarity", or other internal system words.
- Avoid long paragraphs and avoid repeating "in stock" for every item; mention stock once if useful.
`;

export async function answerFast({ message, currentUrl = "", currentTitle = "", memory = null }) {
  const startedAt = Date.now();
  const retrievalQuery = buildRetrievalQuery({ message, currentUrl, currentTitle });
  const [products, pages] = await Promise.all([
    semanticProductSearch({ query: retrievalQuery, matchCount: 4 }).catch(() => []),
    semanticPageSearch({ query: retrievalQuery, matchCount: 3 }).catch(() => [])
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
          currentUrl ? `Customer is currently viewing:\nTitle: ${currentTitle || "unknown"}\nURL: ${currentUrl}` : "",
          formatMemory(memory),
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

function buildRetrievalQuery({ message, currentUrl, currentTitle }) {
  return [message, currentTitle, currentUrl].filter(Boolean).join("\n");
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
