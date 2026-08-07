/* ============================================================
 * DAMA OBSRV — storefront
 * Styles: ./input.css (Tailwind via Vite HMR)
 * ============================================================ */

import {
	CURRENCY,
	capItems,
	itemFromLine,
	itemsFromCart,
	listId,
	track,
	trackPageView,
} from "./analytics.js";

const SHEETDB_URL = "https://sheetdb.io/api/v1/jog7er8l976bz";
const CART_KEY = "dama_cart_v2";

const assetUrl = (path) => (window.DAMA_BASE || "") + path;

const money = (n) => `${n.toLocaleString("en-US")} ليرة سوري`;
const itemsCount = (n) => `${n} ${n === 1 ? "item" : "items"}`;
/* Shop tabs + sections — loaded from catalog-nav.json (built from catalog/shop/) */
let TYPE_SECTIONS = {};
let PRODUCT_TYPES = [];
const sectionsFor = (type) => TYPE_SECTIONS[type] || [];
const sectionLabel = (type, id) => {
	const sections = sectionsFor(type);
	const direct = sections.find((s) => s.id === id);
	if (direct) return direct.label;
	const grouped = sections.find((s) => s.categories?.includes(id));
	return grouped?.label || id;
};

function applyCatalogNav(nav) {
	const types = Array.isArray(nav?.types) ? nav.types : [];
	PRODUCT_TYPES = types.map((t) => t.id).filter(Boolean);
	TYPE_SECTIONS = Object.fromEntries(
		types.map((t) => [t.id, Array.isArray(t.sections) ? t.sections : []]),
	);
	if (!PRODUCT_TYPES.includes(activeCat)) {
		activeCat = PRODUCT_TYPES[0] || "Posters";
	}
	const sections = sectionsFor(activeCat);
	if (!sections.length) activeSection = null;
	else if (!sections.some((s) => s.id === activeSection)) activeSection = sections[0].id;
}

/* Arabic product names need RTL even though the shell is LTR English. */
const textDir = (s) => (/[\u0600-\u06FF]/.test(s) ? "rtl" : "ltr");

/* ---------- state ---------- */
const VIEWS = ["shop", "observatory", "about"];

let products = [];
let cart = loadCart();
let activeView = "shop";
let activeCat = "Posters";
let activeSection = null;
let visible = [];   // currently rendered products (drives lightbox nav)
let lbIndex = -1;
let obsBuilt = false;
let lastViewedItemId = null;
let lastPageKey = "";

/* ---------- cart persistence (+ migration from legacy p_<id> keys) ---------- */
function loadCart() {
	let c = {};
	try {
		c = JSON.parse(localStorage.getItem(CART_KEY) || "{}");
	} catch { c = {}; }

	// Legacy carts stored one localStorage key per product: p_12 = "3"
	const legacy = Object.keys(localStorage).filter((k) => /^p_\d+$/.test(k));
	if (legacy.length) {
		legacy.forEach((key) => {
			const qty = parseInt(localStorage.getItem(key) || "0", 10);
			const id = key.slice(2);
			if (qty > 0 && !c[id]) c[id] = qty;
			localStorage.removeItem(key);
		});
		localStorage.setItem(CART_KEY, JSON.stringify(c));
	}
	return c;
}

const saveCart = () => localStorage.setItem(CART_KEY, JSON.stringify(cart));
const qtyOf = (id) => cart[id] || 0;
const cartCount = () => Object.values(cart).reduce((a, b) => a + b, 0);
const cartTotal = () =>
	Object.entries(cart).reduce((sum, [id, q]) => {
		const line = resolveLine(id);
		return line ? sum + line.price * q : sum;
	}, 0);

const buzz = (ms = 8) => { try { navigator.vibrate?.(ms); } catch { } };

function setQty(id, qty) {
	const prev = qtyOf(id);
	qty = Math.max(0, qty);
	if (qty === 0) delete cart[id]; else cart[id] = qty;
	saveCart();
	syncQtyUI(id);
	renderCartBody();
	updateTotals();
	if (qty !== prev) buzz();
	if (qty > prev) {
		toast("Added to cart");
		const line = resolveLine(id);
		const delta = qty - prev;
		const item = itemFromLine(line, delta);
		if (item) {
			track("add_to_cart", {
				currency: CURRENCY,
				value: (line?.price || 0) * delta,
				items: [item],
			});
		}
	} else if (qty < prev) {
		if (qty === 0) toast("Removed from cart");
		const line = resolveLine(id);
		const delta = prev - qty;
		const item = itemFromLine(line, delta);
		if (item) {
			track("remove_from_cart", {
				currency: CURRENCY,
				value: (line?.price || 0) * delta,
				items: [item],
			});
		}
	}
}

function trackCurrentPage() {
	const path = `${location.pathname}${location.search}${location.hash || ""}`;
	const title = document.title;
	const key = `${path}|${title}`;
	if (key === lastPageKey) return;
	lastPageKey = key;
	trackPageView({ path, title });
}

function shopListMeta() {
	const id = listId(activeCat, activeSection);
	const sec = activeSectionMeta()?.label;
	const name = sec ? `${activeCat} · ${sec}` : String(activeCat || "shop");
	return { item_list_id: id, item_list_name: name };
}

function trackViewItem(line) {
	if (!line) return;
	const id = String(line.id);
	if (id === lastViewedItemId) return;
	lastViewedItemId = id;
	const item = itemFromLine(line);
	if (!item) return;
	track("view_item", {
		currency: CURRENCY,
		value: line.price || 0,
		...shopListMeta(),
		items: [item],
	});
}

const changeQty = (id, delta) => setQty(id, qtyOf(id) + delta);

/* ---------- t-shirt variants ----------
 * Filenames: Design_B / Design_W / Design_B_F / Design_W_F
 *   Color codes: B black · W white · BL blue
 *   Side: bare color = back · _F = front · Color_B = explicit back
 * Color is the purchasable SKU; front/back is preview only.
 */
const TSHIRT_COLOR = {
	B: { label: "Black", swatch: "#141414", border: "rgb(255 255 255 / 0.35)" },
	W: { label: "White", swatch: "#f4f4f4", border: "rgb(0 0 0 / 0.25)" },
	BL: { label: "Blue", swatch: "#1d4ed8", border: "rgb(255 255 255 / 0.35)" },
};
const TSHIRT_COLOR_ORDER = { B: 0, W: 1, BL: 2, "": 3 };
const shirtView = new Map(); // groupId → { colorId, side }

function imageStem(image) {
	const file = String(image || "").split(/[/\\]/).pop() || "";
	return file.replace(/\.[^.]+$/, "");
}

function parseTshirtStem(stem) {
	const parts = String(stem || "").split("_").filter(Boolean);
	if (parts.length <= 1) return { base: stem, color: "", side: "" };

	let side = "";
	const rest = [...parts];
	const last = rest[rest.length - 1];
	const prev = rest[rest.length - 2];

	if (last === "F") {
		side = "front";
		rest.pop();
	} else if (rest.length >= 3 && last === "B" && Object.hasOwn(TSHIRT_COLOR, prev)) {
		side = "back";
		rest.pop();
	}

	let color = "";
	if (rest.length >= 2 && Object.hasOwn(TSHIRT_COLOR, rest[rest.length - 1])) {
		color = rest.pop();
	}

	if (color && !side) side = "back";
	return { base: rest.join("_") || stem, color, side };
}

