import crypto from "node:crypto";
import { config } from "./config.js";

const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

export function verifyWordPressSignature(req, res, next) {
  const timestamp = req.header("x-biolec-timestamp");
  const signature = req.header("x-biolec-signature");

  if (!timestamp || !signature) {
    return res.status(401).json({ error: "Missing sync signature" });
  }

  const timestampMs = Number(timestamp) * 1000;
  if (!Number.isFinite(timestampMs) || Math.abs(Date.now() - timestampMs) > MAX_CLOCK_SKEW_MS) {
    return res.status(401).json({ error: "Expired sync signature" });
  }

  const body = req.rawBody || "";
  const expected = crypto
    .createHmac("sha256", config.syncSecret)
    .update(`${timestamp}.${body}`)
    .digest("hex");

  const supplied = signature.replace(/^sha256=/, "");
  const expectedBuffer = Buffer.from(expected, "hex");
  const suppliedBuffer = Buffer.from(supplied, "hex");

  if (
    expectedBuffer.length !== suppliedBuffer.length ||
    !crypto.timingSafeEqual(expectedBuffer, suppliedBuffer)
  ) {
    return res.status(401).json({ error: "Invalid sync signature" });
  }

  return next();
}
