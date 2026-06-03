import dotenv from "dotenv";

dotenv.config();

function required(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export const config = {
  port: Number(process.env.PORT || 8787),
  host: process.env.HOST || "127.0.0.1",
  publicSiteOrigin: process.env.PUBLIC_SITE_ORIGIN || "https://biolecmobility.com",
  openaiApiKey: required("OPENAI_API_KEY"),
  embeddingModel: process.env.OPENAI_EMBEDDING_MODEL || "text-embedding-3-small",
  supabaseUrl: required("SUPABASE_URL"),
  supabaseServiceRoleKey: required("SUPABASE_SERVICE_ROLE_KEY"),
  syncSecret: required("BIOLEC_SYNC_SECRET"),
  woocommerce: {
    url: required("WOOCOMMERCE_URL"),
    consumerKey: required("WOOCOMMERCE_CONSUMER_KEY"),
    consumerSecret: required("WOOCOMMERCE_CONSUMER_SECRET")
  },
  codexModel: process.env.CODEX_MODEL || "gpt-5.3-codex",
  codexPath: process.env.CODEX_PATH || "",
  answerEngine: process.env.ANSWER_ENGINE || "codex",
  fastAnswerModel: process.env.FAST_ANSWER_MODEL || "gpt-5",
  factModel: process.env.FACT_MODEL || process.env.FAST_ANSWER_MODEL || "gpt-4.1-mini",
  factExtractionEnabled: (process.env.FACT_EXTRACTION_ENABLED || "true").toLowerCase() !== "false",
  freeMessageLimit: Number(process.env.FREE_MESSAGE_LIMIT || 3),
  maxMessageLength: Number(process.env.MAX_MESSAGE_LENGTH || 2000),
  requireChatSignature: (process.env.CHAT_REQUIRE_SIGNATURE || "true").toLowerCase() !== "false",
  rateLimit: {
    perMin: Number(process.env.RATE_LIMIT_PER_MIN || 20),
    perDay: Number(process.env.RATE_LIMIT_PER_DAY || 200),
    sessionPerMin: Number(process.env.SESSION_RATE_LIMIT_PER_MIN || 10)
  },
  dailyAnswerLimit: Number(process.env.DAILY_ANSWER_LIMIT || 3000),
  moderationEnabled: (process.env.MODERATION_ENABLED || "true").toLowerCase() !== "false",
  moderationModel: process.env.MODERATION_MODEL || "omni-moderation-latest"
};
