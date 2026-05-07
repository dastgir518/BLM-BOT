function stripHtml(value = "") {
  return String(value)
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&pound;/g, "GBP ")
    .replace(/\s+/g, " ")
    .trim();
}

function attributesToText(attributes = {}) {
  if (Array.isArray(attributes)) {
    return attributes
      .map((attribute) => {
        const name = attribute.name || attribute.slug || "Attribute";
        const options = Array.isArray(attribute.options) ? attribute.options.join(", ") : attribute.option;
        return `${name}: ${options || ""}`;
      })
      .filter(Boolean)
      .join("\n");
  }

  return Object.entries(attributes)
    .map(([name, value]) => `${name}: ${Array.isArray(value) ? value.join(", ") : value}`)
    .join("\n");
}

function baseMetadata(product) {
  return {
    product_id: product.product_id,
    sku: product.sku || null,
    url: product.url,
    price: product.price || null,
    regular_price: product.regular_price || null,
    sale_price: product.sale_price || null,
    stock_status: product.stock_status || null,
    categories: product.categories || [],
    tags: product.tags || [],
    images: product.images || [],
    updated_at: product.updated_at || null
  };
}

export function productToChunks(product) {
  const name = stripHtml(product.name);
  const shortDescription = stripHtml(product.short_description);
  const description = stripHtml(product.description);
  const attributes = attributesToText(product.attributes);
  const variations = product.variations?.length
    ? product.variations.map((variation) => JSON.stringify(variation)).join("\n")
    : "";

  const sections = [
    {
      kind: "summary",
      content: [
        `Product: ${name}`,
        product.sku ? `SKU: ${product.sku}` : "",
        product.categories?.length ? `Categories: ${product.categories.join(", ")}` : "",
        product.tags?.length ? `Tags: ${product.tags.join(", ")}` : "",
        shortDescription
      ]
        .filter(Boolean)
        .join("\n")
    },
    {
      kind: "specifications",
      content: [`Product: ${name}`, attributes].filter(Boolean).join("\n")
    },
    {
      kind: "description",
      content: [`Product: ${name}`, description].filter(Boolean).join("\n")
    },
    {
      kind: "variations",
      content: [`Product: ${name}`, variations].filter(Boolean).join("\n")
    }
  ].filter((section) => section.content.trim().length > 0);

  return sections.map((section, index) => ({
    id: `product_${product.product_id}_${section.kind}_${index}`,
    product_id: product.product_id,
    chunk_index: index,
    title: name,
    content: section.content,
    url: product.url,
    sku: product.sku || null,
    price: product.price === "" || product.price == null ? null : Number(product.price),
    stock_status: product.stock_status || null,
    categories: product.categories || [],
    metadata: {
      ...baseMetadata(product),
      chunk_kind: section.kind
    }
  }));
}

export function pageToChunks(page) {
  const title = stripHtml(page.title);
  const content = stripHtml(page.content);

  if (!page?.page_id || !title || !content) {
    throw new Error("Invalid page payload");
  }

  const maxLength = 1800;
  const paragraphs = content.split(/(?<=\.)\s+/);
  const chunks = [];
  let current = "";

  for (const paragraph of paragraphs) {
    if ((current + " " + paragraph).trim().length > maxLength && current.trim()) {
      chunks.push(current.trim());
      current = paragraph;
    } else {
      current = `${current} ${paragraph}`.trim();
    }
  }

  if (current.trim()) {
    chunks.push(current.trim());
  }

  return chunks.map((chunk, index) => ({
    id: `page_${page.page_id}_${index}`,
    page_id: page.page_id,
    chunk_index: index,
    title,
    content: [`Page: ${title}`, chunk].join("\n"),
    url: page.url,
    metadata: {
      page_id: page.page_id,
      slug: page.slug || null,
      url: page.url,
      updated_at: page.updated_at || null
    }
  }));
}
