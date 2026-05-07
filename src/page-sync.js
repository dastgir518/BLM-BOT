import { pageToChunks } from "./chunking.js";
import { createEmbeddings } from "./embeddings.js";
import { supabase } from "./supabase.js";

export async function upsertPage(page) {
  const chunks = pageToChunks(page);
  const embeddings = await createEmbeddings(chunks.map((chunk) => chunk.content));

  const rows = chunks.map((chunk, index) => ({
    ...chunk,
    embedding: embeddings[index]
  }));

  const { error: deleteError } = await supabase
    .from("page_documents")
    .delete()
    .eq("page_id", page.page_id);

  if (deleteError) throw deleteError;

  const { error: insertError } = await supabase.from("page_documents").insert(rows);
  if (insertError) throw insertError;

  await supabase.from("sync_events").insert({
    source: "wordpress",
    event_type: "page.upsert",
    entity_type: "page",
    entity_id: String(page.page_id),
    status: "sent",
    payload: page
  });

  return { page_id: page.page_id, chunks: rows.length };
}

export async function deletePage(pageId) {
  if (!pageId) {
    throw new Error("Missing page_id");
  }

  const { error } = await supabase.from("page_documents").delete().eq("page_id", pageId);
  if (error) throw error;

  await supabase.from("sync_events").insert({
    source: "wordpress",
    event_type: "page.delete",
    entity_type: "page",
    entity_id: String(pageId),
    status: "sent"
  });

  return { page_id: pageId, deleted: true };
}

export async function clearPages() {
  const { error } = await supabase
    .from("page_documents")
    .delete()
    .neq("id", "__never__");

  if (error) throw error;

  await supabase.from("sync_events").insert({
    source: "wordpress",
    event_type: "page.clear",
    entity_type: "page",
    status: "sent"
  });

  return { cleared: true };
}