function groupTshirts(raw) {
	const others = [];
	const buckets = new Map();

	for (const p of raw) {
		if ((p.type || "") !== "Tshirts") {
			others.push(p);
			continue;
		}
		const parsed = parseTshirtStem(imageStem(p.image));
		const color = p.variantColor != null && p.variantColor !== ""
			? String(p.variantColor)
			: parsed.color;
		const side = p.variantSide || parsed.side || "back";
		const key = parsed.base || p.title || p.name;
		if (!buckets.has(key)) buckets.set(key, []);
		buckets.get(key).push({ ...p, _color: color, _side: side });
	}

	const grouped = [];
	for (const [base, items] of buckets) {
		if (items.length === 1 && !items[0]._color && items[0]._side === "back") {
			const only = items[0];
			delete only._color;
			delete only._side;
			if (only.title) only.name = only.title;
			grouped.push(only);
			continue;
		}

		const byColor = new Map();
		let defaultColorCode = null;
		let defaultSide = null;
		for (const item of items) {
			const code = item._color || "";
			if (item.variantDefault && defaultColorCode == null) {
				defaultColorCode = code;
				if (item.defaultSide === "front" || item.defaultSide === "back") {
					defaultSide = item.defaultSide;
				}
			}
			if (!byColor.has(code)) {
				byColor.set(code, {
					id: String(item.id),
					code,
					label: TSHIRT_COLOR[code]?.label || "Default",
					swatch: TSHIRT_COLOR[code]?.swatch || "#888",
					border: TSHIRT_COLOR[code]?.border || "rgb(255 255 255 / 0.35)",
					price: item.price,
					images: {},
				});
			}
			const slot = byColor.get(code);
			const side = item._side === "front" ? "front" : "back";
			if (!slot.images[side]) {
				slot.images[side] = item.image;
			} else if (side === "back" && !slot.images.front) {
				// e.g. SL_BL + SL_BL_B — bare color shot is front, explicit _B is back
				slot.images.front = slot.images.back;
				slot.images.back = item.image;
			}
			// Prefer an explicit color SKU id over a bare/default file id
			if (item._color && slot.id !== String(item.id) && !slot._lockedId) {
				slot.id = String(item.id);
			}
			if (item._color) slot._lockedId = true;
		}

		const colors = [...byColor.values()]
			.map(({ _lockedId, ...c }) => c)
			.sort((a, b) => {
				if (defaultColorCode != null) {
					if (a.code === defaultColorCode && b.code !== defaultColorCode) return -1;
					if (b.code === defaultColorCode && a.code !== defaultColorCode) return 1;
				}
				return (TSHIRT_COLOR_ORDER[a.code] ?? 9) - (TSHIRT_COLOR_ORDER[b.code] ?? 9);
			});

		const primary = colors[0];
		const thumbSide =
			defaultSide && primary.images[defaultSide]
				? defaultSide
				: primary.images.front
					? "front"
					: "back";
		const thumb =
			primary.images[thumbSide] ||
			primary.images.front ||
			primary.images.back ||
			items[0].image;
		const title =
			items.find((i) => i.title)?.title ||
			items.find((i) => i.name && i.name !== base)?.name ||
			base;

		const groupedProduct = {
			id: `t-${base}`,
			name: title,
			title,
			price: primary.price,
			image: thumb,
			type: "Tshirts",
			category: items[0].category || "tshirts",
			section: items[0].section,
			colors,
			skuIds: colors.map((c) => c.id),
		};
		if (defaultColorCode != null) groupedProduct.defaultColor = defaultColorCode;
		if (defaultSide) groupedProduct.defaultSide = defaultSide;
		grouped.push(groupedProduct);
	}

	return [...others, ...grouped];
}

function shirtSelection(p) {
	if (!p?.colors?.length) return null;
	let sel = shirtView.get(p.id);
	if (!sel || !p.colors.some((c) => c.id === sel.colorId)) {
		const color =
			(p.defaultColor != null &&
				p.colors.find((c) => c.code === p.defaultColor)) ||
			p.colors[0];
		const side =
			p.defaultSide && color.images[p.defaultSide]
				? p.defaultSide
				: color.images.front
					? "front"
					: "back";
		sel = { colorId: color.id, side };
		shirtView.set(p.id, sel);
	}
	return sel;
}

function shirtColor(p, colorId = shirtSelection(p)?.colorId) {
	if (!p?.colors?.length) return null;
	return p.colors.find((c) => c.id === colorId) || p.colors[0];
}

function shirtImage(p, sel = shirtSelection(p)) {
	if (!p?.colors?.length) return p?.image;
	const color = shirtColor(p, sel?.colorId);
	if (!color) return p.image;
	const side = sel?.side || "back";
	return color.images[side] || color.images.front || color.images.back || p.image;
}

function setShirtColor(p, colorId) {
	const color = shirtColor(p, colorId);
	if (!color) return;
	const sel = shirtSelection(p);
	const side = color.images[sel.side]
		? sel.side
		: (color.images.front ? "front" : "back");
	shirtView.set(p.id, { colorId: color.id, side });
}

function setShirtSide(p, side) {
	const sel = shirtSelection(p);
	const color = shirtColor(p, sel.colorId);
	if (!color?.images[side]) return;
	shirtView.set(p.id, { ...sel, side });
}

function activeSkuId(p) {
	if (p?.colors?.length) return shirtSelection(p).colorId;
	return p.id;
}

function resolveLine(id) {
	id = String(id);
	for (const p of products) {
		if (p.colors?.length) {
			const color = p.colors.find((c) => c.id === id);
			if (color) {
				return {
					id: color.id,
					name: `${p.name} · ${color.label}`,
					price: color.price ?? p.price,
					image: color.images.front || color.images.back || p.image,
					type: p.type,
					section: productSection(p),
					product: p,
					color,
				};
			}
			continue;
		}
		if (p.id === id) {
			return {
				id: p.id,
				name: p.name,
				price: p.price,
				image: p.image,
				type: p.type,
				section: productSection(p),
				product: p,
				color: null,
			};
		}
	}
	return null;
}

function findDisplayProduct(id) {
	id = String(id);
	const direct = products.find((p) => p.id === id);
	if (direct) return { product: direct, colorId: direct.colors?.[0]?.id || null };
	for (const p of products) {
		if (p.colors?.some((c) => c.id === id)) {
			return { product: p, colorId: id };
		}
	}
	return null;
}

