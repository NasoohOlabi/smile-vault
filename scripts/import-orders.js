import { createHash } from "node:crypto";
import { db, initialize } from "../server/store.js";

const [source, file] = process.argv.slice(2);
if (!process.env.DATABASE_URL || !source || !/^[a-z0-9_-]{1,48}$/.test(source) || !file) {
  console.error("Set DATABASE_URL, then run bun run import-orders <source-name> <export.json>.");
  process.exit(1);
}

function integer(value) {
  const normalized = String(value ?? "").trim().replaceAll(",", "");
  const number = Number(normalized);
  if (!/^\d+$/.test(normalized) || !Number.isSafeInteger(number) || number > 2_000_000_000) {
    throw new Error("Expected a non-negative whole number.");
  }
  return number;
}

function items(value) {
  if (!value) return [];
  const lines = typeof value === "string" ? JSON.parse(value) : value;
  if (!Array.isArray(lines)) throw new Error("Items must be a JSON array.");
  return lines.map((line) => {
    const quantity = integer(line.quantity);
    const price = integer(line.price ?? 0);
    return {
      name: String(line.name || "Unnamed item"),
      quantity, price, subtotal: integer(line.subtotal ?? price * quantity),
      size: String(line.size ?? ""), section: String(line.category ?? ""),
    };
  });
}

function parseExport(rows) {
  if (!Array.isArray(rows)) throw new Error("Expected a JSON export containing an array of order rows.");
  const occurrences = new Map();
  return rows.flatMap((row, index) => {
    try {
      if (Object.values(row).every((value) => value == null || value === "")) return [];
      const timestamp = String(row.Timestamp ?? "").trim();
      if (!/^\d{4}-\d{2}-\d{2}(?:T.+(?:Z|[+-]\d{2}:?\d{2}))?$/.test(timestamp)) {
        throw new Error("Timestamp must be an ISO date or date-time with an offset.");
      }
      const date = new Date(timestamp).toISOString();
      const identity = `${source}:${date}`;
      const occurrence = (occurrences.get(identity) ?? 0) + 1;
      occurrences.set(identity, occurrence);
      const hash = createHash("sha256").update(`${identity}:${occurrence}`).digest("hex");
      const id = `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-a${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
      return [{
        id, hash, date, items: items(row.Items), total: integer(row.Total),
        status: String(row.Delivered).toLowerCase() === "true" ? "fulfilled" : "new",
        customer: {
          name: String(row.Name ?? "").trim() || "Unnamed customer",
          whatsapp: String(row["WA number"] ?? ""), phone: String(row.Phone ?? ""),
          instagram: String(row["Insta Account"] ?? ""), pickup: String(row["Pickup / delivery"] ?? ""),
          notes: String(row.Notes ?? ""), source,
        },
      }];
    } catch (error) {
      throw new Error(`Row ${index + 1} has an invalid timestamp, total, or item list.`, { cause: error });
    }
  });
}

try {
  const rows = parseExport(await Bun.file(file).json().catch(() => { throw new Error("Could not read the JSON export."); }));
  await initialize();
  const inserted = await db.begin(async (tx) => {
    let count = 0;
    for (const row of rows) {
      const result = await tx`
        INSERT INTO orders (id, request_hash, customer, items, total, status, created_at)
        VALUES (${row.id}, ${row.hash}, ${JSON.stringify(row.customer)}::text::jsonb,
          ${JSON.stringify(row.items)}::text::jsonb, ${row.total}, ${row.status}, ${row.date})
        ON CONFLICT (id) DO NOTHING RETURNING id
      `;
      count += result.length;
    }
    return count;
  });
  console.log(`Imported ${inserted} orders. Skipped ${rows.length - inserted} previously imported orders.`);
} catch (error) {
  console.error(error.code ? `Database import failed (${error.code}).` : error.message);
  process.exitCode = 1;
} finally {
  await db.close();
}
