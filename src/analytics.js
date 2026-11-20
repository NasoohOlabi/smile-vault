export const CURRENCY = "SYP";
export const ANALYTICS_ENABLED = import.meta.env.VITE_ENABLE_ANALYTICS === "true";

const LIST_ITEM_CAP = 20;
const telemetry = ANALYTICS_ENABLED
	? import("./firebase.js").catch(() => null)
	: null;

function debugMode() {
	try {
		return new URLSearchParams(location.search).has("debug_mode");
	} catch {
		return false;
	}
}

/** Wait for opt-in analytics without delaying storefront rendering. */
export function track(name, params = {}) {
	if (!telemetry) return;
	const payload = { ...params };
	if (debugMode()) payload.debug_mode = true;
	void telemetry.then((module) => module?.sendEvent(name, payload));
}

export function trackPageView({ path, title } = {}) {
	track("page_view", {
		page_path: path ?? `${location.pathname}${location.search}${location.hash}`,
		page_title: title ?? document.title,
		page_location: location.href,
	});
}

/** Map a cart/catalog line to a GA4 item. */
export function itemFromLine(line, qty = 1) {
	if (!line) return null;
	const item = {
		item_id: String(line.id),
		item_name: line.name,
		price: Number(line.price) || 0,
		quantity: qty,
	};
	if (line.type) item.item_category = String(line.type);
	if (line.section) item.item_category2 = String(line.section);
	if (line.size) item.item_variant = String(line.size);
	return item;
}

/**
 * @param {(id: string) => object | null} resolveLine
 * @param {Record<string, number>} cart
 */
export function itemsFromCart(resolveLine, cart) {
	const items = [];
	for (const [id, qty] of Object.entries(cart || {})) {
		if (!(qty > 0)) continue;
		const item = itemFromLine(resolveLine(id), qty);
		if (item) items.push(item);
	}
	return items;
}

export function listId(cat, section) {
	return `${cat || "shop"}/${section || "all"}`;
}

/** Cap list payloads for view_item_list / select_item. */
export function capItems(items, cap = LIST_ITEM_CAP) {
	return (items || []).slice(0, cap);
}