function renderShirtControls(host, p, { onChange } = {}) {
	if (!host || !p?.colors?.length) {
		if (host) {
			host.hidden = true;
			host.innerHTML = "";
		}
		return;
	}

	const sel = shirtSelection(p);
	const color = shirtColor(p, sel.colorId);
	const hasMultiColor = p.colors.length > 1;
	const hasFront = !!color.images.front;
	const hasBack = !!color.images.back;
	const hasSides = hasFront && hasBack;

	if (!hasMultiColor && !hasSides) {
		host.hidden = true;
		host.innerHTML = "";
		return;
	}

	host.hidden = false;
	host.innerHTML = "";
	host.className = "flex w-full flex-col items-center gap-2.5 sm:items-start";

	if (hasMultiColor) {
		const row = document.createElement("div");
		row.className = "flex flex-wrap items-center justify-center gap-2 sm:justify-start";
		row.setAttribute("role", "radiogroup");
		row.setAttribute("aria-label", "Color");
		p.colors.forEach((c) => {
			const btn = document.createElement("button");
			btn.type = "button";
			const on = c.id === color.id;
			btn.className =
				"h-8 w-8 rounded-full border-2 transition-transform duration-150 active:scale-90 " +
				(on ? "scale-110 border-kiosk-lime" : "border-transparent opacity-80");
			btn.style.background = c.swatch;
			btn.style.boxShadow = `inset 0 0 0 1px ${c.border}`;
			btn.setAttribute("aria-label", c.label);
			btn.setAttribute("aria-checked", String(on));
			btn.setAttribute("role", "radio");
			btn.title = c.label;
			btn.onclick = (e) => {
				e.stopPropagation();
				setShirtColor(p, c.id);
				onChange?.();
			};
			row.appendChild(btn);
		});
		host.appendChild(row);
	}

	if (hasSides) {
		const row = document.createElement("div");
		row.className =
			"inline-flex h-9 overflow-hidden rounded-kiosk-md border border-kiosk-border bg-black/20";
		row.setAttribute("role", "radiogroup");
		row.setAttribute("aria-label", "View");
		[["front", "Front"], ["back", "Back"]].forEach(([side, label]) => {
			const btn = document.createElement("button");
			btn.type = "button";
			const on = sel.side === side;
			btn.className =
				"h-full min-w-[4.25rem] px-3 text-xs font-semibold tracking-[0.02em] transition-[background,color] duration-150 " +
				(on ? "bg-kiosk-lime text-[#111]" : "bg-transparent text-kiosk-muted");
			btn.textContent = label;
			btn.setAttribute("aria-checked", String(on));
			btn.setAttribute("role", "radio");
			btn.onclick = (e) => {
				e.stopPropagation();
				setShirtSide(p, side);
				onChange?.();
			};
			row.appendChild(btn);
		});
		host.appendChild(row);
	}
}

/* ---------- data ---------- */
async function fetchProducts() {
	const [navRes, res] = await Promise.all([
		fetch(assetUrl("catalog-nav.json")),
		fetch(assetUrl("products.json")),
	]);
	if (!navRes.ok) throw new Error(`catalog-nav.json → ${navRes.status}`);
	if (!res.ok) throw new Error(`products.json → ${res.status}`);

	applyCatalogNav(await navRes.json());

	const data = await res.json();
	const raw = data.map((p) => ({ ...p, id: String(p.id) }));
	products = groupTshirts(raw);

	const validIds = new Set();
	for (const p of products) {
		if (p.colors?.length) p.colors.forEach((c) => validIds.add(c.id));
		else validIds.add(p.id);
	}

	// Drop cart entries for products that no longer exist
	let pruned = false;
	for (const id of Object.keys(cart)) {
		if (!validIds.has(id)) { delete cart[id]; pruned = true; }
	}
	if (pruned) saveCart();
}

/* ---------- routing / deeplinks ----------
 * #shop · #shop/stickers · #shop/stickers/nuggets
 * #p/42 · #observatory · #about
 * Bare category anchors also work: #stickers/nuggets
 */
const SITE_TITLE = "DAMA OBSRV — Syrian Stickers & Prints";
const catSlug = (type) => String(type || "").toLowerCase();
const catFromSlug = (slug) =>
	PRODUCT_TYPES.find((t) => catSlug(t) === String(slug || "").toLowerCase()) || null;

let routeQuiet = false;
let pendingProductId = null;

