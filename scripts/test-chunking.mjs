// Unit test for productToChunks spec handling. chunking.js is pure (no config
// or network), so this runs with no credentials.

import { productToChunks } from "../src/chunking.js";

let passed = 0;
let failed = 0;
function check(name, condition, detail) {
  if (condition) {
    console.log(`  PASS  ${name}`);
    passed++;
  } else {
    console.log(`  FAIL  ${name}  ->  ${detail}`);
    failed++;
  }
}

// A spec table well over the old 900-char cap (~3500 chars of rows).
const rows = [];
for (let i = 1; i <= 60; i++) {
  rows.push(`<tr><td>Spec field ${i}</td><td>Value ${i} measured in mm/kg</td></tr>`);
}
const bigTable = `<table class="table-box">${rows.join("")}</table>`;
const specLength = bigTable.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim().length;

const product = {
  product_id: 123,
  name: "Test Folding Wheelchair",
  slug: "test-folding-wheelchair",
  url: "https://example.com/product/test-folding-wheelchair/",
  sku: "TFW-1",
  price: "499",
  stock_status: "instock",
  weight: "15",
  dimensions: { length: "90", width: "60", height: "95" },
  categories: ["Wheelchairs"],
  short_description: "A lightweight folding wheelchair.",
  description: "Full description here.",
  attributes: [{ name: "Max user weight", options: ["120kg"] }],
  meta_data: [],
  raw_meta: { "table-box": [bigTable] }
};

const chunks = productToChunks(product);
console.log(`spec table stripped length ~${specLength} chars\n`);

const specChunk = chunks.find((c) => c.metadata?.chunk_kind === "specifications");
check("specifications chunk exists", Boolean(specChunk), "no specifications chunk");

const stored = specChunk?.metadata?.specifications || "";
check("metadata.specifications is populated", stored.length > 0, "empty");
check("spec survives past old 900 cap", stored.length > 1500, `only ${stored.length} chars`);
check("spec contains a late row (not truncated early)", stored.includes("Spec field 55"), "missing late row");
check("attributes included in spec blob", stored.includes("Max user weight"), "missing attributes");
check("dimensions included in spec blob", /Dimensions/.test(stored), "missing dimensions");
check("spec table embedded in chunk content", specChunk?.content.includes("Spec field 40"), "spec text not in embedded content");

console.log(`\nResult: ${passed} passed, ${failed} failed`);
process.exit(failed === 0 ? 0 : 1);
