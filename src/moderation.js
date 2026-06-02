import OpenAI from "openai";
import { config } from "./config.js";

const openai = new OpenAI({ apiKey: config.openaiApiKey });

// Returns { flagged: boolean } for the incoming message. The OpenAI moderation
// endpoint is free, so this runs before the expensive answer call. On any error
// we fail open (do not block legitimate customers if moderation is unavailable).
export async function isFlagged(message) {
  if (!config.moderationEnabled || !message) return false;

  try {
    const response = await openai.moderations.create({
      model: config.moderationModel,
      input: String(message)
    });
    return Boolean(response.results?.[0]?.flagged);
  } catch (error) {
    console.error("moderation check failed; allowing message");
    console.error(error);
    return false;
  }
}
