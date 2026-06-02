import { config } from "./config.js";

const ORDER_QUERY_PATTERN = /\b(order|delivery|deliver|tracking|track|shipment|shipped|dispatch|where is|status)\b/i;

export async function buildOrderContext({ message, memory }) {
  if (!isOrderQuery(message, memory)) return "";

  const email = extractEmail(message) || memory?.facts?.email || "";
  const orderId = extractOrderId(message) || memory?.facts?.order_id || "";

  if (!email) {
    return [
      "Order lookup status: needs_billing_email",
      "Ask the customer for the billing email address used on the order before checking order details."
    ].join("\n");
  }

  const lookup = orderId
    ? await findOrderById({ orderId, email })
    : await findLatestOrderByEmail(email);

  if (lookup.status === "not_found") {
    return [
      "Order lookup status: not_found_for_email",
      `Billing email provided: ${email}`,
      "Tell the customer you could not find an order for that email and ask for their order number."
    ].join("\n");
  }

  if (lookup.status === "email_mismatch") {
    return [
      "Order lookup status: email_mismatch",
      "Do not reveal order details. Ask the customer to confirm the billing email address used for that order."
    ].join("\n");
  }

  if (!lookup.order) {
    return [
      "Order lookup status: lookup_error",
      "Say you could not check the order just now and offer to connect the customer with Bio Lec Mobility."
    ].join("\n");
  }

  const notes = await getOrderNotes(lookup.order.id).catch(() => []);

  return formatOrderContext(lookup.order, notes);
}

export function isOrderQuery(message, memory = null) {
  const text = [
    message,
    ...(memory?.messages || []).slice(-2).map((item) => item.content)
  ].join(" ");
  return ORDER_QUERY_PATTERN.test(text);
}

function extractEmail(value = "") {
  const match = String(value).match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match ? match[0].toLowerCase() : "";
}

function extractOrderId(value = "") {
  const match = String(value).match(/\b(?:order\s*(?:id|number|no|#)?\s*)#?\s*(\d{3,})\b/i)
    || String(value).match(/#\s*(\d{3,})\b/);
  return match ? match[1] : "";
}

async function findLatestOrderByEmail(email) {
  const orders = await wooRequest("/orders", {
    search: email,
    per_page: "10",
    orderby: "date",
    order: "desc"
  });

  const exact = orders.find((order) => String(order.billing?.email || "").toLowerCase() === email);
  return exact ? { status: "found", order: exact } : { status: "not_found" };
}

async function findOrderById({ orderId, email }) {
  try {
    const order = await wooRequest(`/orders/${encodeURIComponent(orderId)}`);
    const billingEmail = String(order.billing?.email || "").toLowerCase();
    if (billingEmail && billingEmail !== email.toLowerCase()) {
      return { status: "email_mismatch" };
    }
    return { status: "found", order };
  } catch (error) {
    if (error.status === 404) return { status: "not_found" };
    throw error;
  }
}

async function getOrderNotes(orderId) {
  const notes = await wooRequest(`/orders/${encodeURIComponent(orderId)}/notes`, {
    per_page: "3",
    order: "desc"
  });

  return notes.map((note) => ({
    date_created: note.date_created,
    note: stripHtml(note.note)
  }));
}

async function wooRequest(path, params = {}) {
  const baseUrl = config.woocommerce.url.replace(/\/$/, "");
  const url = new URL(`${baseUrl}/wp-json/wc/v3${path}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, value);
  }

  const auth = Buffer.from(`${config.woocommerce.consumerKey}:${config.woocommerce.consumerSecret}`).toString("base64");
  const response = await fetch(url, {
    headers: {
      Authorization: `Basic ${auth}`,
      Accept: "application/json"
    }
  });

  if (!response.ok) {
    const error = new Error(`WooCommerce request failed: ${response.status}`);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

function formatOrderContext(order, notes) {
  const lineItems = (order.line_items || [])
    .slice(0, 5)
    .map((item) => `${item.name} x ${item.quantity}`)
    .join("; ");

  const noteText = notes.length
    ? notes.map((note, index) => `Note ${index + 1} (${note.date_created || "unknown date"}): ${note.note}`).join("\n")
    : "";

  return [
    "Order lookup status: found",
    `Order ID: ${order.id}`,
    `Order number: ${order.number || order.id}`,
    `Status: ${order.status}`,
    `Date created: ${order.date_created || "unknown"}`,
    `Payment method: ${order.payment_method_title || "unknown"}`,
    `Shipping method: ${(order.shipping_lines || []).map((item) => item.method_title).filter(Boolean).join(", ") || "unknown"}`,
    `Items: ${lineItems || "unknown"}`,
    noteText ? `Latest WooCommerce order notes for delivery/tracking:\n${noteText}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