function parseHash(hash = location.hash) {
	const raw = String(hash || "").replace(/^#/, "").trim();
	const parts = raw.split("/").filter(Boolean).map((p) => decodeURIComponent(p).toLowerCase());
	const head = parts[0] || "shop";

	if (head === "top" || head === "home") {
		return { view: "shop", cat: null, section: null, productId: null };
	}
	if (head === "p" || head === "product") {
		return { view: "shop", cat: null, section: null, productId: parts[1] || null };
	}
	if (head === "observatory" || head === "obsrv" || head === "osevator") {
		return { view: "observatory", cat: null, section: null, productId: null };
	}
	if (head === "about" || head === "about-us" || head === "aboutus") {
		return { view: "about", cat: null, section: null, productId: null };
	}

	const typePart = head === "shop" || head === "giftshop" ? parts[1] : catFromSlug(head) ? head : null;
	const sectionPart = head === "shop" || head === "giftshop" ? parts[2] : parts[1];
	const cat = catFromSlug(typePart) || null;
	const sections = cat ? sectionsFor(cat) : [];
	let section = null;
	if (sections.length) {
		section = sections.find((s) => s.id === sectionPart)?.id || sections[0].id;
	}
	return { view: "shop", cat, section, productId: null };
}

function shopHash(cat = activeCat, section = activeSection) {
	const parts = ["shop"];
	if (cat) {
		parts.push(catSlug(cat));
		if (section && sectionsFor(cat).length) parts.push(section);
	}
	return `#${parts.join("/")}`;
}

function productHash(id) {
	return `#p/${encodeURIComponent(String(id))}`;
}

function routeHash(view = activeView, cat = activeCat, section = activeSection) {
	if (view === "about") return "#about";
	if (view === "observatory") return "#observatory";
	if (lbIndex >= 0 && visible[lbIndex]) return productHash(activeSkuId(visible[lbIndex]));
	return shopHash(cat, section);
}

function shareUrl(hash = routeHash()) {
	return `${location.origin}${location.pathname}${location.search}${hash}`;
}

function setHash(next, { push = false } = {}) {
	if (routeQuiet) return;
	if ((location.hash || "") === next) return;
	if (push) history.pushState(null, "", next);
	else history.replaceState(null, "", next);
}

function syncHash({ push = false } = {}) {
	setHash(routeHash(), { push });
	setDocumentTitle();
}

function setDocumentTitle() {
	if (lbIndex >= 0 && visible[lbIndex]) {
		document.title = `${visible[lbIndex].name} — DAMA OBSRV`;
	} else if (activeView === "observatory") {
		document.title = "The Observatory — DAMA OBSRV";
	} else if (activeView === "about") {
		document.title = "About Us — DAMA OBSRV";
	} else if (activeCat) {
		const sec = activeSectionMeta()?.label;
		document.title = sec
			? `${sec} · ${activeCat} — DAMA OBSRV`
			: `${activeCat} — DAMA OBSRV`;
	} else {
		document.title = SITE_TITLE;
	}
	trackCurrentPage();
}

function applyShopSelection(cat, section, { render = true } = {}) {
	const nextCat = catFromSlug(cat) || (PRODUCT_TYPES.includes(cat) ? cat : null) || activeCat || "Posters";
	activeCat = nextCat;
	const sections = sectionsFor(activeCat);
	if (!sections.length) activeSection = null;
	else if (section && sections.some((s) => s.id === section)) activeSection = section;
	else activeSection = sections[0].id;

	if (render && products.length) {
		renderFilters();
		renderSectionSubnav();
		renderGrid();
	}
}

function openProductById(id, { pushHash = false } = {}) {
	const found = findDisplayProduct(id);
	if (!found) {
		pendingProductId = null;
		toast("Design not found", "err");
		syncHash();
		return false;
	}
	const { product, colorId } = found;
	if (colorId && product.colors?.length) setShirtColor(product, colorId);
	applyShopSelection(productType(product), productSection(product), { render: true });
	const index = visible.findIndex((p) => p.id === product.id);
	if (index < 0) {
		pendingProductId = null;
		toast("Design not found", "err");
		syncHash();
		return false;
	}
	pendingProductId = null;
	if (!allowsLightbox(product)) {
		syncHash();
		return true;
	}
	openLightbox(index, { pushHash, fromRoute: true });
	return true;
}

function applyRouteFromHash({ scroll = false } = {}) {
	const { view, cat, section, productId } = parseHash();
	routeQuiet = true;
	try {
		if (productId) {
			pendingProductId = String(productId);
			paintView("shop");
			if (products.length) openProductById(pendingProductId, { pushHash: false });
		} else {
			pendingProductId = null;
			if (lbIndex >= 0) closeLightbox({ sync: false });
			paintView(view);
			if (view === "shop") applyShopSelection(cat || activeCat, section, { render: !!products.length });
		}
		setDocumentTitle();
		if (scroll && lbIndex < 0) window.scrollTo({ top: 0, behavior: "auto" });
	} finally {
		routeQuiet = false;
	}
}

function paintView(view) {
	if (!VIEWS.includes(view)) view = "shop";
	activeView = view;

	document.querySelectorAll("[data-view-panel]").forEach((el) => {
		el.hidden = el.dataset.viewPanel !== view;
	});
	document.querySelectorAll("[data-shop-only]").forEach((el) => {
		if (view !== "shop") el.hidden = true;
		else if (el.id === "sectionSubnav") renderSectionSubnav();
		else el.hidden = false;
	});

	document.querySelectorAll("#topNav [data-view]").forEach((btn) => {
		const on = btn.dataset.view === view;
		btn.hidden = on;
		btn.classList.toggle("is-active", on);
		btn.setAttribute("aria-current", on ? "page" : "false");
	});

	if (view === "observatory") renderObservatory();
}

function setView(view, { pushHash = true, scroll = true } = {}) {
	if (lbIndex >= 0) closeLightbox({ sync: false });
	pendingProductId = null;
	paintView(view);
	if (view === "shop" && products.length) {
		renderFilters();
		renderSectionSubnav();
		renderGrid();
	}
	if (pushHash) syncHash();
	else setDocumentTitle();
	if (scroll) window.scrollTo({ top: 0, behavior: "auto" });
}

async function shareCurrent() {
	const url = shareUrl();
	const product = lbIndex >= 0 ? visible[lbIndex] : null;
	const title = product ? `${product.name} — DAMA OBSRV` : document.title;
	const text = product
		? `${product.name} from DAMA OBSRV`
		: "DAMA OBSRV — Syrian stickers and prints";
	const shareItemId = product ? String(activeSkuId(product)) : undefined;

	try {
		if (navigator.share) {
			await navigator.share({ title, text, url });
			track("share", {
				method: "navigator",
				content_type: product ? "product" : "page",
				item_id: shareItemId,
			});
			return;
		}
	} catch (err) {
		if (err?.name === "AbortError") return;
	}

	try {
		await navigator.clipboard.writeText(url);
		toast("Link copied");
		track("share", {
			method: "clipboard",
			content_type: product ? "product" : "page",
			item_id: shareItemId,
		});
	} catch {
		toast("Couldn't copy link", "err");
	}
}

function renderObservatory() {
	const collage = document.getElementById("obsCollage");
	if (!collage || !products.length) return;
	if (obsBuilt && collage.childElementCount) return;

	const pool = products.slice();
	for (let i = pool.length - 1; i > 0; i--) {
		const j = Math.floor(Math.random() * (i + 1));
		[pool[i], pool[j]] = [pool[j], pool[i]];
	}
	const picks = pool.slice(0, 12);
	const layouts = [
		"", "is-blurred", "is-revealed", "is-blurred col-span-2",
		"is-revealed", "is-blurred", "is-revealed row-span-2 aspect-auto min-h-full", "is-blurred",
		"is-revealed", "is-blurred", "is-revealed", "is-blurred",
	];
	const tileBase = "relative aspect-square overflow-hidden rounded-kiosk-md bg-kiosk-elevated animate-obs-fade-in is-blurred:after:pointer-events-none is-blurred:after:absolute is-blurred:after:inset-0 is-blurred:after:bg-kiosk/30 is-blurred:after:content-[''] [&_img]:h-full [&_img]:w-full [&_img]:object-contain [&_img]:p-2 [&_img]:transition-[filter,transform,opacity] [&_img]:duration-500 is-blurred:[&_img]:scale-[1.08] is-blurred:[&_img]:opacity-55 is-blurred:[&_img]:blur-[10px] is-blurred:[&_img]:saturate-[0.7] is-revealed:[&_img]:opacity-100 is-revealed:[&_img]:blur-none";

	collage.innerHTML = picks.map((p, i) => {
		const mods = layouts[i] || "is-blurred";
		return `<figure class="${tileBase} ${mods}" style="animation-delay:${i * 40}ms">
			<img src="${encodeURI(assetUrl(p.image))}" alt="" loading="lazy" decoding="async"
				onerror="this.style.opacity=.15" />
		</figure>`;
	}).join("");
	obsBuilt = true;
}

function initTopNav() {
	document.querySelectorAll("#topNav [data-view]").forEach((el) => {
		el.addEventListener("click", (e) => {
			e.preventDefault();
			setView(el.dataset.view);
		});
	});
	addEventListener("hashchange", () => applyRouteFromHash({ scroll: true }));
	addEventListener("popstate", () => {
		if (!document.getElementById("cartDrawer").hidden) {
			closeCart();
			return;
		}
		applyRouteFromHash({ scroll: true });
	});
	applyRouteFromHash({ scroll: false });
}

/* ---------- rendering ---------- */
function renderFilters() {
	const wrap = document.getElementById("filterTrack");
	if (!wrap) return;
	wrap.innerHTML = "";
	const chipCls = "inline-flex h-10 shrink-0 snap-start items-center rounded-none border border-transparent bg-transparent px-[1.05rem] text-sm font-normal tracking-[0.02em] text-kiosk-fg no-underline transition-[transform,background,color] duration-150 active:scale-95 is-active:relative is-active:z-[1] is-active:mb-[-3px] is-active:rounded-t-[0.7rem] is-active:border-kiosk-lime is-active:border-b-[3px] is-active:bg-kiosk-lime is-active:font-bold is-active:text-[#111]";
	const make = (key, label) => {
		const b = document.createElement("a");
		b.href = shopHash(key, sectionsFor(key)[0]?.id || null);
		b.dataset.cat = key;
		b.setAttribute("aria-pressed", String(activeCat === key));
		b.textContent = label;
		b.className = chipCls + (activeCat === key ? " is-active" : "");
		b.onclick = (e) => {
			e.preventDefault();
			activeCat = key;
			activeSection = sectionsFor(key)[0]?.id || null;
			track("select_content", {
				content_type: "shop_category",
				content_id: key,
			});
			if (lbIndex >= 0) closeLightbox({ sync: false });
			syncHash();
			renderFilters();
			renderSectionSubnav();
			renderGrid();
			document
				.querySelector(`#filterNav [data-cat="${CSS.escape(key)}"]`)
				?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
		};
		return b;
	};
	PRODUCT_TYPES.forEach((type) => wrap.appendChild(make(type, type)));
}

function activeSectionMeta() {
	return sectionsFor(activeCat).find((s) => s.id === activeSection) || null;
}

function productType(p) {
	return p.type || "Stickers";
}

function productSection(p) {
	return p.section || p.category;
}

/* Nuggets stay on the grid — no full-screen lightbox. */
function allowsLightbox(p) {
	return productSection(p) !== "nuggets";
}

/* Full-bleed card/lightbox media (no checker) for photo products. */
function fillsCardMedia(p) {
	const type = productType(p);
	return type === "Tshirts" || (type === "Stickers" && productSection(p) === "curated");
}

function fillMediaAspect(p) {
	const type = productType(p);
	if (type === "Tshirts") return "aspect-[4/5]";
	if (type === "Stickers" && productSection(p) === "curated") return "aspect-[5/7]";
	return null;
}

function renderSectionSubnav() {
	const nav = document.getElementById("sectionSubnav");
	const wrap = document.getElementById("sectionTrack");
	if (!nav || !wrap) return;

	const sections = sectionsFor(activeCat);
	const show = activeView === "shop" && sections.length > 0;
	nav.hidden = !show;
	if (!show) return;

	const subchipCls =
		"inline-flex h-[2.35rem] max-w-[min(18rem,70vw)] shrink-0 items-center truncate rounded-full border-0 bg-transparent px-[0.85rem] text-sm font-bold tracking-[0.02em] text-kiosk-fg no-underline is-active:bg-kiosk-accent is-active:text-white";
	wrap.innerHTML = "";
	sections.forEach((section) => {
		const button = document.createElement("a");
		button.href = shopHash(activeCat, section.id);
		button.className = subchipCls + (activeSection === section.id ? " is-active" : "");
		button.dataset.section = section.id;
		button.textContent = section.label;
		button.title = section.label;
		button.setAttribute("aria-pressed", String(activeSection === section.id));
		button.onclick = (e) => {
			e.preventDefault();
			activeSection = section.id;
			track("select_content", {
				content_type: "shop_section",
				content_id: `${activeCat}/${section.id}`,
			});
			if (lbIndex >= 0) closeLightbox({ sync: false });
			syncHash();
			renderSectionSubnav();
			renderGrid();
			document
				.querySelector(`#sectionSubnav [data-section="${CSS.escape(section.id)}"]`)
				?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
		};
		wrap.appendChild(button);
	});
}

function matchesActiveSection(p) {
	const meta = activeSectionMeta();
	if (!meta) return false;
	const section = productSection(p);
	if (meta.categories) return meta.categories.includes(section);
	return section === meta.id;
}

function filtered() {
	const ofType = products.filter((p) => productType(p) === activeCat);
	const sections = sectionsFor(activeCat);
	if (!sections.length) return ofType;
	if (!activeSection) return [];
	return ofType.filter(matchesActiveSection);
}

function renderSectionFeature() {
	const meta = activeSectionMeta();
	const feature = meta?.feature || null;
	const top = document.getElementById("top");
	const panel = document.getElementById("sectionFeature");
	const grid = document.getElementById("grid");
	const empty = document.getElementById("emptyState");
	if (!panel) return !!feature;

	if (!feature) {
		panel.hidden = true;
		if (top) top.hidden = false;
		if (grid) grid.hidden = false;
		return false;
	}

	const img = document.getElementById("sectionFeatureImg");
	const copy = document.getElementById("sectionFeatureCopy");
	if (img) {
		img.src = encodeURI(assetUrl(feature.image));
		img.alt = feature.alt || meta.label || "";
	}
	if (copy) copy.textContent = feature.copy || "";

	panel.hidden = false;
	if (top) top.hidden = true;
	if (grid) {
		grid.hidden = true;
		grid.innerHTML = "";
	}
	if (empty) empty.hidden = true;
	return true;
}

function updateStatCount(n) {
	const el = document.getElementById("statCount");
	if (el) el.textContent = String(n);
}

function renderGrid() {
	if (renderSectionFeature()) {
		visible = [];
		updateStatCount(0);
		return;
	}

	const grid = document.getElementById("grid");
	visible = filtered();
	updateStatCount(visible.length);
	grid.innerHTML = "";
	const viewOnly = !!activeSectionMeta()?.viewOnly;
	const listMeta = shopListMeta();
	const listItems = capItems(
		visible.map((p) => {
			const line = resolveLine(activeSkuId(p)) || {
				id: p.id,
				name: p.name,
				price: p.price,
				type: productType(p),
				section: productSection(p),
			};
			return itemFromLine(line);
		}).filter(Boolean),
	);
	if (listItems.length) {
		track("view_item_list", {
			...listMeta,
			items: listItems,
		});
	}

	visible.forEach((p, i) => {
		const card = document.createElement("article");
		card.className = "group flex animate-fade-up flex-col overflow-hidden rounded-kiosk-lg border border-transparent bg-kiosk-elevated transition-[transform,box-shadow] duration-200 sm:hover:-translate-y-0.5 sm:hover:shadow-kiosk";
		card.style.animationDelay = `${Math.min(i, 10) * 25}ms`;
		const fillMedia = fillsCardMedia(p);
		const mediaAspect = fillMediaAspect(p) || "aspect-square";
		const mediaBg = fillMedia ? "bg-kiosk-elevated" : "bg-checker";
		const mediaImg = fillMedia
			? "absolute inset-0 h-full w-full object-cover transition-transform duration-300 sm:group-hover:scale-105"
			: "absolute inset-0 h-full w-full object-contain p-3 transition-transform duration-300 sm:p-4 sm:group-hover:scale-105";
		const imgSrc = shirtImage(p) || p.image;
		const skuId = activeSkuId(p);
		const canZoom = allowsLightbox(p);
		const mediaTag = canZoom ? "button" : "div";
		const mediaCls = canZoom
			? `relative ${mediaAspect} w-full ${mediaBg} transition-opacity duration-150 active:opacity-80`
			: `relative ${mediaAspect} w-full ${mediaBg}`;
		const mediaAttrs = canZoom
			? ` data-zoom aria-label="${escapeAttr(p.name)}"`
			: "";

		card.innerHTML = `
			<${mediaTag} class="${mediaCls}"${mediaAttrs}>
				<img class="${mediaImg}" src="${encodeURI(assetUrl(imgSrc))}" alt="${escapeAttr(p.name)}" loading="lazy" decoding="async"
					onerror="this.style.opacity=.15" />
			</${mediaTag}>
			<div class="flex flex-1 flex-col">
				<p class="relative z-[1] -mt-5 mb-0 ms-3 self-start rounded-full bg-[#111] px-[0.9rem] py-[0.3rem] text-[0.8125rem] font-bold text-white tabular-nums shadow-[0_2px_6px_rgb(0_0_0_/_0.35)]" dir="rtl">${money(p.price)}</p>
				<div class="mt-3 mb-2.5 px-5">
					<h3 class="line-clamp-2 overflow-hidden text-start text-[0.8125rem] leading-snug font-semibold sm:text-sm" dir="${textDir(p.title || p.name)}">${escapeHtml(p.title || p.name)}</h3>
				</div>
				<p class="hidden text-[0.6875rem] text-kiosk-muted">${escapeHtml(sectionLabel(productType(p), productSection(p)))}</p>
				<div class="mt-auto px-5 pb-3" data-qtybox="${skuId}"></div>
			</div>`;

		if (canZoom) {
			card.querySelector("[data-zoom]").onclick = () => openLightbox(i);
		}
		grid.appendChild(card);
		const qtyHost = card.querySelector("[data-qtybox]");
		if (viewOnly) qtyHost.remove();
		else renderQtyBox(qtyHost, skuId);
	});

	document.getElementById("emptyState").hidden = visible.length > 0;
}

/* Quantity control: full-width "add" button at qty 0, stepper otherwise.
   Everything is 44px tall so it clears the minimum touch target. */
function renderQtyBox(host, id) {
	if (!host) return;
	const q = qtyOf(id);
	const lightbox = host.dataset.variant === "lightbox";
	host.dataset.qtybox = id;
	host.innerHTML = "";

	if (q === 0) {
		const add = document.createElement("button");
		add.className = "h-11 w-full rounded-kiosk-md border border-transparent bg-black/18 text-2xl font-bold text-kiosk-cyan transition-[transform,background,color] duration-150 active:scale-95 active:bg-kiosk-cyan active:text-[#111]";
		add.textContent = "+";
		add.setAttribute("aria-label", "Added to cart");
		add.onclick = () => changeQty(id, 1);
		host.appendChild(add);
		return;
	}

	const row = document.createElement("div");
	row.className = "flex h-11 items-center justify-between gap-1 rounded-kiosk-md bg-black/18 px-2";
	const btnCls = lightbox
		? "grid h-11 w-11 shrink-0 place-items-center rounded-kiosk-md bg-kiosk-cyan text-2xl leading-none font-bold text-[#111] transition-transform duration-150 active:scale-90"
		: "grid h-11 w-11 shrink-0 place-items-center rounded-kiosk-md bg-transparent text-2xl leading-none font-bold text-kiosk-cyan transition-transform duration-150 active:scale-90";
	const btn = (label, delta, aria) => {
		const b = document.createElement("button");
		b.className = btnCls;
		b.textContent = label;
		b.setAttribute("aria-label", aria);
		b.onclick = () => changeQty(id, delta);
		return b;
	};
	const num = document.createElement("span");
	num.className = "select-none text-base font-bold text-kiosk-fg tabular-nums";
	num.textContent = q;

	row.append(btn("−", -1, "-1"), num, btn("+", 1, "+1"));
	host.appendChild(row);
}

/* Keep every stepper for a product in sync (card + sheet + lightbox). */
function syncQtyUI(id) {
	document
		.querySelectorAll(`[data-qtybox="${CSS.escape(String(id))}"]`)
		.forEach((host) => renderQtyBox(host, String(id)));
	updateTotals();
}

function updateTotals() {
	const count = cartCount();
	const total = cartTotal();
	document.getElementById("cartCount").textContent = count;
	document.getElementById("totalPrice").textContent = money(total);
	document.getElementById("totalPrice2").textContent = money(total);
	document.getElementById("mobileTotal").textContent = money(total);
	document.getElementById("barCount").textContent = itemsCount(count);
	document.getElementById("checkoutBtn").disabled = count === 0;
	renderBarThumbs();
	document.getElementById("mobileBar").classList.toggle("is-visible", count > 0);
}

/* Stacked thumbnails of what's in the cart, on the sticky bar. */
function renderBarThumbs() {
	const host = document.getElementById("barThumbs");
	host.innerHTML = "";
	Object.keys(cart).slice(0, 3).forEach((id) => {
		const line = resolveLine(id);
		if (!line) return;
		const img = document.createElement("img");
		img.src = encodeURI(assetUrl(line.image));
		img.alt = "";
		img.loading = "lazy";
		img.className = "h-9 w-9 rounded-lg bg-white object-contain p-0.5 shadow-[0_0_0_2px_var(--color-kiosk-accent)] [&:not(:first-child)]:-ms-[0.65rem]";
		host.appendChild(img);
	});
}

function renderCartBody() {
	const body = document.getElementById("cartBody");
	const entries = Object.entries(cart).filter(([, q]) => q > 0);
	body.innerHTML = "";

	if (!entries.length) {
		body.innerHTML = `
			<div class="flex flex-1 flex-col items-center justify-center gap-1 py-16 text-center">
				<p class="text-kiosk-muted">Your cart is empty.</p>
				<p class="text-xs text-kiosk-muted">Tap + on any design to add it.</p>
			</div>`;
		return;
	}

	entries.forEach(([id, q]) => {
		const line = resolveLine(id);
		if (!line) return;
		const row = document.createElement("div");
		row.className = "flex items-center gap-3";
		row.innerHTML = `
			<div class="h-16 w-16 shrink-0 overflow-hidden rounded-xl bg-kiosk-checker-a">
				<img class="h-full w-full object-contain p-1.5" src="${encodeURI(assetUrl(line.image))}" alt="" loading="lazy" />
			</div>
			<div class="min-w-0 flex-1">
				<p class="truncate text-sm font-semibold text-start" dir="${textDir(line.name)}">${escapeHtml(line.name)}</p>
				<p class="text-xs text-kiosk-muted tabular-nums">${money(line.price)} × ${q} = <b class="font-semibold text-kiosk-fg">${money(line.price * q)}</b></p>
				<button class="py-1 text-xs text-red-500" data-remove>Remove</button>
			</div>
			<div class="w-[6.5rem] shrink-0" data-variant="compact" data-qtybox="${line.id}"></div>`;
		row.querySelector("[data-remove]").onclick = () => setQty(id, 0);
		body.appendChild(row);
		renderQtyBox(row.querySelector(`[data-qtybox="${line.id}"]`), line.id);
	});
}

/* ---------- scroll lock (preserves position; iOS-safe) ---------- */
let lockCount = 0;
let lockedScrollY = 0;

function lockScroll() {
	if (lockCount++ === 0) {
		lockedScrollY = window.scrollY;
		document.body.style.top = `-${lockedScrollY}px`;
		document.body.classList.add("is-locked");
	}
}

function unlockScroll() {
	if (lockCount > 0 && --lockCount === 0) {
		document.body.classList.remove("is-locked");
		document.body.style.top = "";
		window.scrollTo(0, lockedScrollY);
	}
}

/* ---------- cart panel (bottom sheet on phones, drawer on desktop) ---------- */
function openCart() {
	const overlay = document.getElementById("cartOverlay");
	const drawer = document.getElementById("cartDrawer");
	renderCartBody();
	overlay.hidden = false;
	drawer.hidden = false;
	lockScroll();
	requestAnimationFrame(() => {
		overlay.classList.add("is-visible");
		drawer.classList.add("is-open");
	});
	const items = itemsFromCart(resolveLine, cart);
	track("view_cart", {
		currency: CURRENCY,
		value: cartTotal(),
		items,
	});
}

function closeCart() {
	const overlay = document.getElementById("cartOverlay");
	const drawer = document.getElementById("cartDrawer");
	if (drawer.hidden) return;
	overlay.classList.remove("is-visible");
	drawer.classList.remove("is-open", "is-dragging");
	drawer.style.transform = "";
	unlockScroll();
	setTimeout(() => {
		overlay.hidden = true;
		drawer.hidden = true;
		showCartStep();
	}, 320);
}

const showCheckoutStep = () => {
	document.getElementById("orderForm").hidden = false;
	const items = itemsFromCart(resolveLine, cart);
	track("begin_checkout", {
		currency: CURRENCY,
		value: cartTotal(),
		items,
	});
};
const showCartStep = () => {
	document.getElementById("orderForm").hidden = true;
	document.getElementById("orderResponse").innerHTML = "";
};

/* Drag the sheet down to dismiss (phones). */
function initSheetDrag() {
	const drawer = document.getElementById("cartDrawer");
	const handle = document.getElementById("dragHandle");
	let startY = 0, dy = 0, startT = 0, active = false;

	const start = (e) => {
		if (window.innerWidth >= 640) return;
		active = true;
		startY = e.touches ? e.touches[0].clientY : e.clientY;
		startT = Date.now();
		dy = 0;
		drawer.classList.add("is-dragging");
	};
	const move = (e) => {
		if (!active) return;
		const y = e.touches ? e.touches[0].clientY : e.clientY;
		dy = Math.max(0, y - startY);
		drawer.style.transform = `translateY(${dy}px)`;
		if (e.cancelable) e.preventDefault();
	};
	const end = () => {
		if (!active) return;
		active = false;
		drawer.classList.remove("is-dragging");
		const velocity = dy / Math.max(1, Date.now() - startT);
		drawer.style.transform = "";
		if (dy > 110 || velocity > 0.55) closeCart();
	};

	handle.addEventListener("touchstart", start, { passive: true });
	handle.addEventListener("touchmove", move, { passive: false });
	handle.addEventListener("touchend", end);
	handle.addEventListener("touchcancel", end);
	handle.addEventListener("mousedown", (e) => { start(e); e.preventDefault(); });
	window.addEventListener("mousemove", move);
	window.addEventListener("mouseup", end);
}

/* ---------- lightbox ---------- */
function openLightbox(index, { pushHash = true, fromRoute = false } = {}) {
	const p = visible[index];
	if (!p || !allowsLightbox(p)) return;
	lbIndex = index;
	const lb = document.getElementById("lightbox");
	const wasOpen = !lb.hidden;
	lb.hidden = false;
	if (!wasOpen) lockScroll();
	requestAnimationFrame(() => lb.classList.add("is-visible"));

	const line = resolveLine(activeSkuId(p));
	const item = itemFromLine(line || {
		id: p.id,
		name: p.name,
		price: p.price,
		type: productType(p),
		section: productSection(p),
	});
	if (item && !wasOpen) {
		track("select_item", {
			...shopListMeta(),
			items: [item],
		});
	}

	paintLightbox({ pushHash: pushHash && !fromRoute, replace: wasOpen || fromRoute });
}

function paintLightbox({ pushHash = true, replace = true } = {}) {
	const p = visible[lbIndex];
	if (!p) return closeLightbox();
	const img = document.getElementById("lbImg");
	const media = document.getElementById("lbMedia");
	const imgSrc = shirtImage(p) || p.image;
	img.src = encodeURI(assetUrl(imgSrc));
	img.alt = p.name;

	const fill = fillsCardMedia(p);
	if (fill) {
		const aspect = fillMediaAspect(p) || "aspect-[4/5]";
		media.className = `relative ${aspect} h-[42vh] w-auto max-w-[84vw] shrink-0 overflow-hidden rounded-2xl bg-kiosk-elevated sm:h-[72vh] sm:max-w-full`;
		img.className = "absolute inset-0 h-full w-full object-cover select-none";
	} else {
		media.className = "flex shrink-0 items-center justify-center rounded-2xl bg-checker-dark p-3 sm:flex-1";
		img.className = "max-h-[42vh] max-w-[84vw] object-contain select-none sm:max-h-[72vh] sm:max-w-full";
	}

	const lbName = document.getElementById("lbName");
	lbName.textContent = p.name;
	lbName.dir = textDir(p.name);
	document.getElementById("lbCat").textContent = sectionLabel(productType(p), productSection(p));
	const sku = p.colors?.length ? shirtColor(p) : null;
	document.getElementById("lbPrice").textContent = money(sku?.price ?? p.price);
	document.getElementById("lbCounter").textContent = `${lbIndex + 1} / ${visible.length}`;

	const lbVariants = document.getElementById("lbVariants");
	renderShirtControls(lbVariants, p, {
		onChange: () => paintLightbox({ pushHash: true, replace: true }),
	});

	const lbQty = document.getElementById("lbQty");
	const skuId = activeSkuId(p);
	if (activeSectionMeta()?.viewOnly) {
		lbQty.hidden = true;
		lbQty.innerHTML = "";
		lbQty.removeAttribute("data-qtybox");
	} else {
		lbQty.hidden = false;
		renderQtyBox(lbQty, skuId);
	}

	if (pushHash) setHash(productHash(skuId), { push: !replace });
	setDocumentTitle();

	trackViewItem(resolveLine(skuId) || {
		id: skuId,
		name: p.name,
		price: sku?.price ?? p.price,
		type: productType(p),
		section: productSection(p),
	});

	// Warm the neighbours so swiping feels instant
	[-1, 1].forEach((d) => {
		const n = visible[(lbIndex + d + visible.length) % visible.length];
		if (n) new Image().src = encodeURI(assetUrl(shirtImage(n) || n.image));
	});
}

function stepLightbox(delta) {
	if (!visible.length) return;
	lbIndex = (lbIndex + delta + visible.length) % visible.length;
	paintLightbox({ pushHash: true, replace: true });
}

function closeLightbox({ sync = true } = {}) {
	if (lbIndex < 0) return;
	const lb = document.getElementById("lightbox");
	lbIndex = -1;
	lastViewedItemId = null;
	lb.classList.remove("is-visible");
	unlockScroll();
	setTimeout(() => {
		lb.hidden = true;
		const stage = document.getElementById("lbStage");
		stage.style.transform = "";
		stage.style.opacity = "";
	}, 200);
	document.getElementById("lbQty").removeAttribute("data-qtybox");
	if (sync) {
		const onProduct = /^#p(?:roduct)?\//i.test(location.hash || "");
		if (onProduct) setHash(shopHash(), { push: false });
		setDocumentTitle();
	}
}

/* Swipe: horizontal to browse, downward to dismiss. */
function initLightboxSwipe() {
	const stage = document.getElementById("lbStage");
	let x0 = 0, y0 = 0, dx = 0, dy = 0, axis = null, active = false;

	stage.addEventListener("touchstart", (e) => {
		if (e.touches.length !== 1) return;
		active = true; axis = null; dx = dy = 0;
		x0 = e.touches[0].clientX;
		y0 = e.touches[0].clientY;
		stage.classList.add("is-dragging");
	}, { passive: true });

	stage.addEventListener("touchmove", (e) => {
		if (!active) return;
		dx = e.touches[0].clientX - x0;
		dy = e.touches[0].clientY - y0;
		if (!axis && (Math.abs(dx) > 8 || Math.abs(dy) > 8)) {
			axis = Math.abs(dx) > Math.abs(dy) ? "x" : "y";
		}
		if (axis === "x") {
			stage.style.transform = `translateX(${dx}px)`;
			stage.style.opacity = String(Math.max(0.4, 1 - Math.abs(dx) / 400));
			if (e.cancelable) e.preventDefault();
		} else if (axis === "y" && dy > 0) {
			stage.style.transform = `translateY(${dy}px) scale(${Math.max(0.85, 1 - dy / 900)})`;
			stage.style.opacity = String(Math.max(0.3, 1 - dy / 400));
			if (e.cancelable) e.preventDefault();
		}
	}, { passive: false });

	const finish = () => {
		if (!active) return;
		active = false;
		stage.classList.remove("is-dragging");
		if (axis === "x" && Math.abs(dx) > 60) {
			stepLightbox(dx < 0 ? 1 : -1);
			buzz(5);
		} else if (axis === "y" && dy > 120) {
			closeLightbox();
		}
		stage.style.transform = "";
		stage.style.opacity = "";
	};
	stage.addEventListener("touchend", finish);
	stage.addEventListener("touchcancel", finish);
}

/* ---------- toasts ---------- */
function toast(msg, kind = "ok") {
	const host = document.getElementById("toasts");
	[...host.children].slice(0, -2).forEach((el) => el.remove());
	const el = document.createElement("div");
	el.className = kind === "err"
		? "max-w-full animate-pop overflow-hidden rounded-full bg-red-600 px-4 py-2.5 text-sm font-medium text-white text-ellipsis whitespace-nowrap shadow-kiosk"
		: "max-w-full animate-pop overflow-hidden rounded-full bg-kiosk-accent-light px-4 py-2.5 text-sm font-medium text-[#14140a] text-ellipsis whitespace-nowrap shadow-kiosk";
	el.textContent = msg;
	host.appendChild(el);
	setTimeout(() => {
		el.style.transition = "opacity .3s";
		el.style.opacity = "0";
		setTimeout(() => el.remove(), 300);
	}, 1600);
}

/* ---------- checkout ---------- */
async function submitOrder(event) {
	event.preventDefault();
	const submitBtn = document.getElementById("submitBtn");
	const responseDiv = document.getElementById("orderResponse");
	responseDiv.innerHTML = "";

	const el = (id) => document.getElementById(id);
	const val = (id) => el(id).value.trim();
	const customerName = val("customerName");
	const phone = val("phone");
	const instaAccount = val("instaAccount");
	const customerAddress = val("customerAddress");
	const orderNotes = val("orderNotes");

	["customerName", "phone", "customerAddress"].forEach((id) => el(id).classList.remove("is-invalid"));
	const missing = [];
	if (!customerName) missing.push(["customerName", "Name"]);
	if (!customerAddress) missing.push(["customerAddress", "Shipping address"]);

	const digits = phone.replace(/\D/g, "");
	let phoneErr = "";
	if (!phone) missing.push(["phone", "Phone"]);
	else if (digits.length !== 10) phoneErr = "Phone must be 10 digits (e.g. 0912345678).";

	if (missing.length || phoneErr) {
		missing.forEach(([id]) => el(id).classList.add("is-invalid"));
		if (phoneErr) el("phone").classList.add("is-invalid");
		const msg = [
			missing.length ? `Please fill in: ${missing.map(([, l]) => l).join(", ")}` : "",
			phoneErr,
		].filter(Boolean).join(" ");
		notice(responseDiv, msg, "warn");
		buzz(30);
		// Bring the first offending field into view above the on-screen keyboard
		const firstBad = (missing[0] && el(missing[0][0])) || el("phone");
		firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
		firstBad.focus({ preventScroll: true });
		return;
	}

	const orderItems = Object.entries(cart)
		.filter(([, q]) => q > 0)
		.map(([id, q]) => {
			const line = resolveLine(id);
			return line && {
				id: line.id, name: line.name, category: sectionLabel(line.type, line.section),
				quantity: q, price: line.price, subtotal: line.price * q,
			};
		})
		.filter(Boolean);

	if (!orderItems.length) {
		notice(responseDiv, "Your cart is empty.", "err");
		return;
	}

	submitBtn.disabled = true;
	submitBtn.textContent = "Sending…";

	try {
		const res = await fetch(SHEETDB_URL, {
			method: "POST",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				data: {
					Timestamp: new Date().toISOString(),
					Name: customerName,
					Phone: phone,
					"Insta Account": instaAccount,
					Address: customerAddress,
					Notes: orderNotes,
					Items: JSON.stringify(orderItems, null, 2),
					Total: cartTotal(),
				},
			}),
		});
		if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);

		const value = cartTotal();
		const purchaseItems = itemsFromCart(resolveLine, cart);
		track("purchase", {
			transaction_id: (crypto.randomUUID && crypto.randomUUID()) || `order_${Date.now()}`,
			currency: CURRENCY,
			value,
			items: purchaseItems,
		});

		notice(responseDiv, "Order sent! We'll be in touch shortly.", "ok");
		toast("Order sent! We'll be in touch shortly.");
		buzz(40);
		setTimeout(() => {
			cart = {};
			saveCart();
			document.getElementById("orderForm").reset();
			renderGrid();
			renderCartBody();
			updateTotals();
			closeCart();
		}, 1400);
	} catch (err) {
		console.error("Order submission failed:", err);
		notice(responseDiv, "Couldn't send the order. Please try again.", "err");
	} finally {
		submitBtn.disabled = false;
		submitBtn.textContent = "Place order";
	}
}

