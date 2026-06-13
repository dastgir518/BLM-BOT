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

  const [lexicalResults, vectorResults] = await Promise.all([
    lexicalProductSearch({ query, matchCount, category, stockStatus }),
    vectorProductSearch({ query, matchCount, category, stockStatus })
  ]);

  const results = mergeProductResults(lexicalResults, vectorResults).slice(0, matchCount);
  setCached(cacheKey, results);
  return results;
}

async function vectorProductSearch({ query, matchCount, category, stockStatus }) {
  const embedding = await createEmbedding(query);
  const { data, error } = await supabase.rpc("match_product_documents", {
    query_embedding: embedding,
    match_count: Math.max(matchCount, 12),
    filter_category: category,
    filter_stock_status: stockStatus
  });

  if (error) throw error;
  return (data || []).map((item) => ({ ...item, match_source: "semantic" }));
}

async function lexicalProductSearch({ query, matchCount, category, stockStatus }) {
  const terms = productNameTerms(query);
  if (!terms.length) return [];

  const titlePatterns = terms.slice(0, 4).map((term) => `title.ilike.%${escapeIlike(term)}%`);
  const urlPatterns = terms.slice(0, 2).map((term) => `url.ilike.%${escapeIlike(slugify(term))}%`);
  let request = supabase
    .from("product_documents")
    .select("id, product_id, title, content, url, sku, price, stock_status, categories, metadata")
    .or([...titlePatterns, ...urlPatterns].join(","))
    .limit(Math.max(matchCount, 12));

  if (stockStatus) {
    request = request.eq("stock_status", stockStatus);
  }

  if (category) {
    request = request.contains("categories", [category]);
  }

  const { data, error } = await request;
  if (error) throw error;

  return (data || [])
    .map((item) => ({
      ...item,
      similarity: lexicalScore(item, query, terms),
      match_source: "name"
    }))
    .sort((a, b) => b.similarity - a.similarity);
}

function mergeProductResults(...groups) {
  const seen = new Map();

  for (const group of groups) {
    for (const item of group || []) {
      const existing = seen.get(item.id);
      if (!existing || resultRank(item) > resultRank(existing)) {
        seen.set(item.id, item);
      }
    }
  }

  return [...seen.values()].sort((a, b) => resultRank(b) - resultRank(a));
}

function resultRank(item) {
  const sourceBoost = item.match_source === "name" ? 2 : 0;
  return sourceBoost + Number(item.similarity || 0);
}

function lexicalScore(item, query, terms) {
  const title = String(item.title || "").toLowerCase();
  const url = String(item.url || "").toLowerCase();
  const normalizedQuery = normalizeSearchText(query);
  let score = 0.7;

  if (title === normalizedQuery) score += 1;
  if (title.includes(normalizedQuery)) score += 0.8;
  score += terms.filter((term) => title.includes(term.toLowerCase())).length * 0.08;
  score += terms.filter((term) => url.includes(slugify(term))).length * 0.04;
  return score;
}

function productNameTerms(query) {
  const normalized = normalizeSearchText(query);
  const quoted = [...String(query).matchAll(/["“”']([^"“”']{5,})["“”']/g)].map((match) => normalizeSearchText(match[1]));
  const titleLike = normalized
    .split(/\b(?:for|with|under|about|tell me|show me|is|does|what|which|recommend|need|want|looking)\b/i)
    .map((part) => part.trim())
    .filter((part) => part.length >= 8);

  return [...new Set([...quoted, ...titleLike, normalized].filter((term) => term.length >= 8))];
}

function normalizeSearchText(value) {
  return String(value || "")
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, " ")
    .replace(/[^a-z0-9\s-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function slugify(value) {
  return normalizeSearchText(value).replace(/\s+/g, "-");
}

function escapeIlike(value) {
  return String(value).replace(/[%_]/g, "\\$&");
}

const MIN_PRODUCT_SIMILARITY = 0.18;

// Drop weak semantic matches so the model isn't tempted to recommend products
// that barely relate to the query. Name (lexical) matches are always kept, and
// if the threshold would remove everything we keep the top few.
export function filterRelevantProducts(products = []) {
  if (!Array.isArray(products) || !products.length) return [];
  const kept = products.filter(
    (item) => item.match_source === "name" || Number(item.similarity || 0) >= MIN_PRODUCT_SIMILARITY
  );
  return kept.length ? kept : products.slice(0, 3);
}

// Directly fetch the product a customer is viewing (by page URL) so its full
// specifications are guaranteed in context, regardless of semantic ranking.
export async function getProductByUrl(url) {
  const base = normalizeUrl(url);
  if (!base) return null;

  const { data, error } = await supabase
    .from("product_documents")
    .select("title, url, price, stock_status, content, metadata")
    .ilike("url", `${escapeIlike(base)}%`)
    .limit(8);

  if (error) throw error;
  if (!data || !data.length) return null;

  const specChunk = data.find((row) => row.metadata?.chunk_kind === "specifications");
  const row = specChunk || data[0];
  // Stock/price/shipping live at product level; pull from whichever chunk row
  // carries them so a thin specifications chunk doesn't return blanks.
  return {
    title: row.title,
    url: row.url,
    price: (data.find((r) => r.price)?.price) || row.metadata?.price || "",
    stock_status: (data.find((r) => r.stock_status)?.stock_status) || row.metadata?.stock_status || "",
    shipping_class: (data.find((r) => r.metadata?.shipping_class)?.metadata?.shipping_class) || "",
    image: (data.find((r) => r.metadata?.images?.length)?.metadata?.images?.[0]) || "",
    specifications: row.metadata?.specifications || ""
  };
}

function normalizeUrl(url) {
  const text = String(url || "").trim();
  if (!text) return "";
  return text.split(/[?#]/)[0].replace(/\/+$/, "");
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
