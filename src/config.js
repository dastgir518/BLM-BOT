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
  fastAnswerModel: process.env.FAST_ANSWER_MODEL || "gpt-4.1-mini"
};
