import OpenAI from "openai";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

const SYSTEM_PROMPT = `You extract structured customer details from a single chat message for a mobility-aids shop.
Return ONLY facts the customer actually stated or clearly implied in this message. Do not guess or infer beyond the text.
Return a JSON object with any of these optional string keys (omit keys you cannot fill):
- age: the user's age in years
- height: e.g. "5ft 8in" or "172cm"
- weight: e.g. "95kg" or "15 stone"
- condition: health condition, disability, illness, injury, or mobility limitation (e.g. "stroke", "arthritis, weak grip")
- mobility_needs: practical needs implied (e.g. "needs help with balance", "cannot grip well", "uses a carer")
- use_area: "indoor", "outdoor", or "indoor and outdoor"
- transport: transport/portability needs (e.g. "needs folding for car boot")
- budget: stated budget
If the message contains none of these, return {}.`;

const MAX_INPUT_LENGTH = 1000;

// Best-effort structured fact extraction. Returns {} on any error so the
// caller can fall back to the regex extractor in session-memory.
export async function extractCustomerFacts(message) {
  if (!config.factExtractionEnabled) return {};
  const text = String(message || "").trim();
  if (!text) return {};

  try {
    // Reasoning models (gpt-5*, o-series) reject `max_tokens` and a custom
    // `temperature`; they need `max_completion_tokens` and a larger budget
    // (reasoning tokens count toward completion). Older models keep the
    // cheaper, deterministic settings.
    const isReasoningModel = /^(gpt-5|o\d)/i.test(config.factModel);
    const requestParams = {
      model: config.factModel,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: SYSTEM_PROMPT },
        { role: "user", content: text.slice(0, MAX_INPUT_LENGTH) }
      ]
    };
    if (isReasoningModel) {
      requestParams.max_completion_tokens = 2000;
      requestParams.reasoning_effort = "low";
    } else {
      requestParams.max_tokens = 300;
      requestParams.temperature = 0;
    }

    const response = await openai.chat.completions.create(requestParams);

    const raw = response.choices?.[0]?.message?.content || "{}";
    const parsed = JSON.parse(raw);
    return sanitizeFacts(parsed);
  } catch (error) {
    console.error("fact extraction failed; falling back to regex facts");
    console.error(error);
    return {};
  }
}

const ALLOWED_KEYS = ["age", "height", "weight", "condition", "mobility_needs", "use_area", "transport", "budget"];

function sanitizeFacts(parsed) {
  if (!parsed || typeof parsed !== "object") return {};
  const facts = {};
  for (const key of ALLOWED_KEYS) {
    const value = parsed[key];
    if (value == null) continue;
    const text = String(value).trim().slice(0, 200);
    if (text) facts[key] = text;
  }
  return facts;
}
