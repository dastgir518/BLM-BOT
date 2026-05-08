const MAX_MESSAGES = 8;
const MAX_FACTS = 20;
const sessions = new Map();

export function getSessionMemory(sessionId) {
  const session = getSession(sessionId);
  return {
    facts: { ...session.facts },
    messages: [...session.messages]
  };
}

export function rememberUserMessage(sessionId, message) {
  const session = getSession(sessionId);
  session.messages.push({ role: "customer", content: String(message || "") });
  session.messages = session.messages.slice(-MAX_MESSAGES);
  mergeFacts(session.facts, extractFacts(message));
}

export function rememberAssistantMessage(sessionId, answer) {
  const session = getSession(sessionId);
  session.messages.push({ role: "assistant", content: stripHtml(answer) });
  session.messages = session.messages.slice(-MAX_MESSAGES);
}

function getSession(sessionId) {
  const key = sessionId || "anonymous";
  if (!sessions.has(key)) {
    sessions.set(key, { facts: {}, messages: [] });
  }
  return sessions.get(key);
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

  return facts;
}

function stripHtml(value = "") {
  return String(value)
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
