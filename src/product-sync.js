import { productToChunks } from "./chunking.js";
import { createEmbeddings } from "./embeddings.js";
import { supabase } from "./supabase.js";

export async function upsertProduct(product) {
  if (!product?.product_id || !product?.name) {
    throw new Error("Invalid product payload");
  }

  // Defensive: only published products belong in the vector store. If anything
  // else arrives, remove it rather than index it.
  if (product.status && product.status !== "publish") {
    return deleteProduct(product.product_id);
  }

  const chunks = productToChunks(product);
  const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));

  const rows = chunks.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index]
  }));

  const { error: deleteError } = await supabase
    .from("product_documents")
    .delete()
    .eq("product_id", product.product_id);

  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase.from("product_documents").insert(rows);
  if (insertError) throw insertError;

  await supabase.from("sync_events").insert({
    source: "wordpress",
    event_type: "product.upsert",
    entity_type: "product",
    entity_id: String(product.product_id),
    status: "sent",
    payload: product
  });

  return { product_id: product.product_id, chunks: rows.length };
}

export async function deleteProduct(productId) {
  if (!productId) {
    throw new Error("Missing product_id");
  }

  const { error } = await supabase.from("product_documents").delete().eq("product_id", productId);
  if (error) throw error;

  await supabase.from("sync_events").insert({
    source: "wordpress",
    event_type: "product.delete",
    entity_type: "product",
    entity_id: String(productId),
    status: "sent"
  });

  return { product_id: productId, deleted: true };
}

export async function clearProducts() {
  const { error } = await supabase
    .from("product_documents")
    .delete()
    .neq("id", "__never__");

  if (error) throw error;

  await supabase.from("sync_events").insert({
    source: "wordpress",
    event_type: "product.clear",
    entity_type: "product",
    status: "sent"
  });

  return { cleared: true };
}
