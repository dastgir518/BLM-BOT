import { config } from "./config.js";

// In-memory sliding-window rate limiter keyed by client IP and session id.
// Single-instance only; for multi-instance deployments back this with Redis.
const MINUTE_MS = 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;
const PRUNE_INTERVAL_MS = 5 * 60 * 1000;

const hits = new Map();
let lastPrune = 0;

function record(key, windowMs) {
  const now = Date.now();
  const cutoff = now - windowMs;
  const timestamps = (hits.get(key) || []).filter((time) => time > cutoff);
  timestamps.push(now);
  hits.set(key, timestamps);
  return timestamps.length;
}

function peek(key, windowMs) {
  const cutoff = Date.now() - windowMs;
  return (hits.get(key) || []).filter((time) => time > cutoff).length;
}

function prune() {
  const now = Date.now();
  if (now - lastPrune < PRUNE_INTERVAL_MS) return;
  lastPrune = now;
  for (const [key, timestamps] of hits.entries()) {
    const cutoff = now - DAY_MS;
    const kept = timestamps.filter((time) => time > cutoff);
    if (kept.length) {
      hits.set(key, kept);
    } else {
      hits.delete(key);
    }
  }
}

// Resolve the real visitor IP. The forwarded header is only trustworthy because
// the WordPress -> Node hop is HMAC-signed (see verifyWordPressSignature).
export function clientIp(req) {
  return (
    req.header("x-biolec-client-ip") ||
    req.ip ||
    req.socket?.remoteAddress ||
    "unknown"
  );
}

// Express middleware enforcing per-IP (minute + day) and per-session (minute) limits.
export function rateLimit(req, res, next) {
  prune();

  const ip = clientIp(req);
  const sessionId = req.body?.session_id || "no-session";

  const checks = [
    { key: `ip-min:${ip}`, windowMs: MINUTE_MS, limit: config.rateLimit.perMin, retryAfter: 60 },
    { key: `ip-day:${ip}`, windowMs: DAY_MS, limit: config.rateLimit.perDay, retryAfter: 3600 },
    { key: `sess-min:${sessionId}`, windowMs: MINUTE_MS, limit: config.rateLimit.sessionPerMin, retryAfter: 60 }
  ];

  // Peek first so a single request never trips multiple windows inconsistently.
  for (const check of checks) {
    if (peek(check.key, check.windowMs) >= check.limit) {
      res.set("Retry-After", String(check.retryAfter));
      return res.status(429).json({
        error: "Too many requests. Please slow down and try again shortly.",
        retry_after: check.retryAfter
      });
    }
  }

  for (const check of checks) {
    record(check.key, check.windowMs);
  }

  return next();
}
