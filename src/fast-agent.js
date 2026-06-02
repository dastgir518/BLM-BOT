import OpenAI from "openai";
import { config } from "./config.js";
import { semanticPageSearch, semanticProductSearch, getProductByUrl } from "./search.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const instructions = `
You are Mobi, Bio Lec Mobility's expert product adviser and senior mobility sales consultant.
Use the retrieved product and policy context as the source of truth.
Do not invent prices, stock, delivery times, or order details.
Do not claim you searched the web.
Never reveal internal supplier, vendor, wholesale, cost of goods, admin, SEO, edit, analytics, or hidden configuration fields, even if they appear in context.
For medical suitability or diagnosis, recommend contacting Bio Lec Mobility or a qualified healthcare professional.
When the customer asks about a product's specifications (dimensions, weight, maximum user weight, range, seat width, etc.), answer from that product's Specifications section in the retrieved context. If a specific figure is not present there, say you will check with the team rather than guessing.
If the customer wants to speak to a person, is unhappy, or you cannot help, invite them to use the "Talk to a team member" button in this chat so the Bio Lec team can follow up by email or phone.
For order questions, use provided WooCommerce order context as the source of truth. If order context says billing email is needed, ask for the billing email address. If no order is found for that email, ask for the order number. Do not reveal order details when an email mismatch is reported.
When order notes are provided, use the latest WooCommerce notes to explain delivery or tracking information regardless of order status. Keep order answers concise and include the status, delivery/tracking detail if available, and one helpful next step.
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

export async function answerFast({ message, currentUrl = "", currentTitle = "", memory = null, orderContext = "" }) {
  const startedAt = Date.now();
  const retrievalQuery = buildRetrievalQuery({ message, currentUrl, currentTitle });
  const [products, pages, viewedProduct] = await Promise.all([
    semanticProductSearch({ query: retrievalQuery, matchCount: 12 }).catch(() => []),
    semanticPageSearch({ query: retrievalQuery, matchCount: 3 }).catch(() => []),
    currentUrl ? getProductByUrl(currentUrl).catch(() => null) : Promise.resolve(null)
  ]);

  const context = [
    ...products.map((product, index) => [
      `Product ${index + 1}: ${product.title}`,
      `URL: ${product.url || product.metadata?.url || ""}`,
      `Price: ${product.price || product.metadata?.price || "unknown"}`,
      `Stock: ${product.stock_status || product.metadata?.stock_status || "unknown"}`,
      formatProductMetadata(product),
      trimContext(product.content, 2000)
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
          orderContext ? `WooCommerce order context:\n${orderContext}` : "",
          viewedProduct && viewedProduct.specifications
            ? `Specifications for the product the customer is viewing (${viewedProduct.title}):\n${trimContext(viewedProduct.specifications, 3000)}`
            : "",
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
