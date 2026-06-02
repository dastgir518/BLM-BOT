// Client-side smoke test for the chat abuse-protection guards.
//
// Expects the bot server to already be running (see scripts/smoke-guards.md or
// the command in the chat) with this env:
//   CHAT_REQUIRE_SIGNATURE=true FREE_MESSAGE_LIMIT=0
//   SESSION_RATE_LIMIT_PER_MIN=5 RATE_LIMIT_PER_MIN=1000 RATE_LIMIT_PER_DAY=10000
//   MODERATION_ENABLED=false BIOLEC_SYNC_SECRET=test-secret PORT=8799
//
// Every path asserted here returns BEFORE any Supabase/OpenAI call, so dummy
// credentials are fine. Verifies: HMAC signature, honeypot, validation, length
// cap, the soft gate, and per-session rate limiting.

import crypto from "node:crypto";

const SECRET = process.env.BIOLEC_SYNC_SECRET || "test-secret";
const PORT = process.env.PORT || 8799;
const BASE = `http://127.0.0.1:${PORT}`;
const CLIENT_IP = "203.0.113.5";

function signedHeaders(body, { clientIp = CLIENT_IP } = {}) {
  const ts = Math.floor(Date.now() / 1000).toString();
  const sig = crypto.createHmac("sha256", SECRET).update(`${ts}.${body}`).digest("hex");
  return {
    "Content-Type": "application/json",
    "X-Biolec-Timestamp": ts,
    "X-Biolec-Signature": `sha256=${sig}`,
    "X-Biolec-Client-IP": clientIp
  };
}

async function post(path, payload, { signed = true, clientIp = CLIENT_IP } = {}) {
  const body = JSON.stringify(payload);
  const headers = signed
    ? signedHeaders(body, { clientIp })
    : { "Content-Type": "application/json", "X-Biolec-Client-IP": clientIp };
  const res = await fetch(`${BASE}${path}`, { method: "POST", headers, body });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}  ->  ${detail}`);
    failed++;
  }
}

console.log(`Testing ${BASE}\n`);

// 1. Unsigned request is rejected.
let r = await post("/chat", { session_id: "s1", message: "hello" }, { signed: false });
check("unsigned /chat -> 401", r.status === 401, `got ${r.status}`);

// 2. Tampered signature is rejected (sign one body, send another).
{
  const goodBody = JSON.stringify({ session_id: "s2", message: "hello" });
  const headers = signedHeaders(goodBody);
  const res = await fetch(`${BASE}/chat`, {
    method: "POST",
    headers,
    body: JSON.stringify({ session_id: "s2", message: "tampered" })
  });
  check("tampered signature -> 401", res.status === 401, `got ${res.status}`);
}

// 3. Correctly signed honeypot submission is silently accepted.
r = await post("/chat", { session_id: "s3", message: "hi", hp_field: "i-am-a-bot" });
check("signed honeypot -> 200 benign", r.status === 200 && !r.data.require_email && !!r.data.answer, `got ${r.status} ${JSON.stringify(r.data)}`);

// 4. Missing message -> 400.
r = await post("/chat", { session_id: "s4" });
check("missing message -> 400", r.status === 400, `got ${r.status}`);

// 5. Over-length message -> 400.
r = await post("/chat", { session_id: "s5", message: "x".repeat(2500) });
check("over-length message -> 400", r.status === 400, `got ${r.status}`);

// 6. Soft gate: anonymous message with FREE_MESSAGE_LIMIT=0 -> require_email.
r = await post("/chat", { session_id: "s6", message: "I need a wheelchair" });
check("soft gate -> require_email", r.status === 200 && r.data.require_email === true, `got ${r.status} ${JSON.stringify(r.data)}`);

// 7. Register honeypot -> benign ok.
r = await post("/chat/register", { session_id: "s7", customer_name: "Bot", customer_email: "b@b.com", hp_field: "x" });
check("register honeypot -> 200 ok", r.status === 200 && r.data.ok === true, `got ${r.status} ${JSON.stringify(r.data)}`);

// 8. Register with invalid email -> 400.
r = await post("/chat/register", { session_id: "s8", customer_name: "Real", customer_email: "not-an-email" });
check("register bad email -> 400", r.status === 400, `got ${r.status}`);

// 9. Handoff honeypot -> benign ok (no email/record).
r = await post("/handoff", { session_id: "h1", customer_name: "Bot", customer_email: "b@b.com", hp_field: "x" });
check("handoff honeypot -> 200 ok", r.status === 200 && r.data.ok === true, `got ${r.status} ${JSON.stringify(r.data)}`);

// 10. Handoff with invalid email -> 400.
r = await post("/handoff", { session_id: "h2", customer_name: "Real", customer_email: "nope" });
check("handoff bad email -> 400", r.status === 400, `got ${r.status}`);

// 11. Per-session rate limit: 6th request on one session (limit 5) -> 429.
let lastStatus = null;
for (let i = 0; i < 6; i++) {
  const res = await post("/chat", { session_id: "rl", message: "hi", hp_field: "x" }, { clientIp: "198.51.100.9" });
  lastStatus = res.status;
}
check("session rate limit -> 429 on 6th", lastStatus === 429, `last status ${lastStatus}`);

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
