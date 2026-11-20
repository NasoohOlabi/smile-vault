import { SQL } from "bun";
import { createHash } from "node:crypto";
import { z } from "zod";
import { groupTshirts, isShirt, resolveCatalogLine } from "../src/catalog.js";
import seedProducts from "../products.json";
import seedNavigation from "../catalog-nav.json";

export const db = new SQL(process.env.DATABASE_URL);
export const dist = new URL("../dist/", import.meta.url);
const schema = new URL("./schema.sql", import.meta.url);
const seededCopy = {
  announcement: "",
  about: "Dama is an independent creative platform observing Damascus through the lens of urban life, culture, and everyday experience. We tell stories, document visual and cultural details, and create designs and projects that invite people to look at familiar places and topics differently.",
  observatory: "The Observatory is a platform concerned with everyday life in Damascus: its contradictions, cons, perks, and all the little things that shape how we experience the city.",
};
const text = (max) => z.string().trim().max(max);
const revision = z.number().int().positive();
const id = z.number().int().positive();
export const assetId = z.uuid();
export const statuses = z.enum(["new", "confirmed", "fulfilled", "cancelled"]);
const imagePath = text(400).min(1);
const emailSafeInstagram = text(60).regex(/^[a-zA-Z0-9_.]+$/);
const price = z.number().int().min(0).max(5_000_000);
export const maxImageBytes = 5 * 1024 * 1024;

export const productInput = z.object({
  name: text(160).min(1),
  type: text(60).min(1),
  section: text(80).optional(),
  price,
  image: imagePath,
  variantColor: z.enum(["B", "W", "BL", ""]).optional(),
  variantSide: z.enum(["front", "back", ""]).optional(),
  variantPrint: text(50).optional(),
  variantDefault: z.boolean().optional(),
  defaultSide: z.enum(["front", "back", ""]).optional(),
  published: z.boolean(),
});
export const updateProductInput = productInput.extend({ id, revision });
export const copyInput = z.object({
  revision, announcement: text(280), about: text(2000), observatory: text(2000),
});
export const collectionInput = z.object({
  revision, type: text(60).min(1), section: text(80).optional(),
  label: text(80).min(1), title: text(150).optional(), dates: text(100).optional(),
  copy: text(2500).optional(), image: text(400).optional(), alt: text(160).optional(),
  comingSoon: z.boolean().optional(),
});
export const orderUpdateInput = z.object({ id: assetId, revision, status: statuses });
export const checkoutInput = z.object({
  customer: z.object({
    name: text(120).min(1),
    instagram: emailSafeInstagram,
    whatsapp: z.string().regex(/^\d{10}$/),
    phone: z.string().regex(/^(\d{10})?$/),
    pickup: z.enum(["Mashrou Dummar", "Shalaan", "Yalla Go"]),
    notes: text(1500),
  }),
  items: z.array(z.object({
    id: z.string().regex(/^\d{1,10}(::[SML])?$/),
    quantity: z.number().int().min(1).max(100),
    price,
  })).min(1).max(60).refine((items) => new Set(items.map((item) => item.id)).size === items.length),
});

export class StoreError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

export function validate(shape, data) {
  const result = shape.safeParse(data);
  if (result.success) return result.data;
  const issue = result.error.issues[0];
  throw new StoreError(400, `${issue.path.join(" › ") || "Request"}: ${issue.message}`);
}

export async function initialize() {
  await db.begin(async (tx) => {
    await tx`SELECT pg_advisory_xact_lock(972231)`;
    await tx.unsafe(await Bun.file(schema).text()).simple();
    const seeded = await tx`
      INSERT INTO storefront (navigation, copy)
      VALUES (${JSON.stringify(seedNavigation)}::text::jsonb, ${JSON.stringify(seededCopy)}::text::jsonb)
      ON CONFLICT DO NOTHING RETURNING singleton
    `;
    if (!seeded.length) return;
    for (const { id, ...details } of seedProducts) {
      await tx`INSERT INTO products (id, details) VALUES (${id}, ${JSON.stringify(details)}::text::jsonb)`;
    }
    await tx`SELECT setval(pg_get_serial_sequence('products', 'id'), (SELECT max(id) FROM products))`;
  });
}

export async function settings(client = db) {
  const [row] = await client`SELECT navigation, copy, revision FROM storefront`;
  return row;
}

