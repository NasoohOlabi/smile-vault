import { logEvent } from "firebase/analytics";
import { analytics as analyticsRef, whenAnalytics } from "./firebase.js";

export const CURRENCY = "SYP";

const LIST_ITEM_CAP = 20;
const queue = [];
let ready = false;

function debugMode() {
	try {
		return new URLSearchParams(location.search).has("debug_mode");
	} catch {
		return false;
	}
}

function flush(a) {
	ready = true;
	while (queue.length) {
		const { name, params } = queue.shift();
		try {
			logEvent(a, name, params);
		} catch { /* ignore */ }
	}
}

whenAnalytics.then((a) => {
	if (a) flush(a);
	else {
		ready = true;
		queue.length = 0;
	}
});

/** Fire a GA4 event; queues until Analytics is ready; no-op if unsupported. */
export function track(name, params = {}) {
	const payload = { ...params };
	if (debugMode()) payload.debug_mode = true;

	const a = analyticsRef;
	if (a && ready) {
		try {
			logEvent(a, name, payload);
		} catch { /* never break the storefront for telemetry */ }
		return;
	}
	if (!ready) queue.push({ name, params: payload });
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
