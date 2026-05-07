import { createEmbedding } from "./embeddings.js";
import { supabase } from "./supabase.js";

const CACHE_TTL_MS = 5 * 60 * 1000;
const cache = new Map();

export async function semanticProductSearch({ query, matchCount = 8, category = null, stockStatus = null }) {
  if (!query) {
    throw new Error("Search query is required");
  }

  const cacheKey = JSON.stringify(["products", query.toLowerCase().trim(), matchCount, category, stockStatus]);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const embedding = await createEmbedding(query);
  const { data, error } = await supabase.rpc("match_product_documents", {
    query_embedding: embedding,
    match_count: matchCount,
    filter_category: category,
    filter_stock_status: stockStatus
  });

  if (error) throw error;
  const results = data || [];
  setCached(cacheKey, results);
  return results;
}

export async function semanticPageSearch({ query, matchCount = 5 }) {
  if (!query) {
    throw new Error("Search query is required");
  }

  const cacheKey = JSON.stringify(["pages", query.toLowerCase().trim(), matchCount]);
  const cached = getCached(cacheKey);
  if (cached) return cached;

  const embedding = await createEmbedding(query);
  const { data, error } = await supabase.rpc("match_page_documents", {
    query_embedding: embedding,
    match_count: matchCount
  });

  if (error) throw error;
  const results = data || [];
  setCached(cacheKey, results);
  return results;
}

function getCached(key) {
  const item = cache.get(key);
  if (!item) return null;
  if (Date.now() - item.createdAt > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return item.value;
}

function setCached(key, value) {
  cache.set(key, { value, createdAt: Date.now() });
  if (cache.size > 200) {
    const firstKey = cache.keys().next().value;
    cache.delete(firstKey);
  }
}