export async function products(admin = false, client = db) {
  const rows = await client`SELECT * FROM products WHERE published OR ${admin} ORDER BY id`;
  return rows.map(({ id, details, published, revision }) =>
    admin ? { ...details, id, published, revision } : { ...details, id });
}

export function staticFile(path) {
  const parts = path.replace(/^\//, "").split("/");
  if (parts.some((part) => !part || part === "." || part === ".." || /[\\:\x00-\x1f]/.test(part))) return null;
  return Bun.file(new URL(parts.map(encodeURIComponent).join("/"), dist));
}

async function validateImage(client, path) {
  if (path.startsWith("/media/")) {
    const key = validate(assetId, path.slice("/media/".length));
    const [asset] = await client`SELECT id FROM assets WHERE id = ${key} FOR KEY SHARE`;
    if (asset) return;
  } else if (/\.(jpeg|jpg|png|webp|gif)$/i.test(path) && await staticFile(path)?.exists()) {
    return;
  }
  throw new StoreError(400, "Choose an image from the asset library or keep the current image.");
}

export async function saveProduct(input) {
  return db.begin(async (tx) => {
    const { id, revision, published, ...details } = input;
    const { navigation } = await settings(tx);
    const type = navigation.types.find((item) => item.id === details.type);
    if (!type || (type.sections.length && !type.sections.some((section) => section.id === details.section))) {
      throw new StoreError(400, "Choose an existing collection and section.");
    }
    if (!type.sections.length) delete details.section;
    await validateImage(tx, details.image);
    details.title = details.name;
    details.category = details.section || type.slug;
    const data = JSON.stringify(details);
    const [row] = id
      ? await tx`
          UPDATE products SET details = ${data}::text::jsonb, published = ${published}, revision = revision + 1
          WHERE id = ${id} AND revision = ${revision} RETURNING id, revision
        `
      : await tx`
          INSERT INTO products (details, published) VALUES (${data}::text::jsonb, ${published}) RETURNING id, revision
        `;
    if (!row) throw new StoreError(409, "This product changed. Refresh and try again.");
    return { ...details, published, ...row };
  });
}

export async function saveCopy({ revision, ...copy }) {
  const [row] = await db`
    UPDATE storefront SET copy = ${JSON.stringify(copy)}::text::jsonb, revision = revision + 1 WHERE revision = ${revision}
    RETURNING navigation, copy, revision
  `;
  if (!row) throw new StoreError(409, "The storefront changed. Refresh and try again.");
  return row;
}

export async function saveCollection(input) {
  const { revision, type, section, label, title, dates, copy, image, alt, comingSoon } = input;
  return db.begin(async (tx) => {
    const current = await settings(tx);
    const collection = current.navigation.types.find((item) => item.id === type);
    const target = section ? collection?.sections.find((item) => item.id === section) : collection;
    if (!target) throw new StoreError(404, "Collection section not found.");
    target.label = label;
    if (section) {
      if (image) await validateImage(tx, image);
      const feature = Object.fromEntries(Object.entries({ title, dates, copy, image, alt }).filter(([, value]) => value));
      if (Object.keys(feature).length) target.feature = feature;
      else delete target.feature;
      target.tease = Boolean(comingSoon);
    }
    const [row] = await tx`
      UPDATE storefront SET navigation = ${JSON.stringify(current.navigation)}::text::jsonb, revision = revision + 1
      WHERE revision = ${revision} RETURNING navigation, copy, revision
    `;
    if (!row) throw new StoreError(409, "The storefront changed. Refresh and try again.");
    return row;
  });
}

export async function assets() {
  const rows = await db`SELECT id, name, mime, octet_length(bytes) AS size, created_at FROM assets ORDER BY created_at DESC`;
  return rows.map((asset) => ({ ...asset, url: `/media/${asset.id}` }));
}

export async function addAsset(name, bytes) {
  if (!bytes.length || bytes.length > maxImageBytes) throw new StoreError(400, "Images must be 5 MB or smaller.");
  const signature = bytes.subarray(0, 12);
  const mime = signature.subarray(0, 3).equals(Buffer.from([255, 216, 255])) ? "image/jpeg"
    : signature.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) ? "image/png"
      : /^(GIF87a|GIF89a)/.test(signature.toString("ascii")) ? "image/gif"
        : /^RIFF....WEBP/s.test(signature.toString("latin1")) ? "image/webp" : null;
  if (!mime) throw new StoreError(400, "Choose a JPEG, PNG, WebP, or GIF image.");
  name = validate(text(160).min(1), name);
  const id = crypto.randomUUID();
  await db`INSERT INTO assets (id, name, mime, bytes) VALUES (${id}, ${name}, ${mime}, decode(${bytes.toString("base64")}, 'base64'))`;
  return { id, name, mime, url: `/media/${id}` };
}

