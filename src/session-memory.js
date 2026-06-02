const MAX_MESSAGES = 8;
const MAX_FACTS = 20;
const SESSION_TTL_MS = 60 * 60 * 1000;
const sessions = new Map();

export function getSessionMemory(sessionId) {
  const session = getSession(sessionId);
  return {
    facts: { ...session.facts },
    messages: [...session.messages],
    customerTurns: session.customerTurns || 0
  };
}

export function rememberUserMessage(sessionId, message) {
  const session = getSession(sessionId);
  session.customerTurns = (session.customerTurns || 0) + 1;
  session.messages.push({ role: "customer", content: String(message || "") });
  session.messages = session.messages.slice(-MAX_MESSAGES);
  mergeFacts(session.facts, extractFacts(message));
}

export function rememberCustomer(sessionId, { name, email } = {}) {
  const session = getSession(sessionId);
  if (name) session.facts.customer_name = String(name).trim();
  if (email) session.facts.email = String(email).trim().toLowerCase();
}

// Merge an arbitrary set of extracted facts (e.g. from the LLM extractor) into
// the session memory. Values take precedence over earlier regex-derived facts.
export function rememberFacts(sessionId, facts = {}) {
  if (!facts || typeof facts !== "object") return;
  const session = getSession(sessionId);
  mergeFacts(session.facts, facts);
}

export function rememberAssistantMessage(sessionId, answer) {
  const session = getSession(sessionId);
  session.messages.push({ role: "assistant", content: stripHtml(answer) });
  session.messages = session.messages.slice(-MAX_MESSAGES);
}

// Tracks whether a returning customer's saved profile has been loaded into this
// session yet, so we only read it from the database once per session.
export function isProfileLoaded(sessionId) {
  return Boolean(getSession(sessionId).profileLoaded);
}

export function markProfileLoaded(sessionId) {
  getSession(sessionId).profileLoaded = true;
}

function getSession(sessionId) {
  const key = sessionId || "anonymous";
  const existing = sessions.get(key);
  if (existing && Date.now() - existing.updatedAt <= SESSION_TTL_MS) {
    existing.updatedAt = Date.now();
    return existing;
  }

  if (!sessions.has(key)) {
    sessions.set(key, createSession());
  } else {
    sessions.set(key, createSession());
  }

  pruneExpiredSessions();
  return sessions.get(key);
}

function createSession() {
  return { facts: {}, messages: [], customerTurns: 0, profileLoaded: false, updatedAt: Date.now() };
}

function pruneExpiredSessions() {
  const now = Date.now();
  for (const [key, session] of sessions.entries()) {
    if (now - session.updatedAt > SESSION_TTL_MS) {
      sessions.delete(key);
    }
  }
}

function mergeFacts(target, facts) {
  for (const [key, value] of Object.entries(facts)) {
    if (value) target[key] = value;
  }

  const entries = Object.entries(target).slice(-MAX_FACTS);
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of entries) target[key] = value;
}

function extractFacts(message = "") {
  const text = String(message);
  const facts = {};
  const lower = text.toLowerCase();
  const email = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  if (email) facts.email = email[0].toLowerCase();

  const orderId = text.match(/\b(?:order\s*(?:id|number|no|#)?\s*)#?\s*(\d{3,})\b/i)
    || text.match(/#\s*(\d{3,})\b/);
  if (orderId) facts.order_id = orderId[1];

  const age = lower.match(/\b(?:age|aged|he is|she is|i am|i'm|im)\s*(\d{2,3})\b/) || lower.match(/\b(\d{2,3})\s*(?:years? old|yr old|yrs old)\b/);
  if (age) facts.age = age[1];

  const height = lower.match(/\b(?:height|tall|i am|i'm|im|he is|she is)\s*(\d)\s*(?:ft|feet|')\s*(\d{1,2})?\s*(?:in|inch|inches|")?\b/)
    || lower.match(/\b(\d{3})\s*cm\b/);
  if (height) facts.height = height[2] ? `${height[1]}ft ${height[2]}in` : height[0];

  const weight = lower.match(/\b(?:weight|weighs?|user weight)\s*(?:is|around|about)?\s*(\d{2,3})\s*(kg|kgs|kilograms|stone|st|lb|lbs)?\b/)
    || lower.match(/\b(\d{2,3})\s*(kg|kgs|kilograms|stone|st|lb|lbs)\b/);
  if (weight) facts.weight = `${weight[1]}${weight[2] ? ` ${weight[2]}` : ""}`;

  if (/\b(indoor|inside|home|house)\b/.test(lower)) facts.use_area = "indoor";
  if (/\b(outdoor|outside|pavement|street|park|terrain|gravel)\b/.test(lower)) facts.use_area = facts.use_area ? `${facts.use_area} and outdoor` : "outdoor";
  if (/\b(car boot|boot|travel|fold|folding|portable|transport)\b/.test(lower)) facts.transport = "needs folding/portable option";
  if (/\b(seat|sit|rest|breaks?)\b/.test(lower)) facts.resting = "needs a seat/rest option";
  if (/\b(arthritis|weak grip|brake|brakes|hands?)\b/.test(lower)) facts.hand_control = "check grip and brake comfort";

  const condition = lower.match(/\b(?:condition|disability|illness|diagnosed with|has|have|suffers? from)\s+([^.;,\n]{3,80})/);
  if (condition) facts.condition = condition[1].trim();

  const commonConditions = [
    "arthritis",
    "parkinson",
    "stroke",
    "ms",
    "multiple sclerosis",
    "copd",
    "dementia",
    "alzheimer",
    "hip replacement",
    "knee replacement",
    "back pain",
    "sciatica",
    "balance",
    "weakness",
    "breathless",
    "neuropathy"
  ];
  const matchedConditions = commonConditions.filter((item) => lower.includes(item));
  if (matchedConditions.length && !facts.condition) {
    facts.condition = matchedConditions.join(", ");
  }

  return facts;
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