function notice(host, msg, kind) {
	const kinds = {
		ok: "rounded-xl border border-green-500/40 bg-green-500/12 px-3 py-2 text-sm text-green-700",
		warn: "rounded-xl border border-amber-500/40 bg-amber-500/12 px-3 py-2 text-sm text-amber-800",
		err: "rounded-xl border border-red-500/40 bg-red-500/12 px-3 py-2 text-sm text-red-700",
	};
	host.innerHTML = `<div class="${kinds[kind] || kinds.warn}">${escapeHtml(msg)}</div>`;
}

/* ---------- helpers ---------- */
const escapeHtml = (s) =>
	String(s).replace(/[&<>"']/g, (c) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeAttr = escapeHtml;

function renderSkeleton() {
	document.getElementById("skeleton").innerHTML = Array.from({ length: 8 })
		.map(() => `
			<div class="overflow-hidden rounded-kiosk-md border border-kiosk-border">
				<div class="aspect-square animate-skel-pulse bg-kiosk-border"></div>
				<div class="flex flex-col gap-2 p-3">
					<div class="h-3 animate-skel-pulse rounded bg-kiosk-border"></div>
					<div class="h-3 w-1/2 animate-skel-pulse rounded bg-kiosk-border"></div>
				</div>
			</div>`)
		.join("");
}

/* ---------- boot ---------- */
async function boot() {
	renderSkeleton();
	initTopNav();
	initSheetDrag();
	initLightboxSwipe();

	document.getElementById("brandHome")?.addEventListener("click", (e) => {
		e.preventDefault();
		activeCat = "Posters";
		activeSection = sectionsFor("Posters")[0]?.id || null;
		setView("shop");
	});

	document.getElementById("cartBtn").onclick = openCart;
	document.getElementById("mobileCartBtn").onclick = openCart;
	document.getElementById("cartClose").onclick = closeCart;
	document.getElementById("cartOverlay").onclick = closeCart;
	document.getElementById("checkoutBtn").onclick = showCheckoutStep;
	document.getElementById("backToCart").onclick = showCartStep;
	document.getElementById("orderForm").onsubmit = submitOrder;

	document.getElementById("lbClose").onclick = () => closeLightbox();
	document.getElementById("lbShare")?.addEventListener("click", () => shareCurrent());
	document.getElementById("lbPrev").onclick = () => stepLightbox(-1);
	document.getElementById("lbNext").onclick = () => stepLightbox(1);
	document.getElementById("lightbox").addEventListener("click", (e) => {
		if (e.target.id === "lightbox" || e.target.id === "lbStage") closeLightbox();
	});

	document.addEventListener("keydown", (e) => {
		const lbOpen = !document.getElementById("lightbox").hidden;
		if (e.key === "Escape") {
			if (lbOpen) closeLightbox();
			else if (!document.getElementById("cartDrawer").hidden) closeCart();
		}
		if (!lbOpen) return;
		if (e.key === "ArrowRight") stepLightbox(1);
		else if (e.key === "ArrowLeft") stepLightbox(-1);
	});

	try {
		await fetchProducts();
		const route = parseHash();
		if (route.productId) {
			openProductById(route.productId, { pushHash: false });
		} else if (route.view === "shop") {
			applyShopSelection(route.cat || activeCat, route.section, { render: true });
			syncHash();
		} else {
			paintView(route.view);
			setDocumentTitle();
		}
		renderCartBody();
		updateTotals();
	} catch (err) {
		console.error(err);
		const empty = document.getElementById("emptyState");
		empty.hidden = false;
		empty.textContent = "Couldn't load the catalog. Please try again.";
	} finally {
		document.getElementById("skeleton").remove();
	}
}

boot();
