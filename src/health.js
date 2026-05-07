import { supabase } from "./supabase.js";

export async function checkSupabase() {
  const checks = [];

  for (const table of ["product_documents", "page_documents"]) {
    const result = await supabase.from(table).select("id", { count: "exact", head: true });
    checks.push({
      table,
      ok: !result.error,
      count: result.count,
      error: result.error?.message || null
    });
  }

  return {
    ok: checks.every((check) => check.ok),
    checks
  };
}
