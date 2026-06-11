import { config } from "./config.js";

// Only treat as an ORDER-STATUS query when the customer clearly refers to an
// EXISTING order (an order number, or possessive/tracking phrasing). General,
// pre-sale questions like "how long does delivery take" or "when can I expect
// delivery if I order today" must NOT trigger order tracking.
const EXISTING_ORDER_PATTERN = /\b(my (order|delivery|parcel|package|item)|order (number|no\.?|status|#)|where('?s| is) my|track(ing)?|dispatch(ed)?|shipped|hasn'?t (arrived|come|shipped)|not (yet )?(arrived|received|delivered|come)|status of (my|the) order|chase (my|an?) order)\b/i;

// Tracking is now self-service: customers track their order on the website's
// track-order page. Mobi does NOT call the WooCommerce API and never states an
// order's status itself — it simply hands over the tracking link. This avoids
// revealing order details from an unverified, self-entered email.
export async function buildOrderContext({ message, memory }) {
  if (!isOrderQuery(message, memory)) return "";

  // Append the order number to the exact prefix (which already ends with "?").
  const base = config.orderTrackingUrl;
  const orderId = extractOrderId(message) || memory?.facts?.order_id || "";

  if (orderId) {
    return [
      "Order tracking (self-service): the customer can see live tracking for this order here:",
      `${base}${orderId}`,
      "Give them this exact link as a clickable <a> and invite them to open it. Do NOT ask for a billing email, do NOT call any system, and do NOT claim to know the order's status yourself — the tracking page shows it."
    ].join("\n");
  }

  return [
    "Order tracking (self-service): ask the customer for their order number, then give them their tracking link by adding the number to the end of this base URL:",
    base,
    "Example: " + base + "12345",
    "Do NOT ask for a billing email, do NOT call any system, and do NOT state the status yourself — the tracking page shows it once they open the link."
  ].join("\n");
}

export function isOrderQuery(message, memory = null) {
  const text = [
    message,
    ...(memory?.messages || []).slice(-2).map((item) => item.content)
  ].join(" ");
  // An explicit order id, or clear existing-order phrasing. A bare mention of
  // "delivery" or "order" (as in a pre-sale question) does not qualify.
  return extractOrderId(text) !== "" || EXISTING_ORDER_PATTERN.test(text);
}

function extractOrderId(value = "") {
  const match = String(value).match(/\b(?:order\s*(?:id|number|no|#)?\s*)#?\s*(\d{3,})\b/i)
    || String(value).match(/#\s*(\d{3,})\b/);
  return match ? match[1] : "";
}
