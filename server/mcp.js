import { createMcpHandler, McpServer } from "@modelcontextprotocol/server";
import { z } from "zod";
import {
  addAsset, assetId, assets, collectionInput, copyInput, listOrders, orderSummary,
  orderUpdateInput, productInput, products, removeAsset, renameAsset, saveCollection,
  saveCopy, saveProduct, settings, statuses, StoreError, updateOrder, updateProductInput,
} from "./store.js";

export const mcp = createMcpHandler(() => {
  const server = new McpServer({ name: "dama-store-nightly", version: "1.0.0" });
  function tool(name, description, inputSchema, run, annotations = { readOnlyHint: true }) {
    server.registerTool(name, { description, inputSchema, annotations }, async (input) => {
      try {
        const data = await run(input);
        return { content: [{ type: "text", text: JSON.stringify(data) }] };
      } catch (error) {
        if (!(error instanceof StoreError)) console.error("MCP operation failed", name, error.code ?? error.name);
        return {
          isError: true,
          content: [{ type: "text", text: error instanceof StoreError ? error.message : "The operation failed. Try again." }],
        };
      }
    });
  }
  const write = { readOnlyHint: false, destructiveHint: false };
  tool("list_orders", "List up to 50 nightly orders with item and fulfillment details. Free-text customer notes and contact details are omitted unless requested.", z.object({
    status: statuses.optional(), search: z.string().max(100).optional(),
    page: z.number().int().min(1).max(1000).optional(), includeContact: z.boolean().optional(),
  }), async ({ includeContact, ...query }) => {
    const rows = await listOrders(query);
    return {
      hasMore: rows.length > 50,
      orders: rows.slice(0, 50).map(({ customer, ...order }) => ({
        ...order, customer: includeContact ? customer : { name: customer.name, pickup: customer.pickup },
      })),
    };
  });
  tool("order_summary", "Count nightly orders by fulfillment status and sum fulfilled order revenue.", z.object({}), orderSummary);
  tool("update_order_status", "Set a nightly order to new, confirmed, fulfilled, or cancelled. Use its current revision from list_orders.", orderUpdateInput, updateOrder, write);
  tool("list_products", "List nightly product entries, variants, prices, publication state, and revisions.", z.object({
    search: z.string().max(120).optional(),
  }), async ({ search }) => (await products(true)).filter((product) =>
    !search || product.name.toLowerCase().includes(search.toLowerCase())));
  tool("create_product", "Create one product or variant. Use the same name for variants of the same design and an image URL from the asset library.", productInput, saveProduct, write);
  tool("update_product", "Replace one product entry using its current revision. Use published=false to hide it.", updateProductInput, saveProduct, write);
  tool("get_storefront", "Read the nightly storefront copy, collections, features, and revision.", z.object({}), () => settings());
  tool("publish_storefront_copy", "Publish the nightly announcement and page introductions. Send all three text fields and the current storefront revision.", copyInput, saveCopy, write);
  tool("update_collection", "Change the label of an existing category or the label and feature of an existing section. Use get_storefront for IDs and revision.", collectionInput, saveCollection, write);
  tool("list_assets", "List uploaded images and their storefront URLs.", z.object({}), assets);
  tool("upload_image", "Upload a base64-encoded JPEG, PNG, WebP, or GIF up to 5 MB. Returns its storefront URL.", z.object({
    name: z.string().trim().min(1).max(160), base64: z.base64().max(6_990_508),
  }), ({ name, base64 }) => addAsset(name, Buffer.from(base64, "base64")), write);
  tool("rename_image", "Rename an uploaded image without changing its storefront URL.", z.object({
    id: assetId, name: z.string().trim().min(1).max(160),
  }), ({ id, name }) => renameAsset(id, name), write);
  tool("remove_unused_image", "Permanently remove an uploaded image only if it is unused by products and collection features.", z.object({
    id: assetId,
  }), ({ id }) => removeAsset(id), { readOnlyHint: false, destructiveHint: true });
  return server;
});