export async function getAsset(id) {
  const [row] = await db`SELECT mime, bytes FROM assets WHERE id = ${id}`;
  return row;
}

export async function renameAsset(id, name) {
  const [row] = await db`UPDATE assets SET name = ${validate(text(160).min(1), name)} WHERE id = ${id} RETURNING id, name`;
  if (!row) throw new StoreError(404, "Image not found.");
  return row;
}

export async function removeAsset(id) {
  return db.begin(async (tx) => {
    const [asset] = await tx`SELECT id FROM assets WHERE id = ${id} FOR UPDATE`;
    if (!asset) throw new StoreError(404, "Image not found.");
    const url = `/media/${id}`;
    const [used] = await tx`
      SELECT 1 FROM products WHERE details->>'image' = ${url}
      UNION ALL
      SELECT 1 FROM storefront, jsonb_path_query(navigation, '$.types[*].sections[*].feature.image') AS image
      WHERE image = to_jsonb(${url}::text) LIMIT 1
    `;
    if (used) throw new StoreError(409, "This image is in use. Choose a replacement before removing it.");
    await tx`DELETE FROM assets WHERE id = ${id}`;
    return { id };
  });
}

export async function placeOrder(id, input) {
  const requestHash = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  return db.begin(async (tx) => {
    // Serialize retries of the same checkout, including when they land on different replicas.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${id}, 0))`;
    const [existing] = await tx`SELECT id, request_hash, total FROM orders WHERE id = ${id}`;
    if (existing) {
      if (existing.request_hash !== requestHash) throw new StoreError(409, "This checkout key has already been used.");
      return { id, total: existing.total };
    }
    const catalog = groupTshirts((await products(false, tx)).map((product) => ({ ...product, id: String(product.id) })));
    const items = input.items.map((item) => {
      const line = resolveCatalogLine(catalog, item.id);
      if (!line || Boolean(line.size) !== isShirt(line.product) || line.price !== item.price) {
        throw new StoreError(409, "A product or price in your cart changed. Refresh the store and review your cart.");
      }
      return {
        id: line.id, name: line.name, type: line.type, section: line.section,
        size: line.size, quantity: item.quantity, price: line.price, subtotal: line.price * item.quantity,
      };
    });
    const total = items.reduce((sum, item) => sum + item.subtotal, 0);
    if (total > 2_000_000_000) throw new StoreError(400, "This order is too large. Please place smaller orders.");
    await tx`
      INSERT INTO orders (id, request_hash, customer, items, total)
      VALUES (${id}, ${requestHash}, ${JSON.stringify(input.customer)}::text::jsonb, ${JSON.stringify(items)}::text::jsonb, ${total})
    `;
    return { id, total };
  });
}

export async function listOrders({ status, search = "", page = 1 } = {}) {
  const query = `%${search}%`;
  return db`
    SELECT id, customer, items, total, status, created_at, revision
    FROM orders WHERE (${status ?? ""} = '' OR status = ${status ?? ""})
      AND (customer->>'name' ILIKE ${query} OR customer->>'instagram' ILIKE ${query}
        OR customer->>'whatsapp' ILIKE ${query} OR id::text ILIKE ${query})
    ORDER BY created_at DESC, id DESC LIMIT 51 OFFSET ${(page - 1) * 50}
  `;
}

export async function orderSummary() {
  const [summary] = await db`
    SELECT count(*) FILTER (WHERE status = 'new')::int AS new,
      count(*) FILTER (WHERE status = 'confirmed')::int AS confirmed,
      count(*) FILTER (WHERE status = 'fulfilled')::int AS fulfilled,
      coalesce(sum(total) FILTER (WHERE status = 'fulfilled'), 0)::text AS revenue
    FROM orders
  `;
  return summary;
}

export async function updateOrder({ id, revision, status }) {
  const [row] = await db`
    UPDATE orders SET status = ${status}, revision = revision + 1
    WHERE id = ${id} AND revision = ${revision} RETURNING id, status, revision
  `;
  if (!row) throw new StoreError(409, "This order changed. Refresh and try again.");
  return row;
}
