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

function valueToText(value) {
  if (value == null || value === "") return "";
  if (Array.isArray(value)) {
    return value
      .map((item) => valueToText(item))
      .filter(Boolean)
      .join(", ");
  }
  if (typeof value === "object") {
    return Object.entries(value)
      .map(([key, item]) => {
        const text = valueToText(item);
        return text ? `${key}: ${text}` : "";
      })
      .filter(Boolean)
      .join("; ");
  }
  return String(value);
}

function metaDataToText(metaData = []) {
  if (!Array.isArray(metaData)) return "";

  return metaData
    .map((item) => {
      const key = item?.key || item?.name || "";
      const text = valueToText(item?.value);
      return key && text ? `${key}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function rawMetaToText(rawMeta = {}) {
  if (!rawMeta || typeof rawMeta !== "object") return "";

  return Object.entries(rawMeta)
    .filter(([key]) => shouldIndexMetaKey(key))
    .map(([key, value]) => {
      const text = stripHtml(valueToText(value));
      return text ? `${key}: ${text}` : "";
    })
    .filter(Boolean)
    .join("\n");
}

function shouldIndexMetaKey(key = "") {
  const normalized = String(key).toLowerCase();

  if (!normalized) return false;
  if (normalized.startsWith("_") && !isUsefulPrivateMetaKey(normalized)) return false;

  const blockedParts = [
    "cost",
    "vendor",
    "supplier",
    "edit_lock",
    "edit_last",
    "yoast",
    "seo",
    "elementor",
    "astra",
    "eael",
    "ekit",
    "pixel",
    "pys",
    "wpfoof",
    "page_template",
    "product_version"
  ];

  return !blockedParts.some((part) => normalized.includes(part));
}

function isUsefulPrivateMetaKey(key) {
  return [
    "_sku",
    "_regular_price",
    "_sale_price",
    "_price",
    "_stock",
    "_stock_status",
    "_manage_stock",
    "_backorders",
    "_sold_individually",
    "_virtual",
    "_downloadable",
    "_weight",
    "_length",
    "_width",
    "_height",
    "_gtin",
    "_mpn",
    "_brand",
    "_condition"
  ].includes(key);
}

function productDetailsToText(product) {
  const dimensions = valueToText(product.dimensions);
  const taxonomies = valueToText(product.taxonomies);
  return [
    product.slug ? `Slug: ${product.slug}` : "",
    product.type ? `Type: ${product.type}` : "",
    product.status ? `Status: ${product.status}` : "",
    product.featured != null ? `Featured: ${product.featured}` : "",
    product.catalog_visibility ? `Catalog visibility: ${product.catalog_visibility}` : "",
    product.price_html ? `Displayed price: ${stripHtml(product.price_html)}` : "",
    product.stock_quantity != null ? `Stock quantity: ${product.stock_quantity}` : "",
    product.manage_stock != null ? `Manage stock: ${product.manage_stock}` : "",
    product.backorders ? `Backorders: ${product.backorders}` : "",
    product.sold_individually != null ? `Sold individually: ${product.sold_individually}` : "",
    product.weight ? `Weight: ${product.weight}` : "",
    dimensions ? `Dimensions: ${dimensions}` : "",
    product.shipping_class ? `Shipping class: ${product.shipping_class}` : "",
    product.average_rating ? `Average rating: ${product.average_rating}` : "",
    product.review_count != null ? `Review count: ${product.review_count}` : "",
    taxonomies ? `Taxonomies: ${taxonomies}` : "",
    product.purchase_note ? `Purchase note: ${stripHtml(product.purchase_note)}` : ""
  ]
    .filter(Boolean)
    .join("\n");
}

function baseMetadata(product) {
  return {
    product_id: product.product_id,
    slug: product.slug || null,
    post_date: product.post_date || null,
    post_parent: product.post_parent ?? null,
    menu_order: product.menu_order ?? null,
    sku: product.sku || null,
    url: product.url,
    type: product.type || null,
    status: product.status || null,
    price: product.price || null,
    regular_price: product.regular_price || null,
    sale_price: product.sale_price || null,
    price_html: product.price_html || null,
    stock_status: product.stock_status || null,
    stock_quantity: product.stock_quantity ?? null,
    manage_stock: product.manage_stock ?? null,
    backorders: product.backorders || null,
    sold_individually: product.sold_individually ?? null,
    weight: product.weight || null,
    dimensions: product.dimensions || null,
    shipping_class: product.shipping_class || null,
    average_rating: product.average_rating || null,
    review_count: product.review_count ?? null,
    purchase_note: product.purchase_note || null,
    taxonomies: product.taxonomies || {},
    categories: product.categories || [],
    tags: product.tags || [],
    images: product.images || [],
    meta_data: product.meta_data || [],
    updated_at: product.updated_at || null
  };
}

export function productToChunks(product) {
  const name = stripHtml(product.name);
  const shortDescription = stripHtml(product.short_description);
  const description = stripHtml(product.description);
  const attributes = attributesToText(product.attributes);
  const productDetails = productDetailsToText(product);
  const metaData = [metaDataToText(product.meta_data), rawMetaToText(product.raw_meta)]
    .filter(Boolean)
    .join("\n");
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
      content: [`Product: ${name}`, attributes, productDetails].filter(Boolean).join("\n")
    },
    {
      kind: "description",
      content: [`Product: ${name}`, description].filter(Boolean).join("\n")
    },
    {
      kind: "custom_meta",
      content: [`Product: ${name}`, metaData].filter(Boolean).join("\n")
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
