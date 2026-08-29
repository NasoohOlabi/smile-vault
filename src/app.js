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
const SHEETDB_ELAT_URL = "https://sheetdb.io/api/v1/vr4xr9qeeervg";
const ELAT_SECTION = "dama-x-elat";
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
		activeCat = PRODUCT_TYPES[0] || "Tshirts";
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
let activeCat = "Tshirts";
let activeSection = null;
let visible = [];   // currently rendered products (drives lightbox nav)
let lbIndex = -1;
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
		toast("Added to cart", "ok");
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

function setEmptyConfirm(on) {
	document.getElementById("emptyCartConfirm").hidden = !on;
	document.getElementById("checkoutBtn").hidden = on;
	document.getElementById("emptyCartBtn").hidden = on || cartCount() === 0;
}

function emptyCart() {
	const ids = Object.keys(cart);
	if (!ids.length) return;
	const value = cartTotal();
	const items = itemsFromCart(resolveLine, cart);
	cart = {};
	saveCart();
	ids.forEach(syncQtyUI);
	setEmptyConfirm(false);
	renderCartBody();
	updateTotals();
	toast("Cart emptied");
	buzz();
	if (items.length) {
		track("remove_from_cart", { currency: CURRENCY, value, items });
	}
}

/* ---------- t-shirt variants ----------
 * Filenames: Design_B / Design_W / Design_B_F / Design_W_F
 *   Color codes: B black · W white · BL blue
 *   Side: bare color = back · _F = front · Color_B = explicit back
 * Color is the purchasable SKU; front/back is preview only; size is S/M/L.
 */
const TSHIRT_COLOR = {
	B: { label: "Black", swatch: "#141414", border: "rgb(255 255 255 / 0.35)" },
	W: { label: "White", swatch: "#f4f4f4", border: "rgb(0 0 0 / 0.25)" },
	BL: { label: "Blue", swatch: "#1d4ed8", border: "rgb(255 255 255 / 0.35)" },
};
const TSHIRT_PRINT = {
	Blue: { swatch: "#6d8cff", border: "rgb(255 255 255 / 0.35)" },
	Pink: { swatch: "#e879a9", border: "rgb(0 0 0 / 0.2)" },
};
const TSHIRT_COLOR_ORDER = { B: 0, W: 1, BL: 2, "": 3 };
const TSHIRT_SIZES = ["S", "M", "L"];
const TSHIRT_SIZE_LABEL = { S: "Small", M: "Medium", L: "Large" };
const shirtView = new Map(); // groupId → { colorId, side, size }

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
		if ((p.type || "") !== "Tshirts" && (p.type || "") !== "Collabs") {
			others.push(p);
			continue;
		}
		const parsed = parseTshirtStem(imageStem(p.image));
		const color = p.variantColor != null && p.variantColor !== ""
			? String(p.variantColor)
			: parsed.color;
		const side = p.variantSide || parsed.side || "back";
		const key = p.title || parsed.base || p.name;
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
		const putSide = (images, side, image) => {
			if (!images[side]) images[side] = image;
			else if (side === "back" && !images.front) {
				images.front = images.back;
				images.back = image;
			}
		};
		for (const item of items) {
			const code = item._color || "";
			const printLabel = item.variantPrint ? String(item.variantPrint) : "";
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
					printMap: new Map(),
				});
			}
			const slot = byColor.get(code);
			const side = item._side === "front" ? "front" : "back";
			if (printLabel) {
				if (!slot.printMap.has(printLabel)) {
					slot.printMap.set(printLabel, {
						id: String(item.id),
						label: printLabel,
						swatch: TSHIRT_PRINT[printLabel]?.swatch || "#888",
						border: TSHIRT_PRINT[printLabel]?.border || "rgb(255 255 255 / 0.35)",
						price: item.price,
						images: {},
					});
				}
				putSide(slot.printMap.get(printLabel).images, side, item.image);
			} else {
				putSide(slot.images, side, item.image);
			}
			if (item._color && slot.id !== String(item.id) && !slot._lockedId) {
				slot.id = String(item.id);
			}
			if (item._color) slot._lockedId = true;
		}

		const colors = [...byColor.values()]
			.map(({ _lockedId, printMap, ...c }) => {
				const prints = [...printMap.values()];
				if (prints.length) {
					c.prints = prints;
					c.images = { ...prints[0].images };
					c.price = prints[0].price;
					c.id = prints[0].id;
				}
				return c;
			})
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
			type: items[0].type || "Tshirts",
			category: items[0].category || "tshirts",
			section: items[0].section,
			colors,
			skuIds: colors.flatMap((c) => (c.prints?.length ? c.prints.map((pr) => pr.id) : [c.id])),
		};
		if (defaultColorCode != null) groupedProduct.defaultColor = defaultColorCode;
		if (defaultSide) groupedProduct.defaultSide = defaultSide;
		grouped.push(groupedProduct);
	}

	return [...others, ...grouped];
}

function isShirt(p) {
	const type = p?.type || "";
	return type === "Tshirts" || type === "Collabs";
}

function parseLineId(id) {
	id = String(id);
	const i = id.lastIndexOf("::");
	if (i > 0) {
		const size = id.slice(i + 2);
		if (TSHIRT_SIZES.includes(size)) return { skuId: id.slice(0, i), size };
	}
	return { skuId: id, size: null };
}

function shirtSelection(p) {
	if (!p) return null;
	let sel = shirtView.get(p.id);
	const size = TSHIRT_SIZES.includes(sel?.size) ? sel.size : "M";

	if (!p.colors?.length) {
		if (!isShirt(p)) return null;
		if (!sel || sel.size !== size) {
			sel = { ...(sel || {}), size };
			shirtView.set(p.id, sel);
		}
		return sel;
	}

	if (!sel || !p.colors.some((c) => c.id === sel.colorId)) {
		const color =
			(p.defaultColor != null &&
				p.colors.find((c) => c.code === p.defaultColor)) ||
			p.colors[0];
		const sku = color.prints?.[0] || color;
		const side =
			p.defaultSide && sku.images[p.defaultSide]
				? p.defaultSide
				: sku.images.front
					? "front"
					: "back";
		sel = { colorId: color.id, printId: color.prints?.[0]?.id, side, size };
		shirtView.set(p.id, sel);
	} else if (sel.size !== size) {
		sel = { ...sel, size };
		shirtView.set(p.id, sel);
	}
	const color = p.colors.find((c) => c.id === sel.colorId);
	if (color?.prints?.length && !color.prints.some((pr) => pr.id === sel.printId)) {
		sel = { ...sel, printId: color.prints[0].id };
		shirtView.set(p.id, sel);
	}
	return sel;
}

function shirtColor(p, colorId = shirtSelection(p)?.colorId) {
	if (!p?.colors?.length) return null;
	return p.colors.find((c) => c.id === colorId) || p.colors[0];
}

function shirtSku(p, sel = shirtSelection(p)) {
	const color = shirtColor(p, sel?.colorId);
	if (!color) return null;
	if (color.prints?.length) {
		return color.prints.find((pr) => pr.id === sel?.printId) || color.prints[0];
	}
	return color;
}

function shirtImage(p, sel = shirtSelection(p)) {
	if (!p?.colors?.length) return p?.image;
	const sku = shirtSku(p, sel);
	if (!sku) return p.image;
	const side = sel?.side || "back";
	return sku.images[side] || sku.images.front || sku.images.back || p.image;
}

function setShirtColor(p, colorId) {
	const color = shirtColor(p, colorId);
	if (!color) return;
	const sel = shirtSelection(p);
	const prevPrint = shirtSku(p, sel)?.label;
	const print = color.prints?.find((pr) => pr.label === prevPrint) || color.prints?.[0];
	const sku = print || color;
	const side = sku.images[sel.side]
		? sel.side
		: (sku.images.front ? "front" : "back");
	shirtView.set(p.id, { ...sel, colorId: color.id, printId: print?.id, side });
}

function setShirtPrint(p, printId) {
	const color = shirtColor(p);
	const print = color?.prints?.find((pr) => pr.id === printId);
	if (!print) return;
	const sel = shirtSelection(p);
	const side = print.images[sel.side]
		? sel.side
		: (print.images.front ? "front" : "back");
	shirtView.set(p.id, { ...sel, printId: print.id, side });
}

function setShirtSide(p, side) {
	const sel = shirtSelection(p);
	const sku = shirtSku(p, sel);
	if (!sku?.images[side]) return;
	shirtView.set(p.id, { ...sel, side });
}

function setShirtSize(p, size) {
	if (!TSHIRT_SIZES.includes(size)) return;
	const sel = shirtSelection(p) || {};
	shirtView.set(p.id, { ...sel, size });
}

function activeSkuId(p) {
	if (p?.colors?.length) return shirtSku(p).id;
	return p.id;
}

function cartIdFor(p) {
	const sku = activeSkuId(p);
	if (!isShirt(p)) return sku;
	return `${sku}::${shirtSelection(p)?.size || "M"}`;
}

function resolveLine(id) {
	const { skuId, size } = parseLineId(id);
	const sizeTag = size ? ` · ${size}` : "";
	for (const p of products) {
		if (p.colors?.length) {
			for (const color of p.colors) {
				const print = color.prints?.find((pr) => pr.id === skuId);
				const hit = print || (!color.prints?.length && color.id === skuId ? color : null);
				if (!hit) continue;
				const colorLabel = print ? `${color.label} · ${print.label}` : color.label;
				return {
					id: size ? `${hit.id}::${size}` : hit.id,
					name: `${p.name} · ${colorLabel}${sizeTag}`,
					price: hit.price ?? color.price ?? p.price,
					image: hit.images.front || hit.images.back || p.image,
					type: p.type,
					section: productSection(p),
					product: p,
					color: print ? { ...color, ...print, label: colorLabel } : color,
					size,
				};
			}
			continue;
		}
		if (p.id === skuId) {
			return {
				id: size ? `${p.id}::${size}` : p.id,
				name: `${p.name}${sizeTag}`,
				price: p.price,
				image: p.image,
				type: p.type,
				section: productSection(p),
				product: p,
				color: null,
				size,
			};
		}
	}
	return null;
}

function findDisplayProduct(id) {
	id = parseLineId(id).skuId;
	const direct = products.find((p) => p.id === id);
	if (direct) return { product: direct, colorId: direct.colors?.[0]?.id || null };
	for (const p of products) {
		for (const c of p.colors || []) {
			if (c.id === id) return { product: p, colorId: c.id, printId: c.prints?.[0]?.id };
			const print = c.prints?.find((pr) => pr.id === id);
			if (print) return { product: p, colorId: c.id, printId: print.id };
		}
	}
	return null;
}

function renderShirtControls(host, p, { onChange } = {}) {
	const shirt = isShirt(p);
	const hasColors = !!p?.colors?.length;
	if (!host || (!hasColors && !shirt)) {
		if (host) {
			host.hidden = true;
			host.innerHTML = "";
		}
		return;
	}

	const sel = shirtSelection(p);
	const color = hasColors ? shirtColor(p, sel.colorId) : null;
	const sku = hasColors ? shirtSku(p, sel) : null;
	const hasMultiColor = hasColors && p.colors.length > 1;
	const hasMultiPrint = !!color?.prints && color.prints.length > 1;
	const hasFront = !!sku?.images.front;
	const hasBack = !!sku?.images.back;
	const hasSides = hasFront && hasBack && sku.images.front !== sku.images.back;

	if (!hasMultiColor && !hasMultiPrint && !hasSides && !shirt) {
		host.hidden = true;
		host.innerHTML = "";
		return;
	}

	host.hidden = false;
	host.innerHTML = "";
	host.className = "flex w-full flex-col items-center gap-3 sm:items-start";

	const labelCls = "mb-1.5 text-sm font-semibold tracking-wide text-white";
	const pillOff =
		"h-10 min-w-[3rem] rounded-kiosk-md border border-kiosk-border bg-black/30 px-3 text-sm font-semibold tracking-[0.02em] text-white transition-[background,color,border-color] duration-150";
	const pillOn =
		"h-10 min-w-[3rem] rounded-kiosk-md border border-kiosk-cyan bg-kiosk-cyan px-3 text-sm font-semibold tracking-[0.02em] text-[#111] transition-[background,color,border-color] duration-150";
	const sizeOn =
		"h-10 min-w-[3rem] rounded-kiosk-md border border-[#4f0] bg-[#4f0] px-3 text-sm font-semibold tracking-[0.02em] text-[#111] transition-[background,color,border-color] duration-150";

	const group = (name, aria) => {
		const wrap = document.createElement("div");
		wrap.className = "w-full";
		const cap = document.createElement("p");
		cap.className = labelCls;
		cap.textContent = name;
		const row = document.createElement("div");
		row.className = "flex flex-wrap items-center justify-center gap-2 sm:justify-start";
		row.setAttribute("role", "radiogroup");
		row.setAttribute("aria-label", aria);
		wrap.append(cap, row);
		host.appendChild(wrap);
		return row;
	};

	if (hasMultiColor) {
		const row = group("COLOR", "Color");
		p.colors.forEach((c) => {
			const btn = document.createElement("button");
			btn.type = "button";
			const on = c.id === color.id;
			btn.className =
				"h-8 w-8 rounded-full border-2 transition-transform duration-150 active:scale-90 " +
				(on ? "scale-110 border-kiosk-cyan" : "border-transparent opacity-80");
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
	}

	if (hasMultiPrint) {
		const row = group("PRINT", "Print color");
		color.prints.forEach((pr) => {
			const btn = document.createElement("button");
			btn.type = "button";
			const on = pr.id === sku.id;
			btn.className =
				"h-8 w-8 rounded-full border-2 transition-transform duration-150 active:scale-90 " +
				(on ? "scale-110 border-kiosk-cyan" : "border-transparent opacity-80");
			btn.style.background = pr.swatch;
			btn.style.boxShadow = `inset 0 0 0 1px ${pr.border}`;
			btn.setAttribute("aria-label", pr.label);
			btn.setAttribute("aria-checked", String(on));
			btn.setAttribute("role", "radio");
			btn.title = pr.label;
			btn.onclick = (e) => {
				e.stopPropagation();
				setShirtPrint(p, pr.id);
				onChange?.();
			};
			row.appendChild(btn);
		});
	}

	if (hasSides) {
		const row = group("VIEW", "View");
		[["front", "Front"], ["back", "Back"]].forEach(([side, label]) => {
			const btn = document.createElement("button");
			btn.type = "button";
			const on = sel.side === side;
			btn.className = on ? pillOn : pillOff;
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
	}

	if (shirt) {
		const row = group("SIZE", "Size");
		TSHIRT_SIZES.forEach((size) => {
			const btn = document.createElement("button");
			btn.type = "button";
			const on = (sel.size || "M") === size;
			btn.className = on ? sizeOn : pillOff;
			btn.textContent = size;
			btn.setAttribute("aria-label", TSHIRT_SIZE_LABEL[size]);
			btn.setAttribute("aria-checked", String(on));
			btn.setAttribute("role", "radio");
			btn.title = TSHIRT_SIZE_LABEL[size];
			btn.onclick = (e) => {
				e.stopPropagation();
				setShirtSize(p, size);
				onChange?.();
			};
			row.appendChild(btn);
		});
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
	const shirtSkus = new Set();
	for (const p of products) {
		if (p.colors?.length) {
			p.colors.forEach((c) => {
				if (c.prints?.length) c.prints.forEach((pr) => validIds.add(pr.id));
				else validIds.add(c.id);
			});
		} else validIds.add(p.id);
		if (isShirt(p)) {
			if (p.colors?.length) {
				p.colors.forEach((c) => {
					if (c.prints?.length) c.prints.forEach((pr) => shirtSkus.add(pr.id));
					else shirtSkus.add(c.id);
				});
			} else shirtSkus.add(p.id);
		}
	}

	// Drop gone SKUs; unsized shirt lines become Medium
	let pruned = false;
	for (const id of Object.keys(cart)) {
		const { skuId, size } = parseLineId(id);
		if (!validIds.has(skuId)) { delete cart[id]; pruned = true; continue; }
		if (!size && shirtSkus.has(skuId)) {
			const next = `${skuId}::M`;
			cart[next] = (cart[next] || 0) + cart[id];
			delete cart[id];
			pruned = true;
		}
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
	const nextCat = catFromSlug(cat) || (PRODUCT_TYPES.includes(cat) ? cat : null) || activeCat || "Tshirts";
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
	const { product, colorId, printId } = found;
	if (colorId && product.colors?.length) setShirtColor(product, colorId);
	if (printId) setShirtPrint(product, printId);
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

function isTeaseSection() {
	return !!activeSectionMeta()?.tease;
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
	return type === "Tshirts" || type === "Collabs" || (type === "Stickers" && productSection(p) === "curated");
}

function fillMediaAspect(p) {
	const type = productType(p);
	if (type === "Tshirts" || type === "Collabs") return "aspect-[4/5]";
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
		"inline-flex h-[2.35rem] max-w-[min(18rem,70vw)] shrink-0 items-center truncate rounded-kiosk-md border-0 bg-transparent px-[0.85rem] text-sm font-bold tracking-[0.02em] text-kiosk-fg no-underline is-active:bg-kiosk-accent is-active:text-white";
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
	if (!panel) return !!feature;

	if (!feature) {
		panel.hidden = true;
		if (top) top.hidden = false;
		if (grid) grid.hidden = false;
		return false;
	}

	const img = document.getElementById("sectionFeatureImg");
	const media = document.getElementById("sectionFeatureMedia");
	const title = document.getElementById("sectionFeatureTitle");
	const dates = document.getElementById("sectionFeatureDates");
	const copy = document.getElementById("sectionFeatureCopy");
	const hasImage = Boolean(feature.image);
	panel.classList.toggle("md:grid-cols-2", hasImage);
	if (media) media.hidden = !hasImage;
	if (img) {
		if (hasImage) {
			img.src = encodeURI(assetUrl(feature.image));
			img.alt = feature.alt || meta.label || "";
		} else {
			img.removeAttribute("src");
			img.alt = "";
		}
	}
	if (title) {
		title.textContent = feature.title || "";
		title.hidden = !feature.title;
	}
	if (dates) {
		dates.textContent = feature.dates || "";
		dates.hidden = !feature.dates;
	}
	if (copy) copy.textContent = feature.copy || "";

	panel.hidden = false;
	if (top) top.hidden = true;
	if (grid) grid.hidden = false;
	return true;
}

function updateStatCount(n) {
	const el = document.getElementById("statCount");
	if (el) el.textContent = String(n);
}

function renderGrid() {
	const hasFeature = renderSectionFeature();
	const grid = document.getElementById("grid");
	const rule = document.getElementById("sectionFeatureRule");
	visible = filtered();
	if (rule) rule.hidden = !hasFeature || !visible.length;
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
		const tease = isTeaseSection();
		const mediaImg = fillMedia
			? `absolute inset-0 h-full w-full object-cover transition-[transform,filter] duration-300 ${tease ? "scale-[1.06] blur-[8px] saturate-[0.85]" : "sm:group-hover:scale-105"}`
			: `absolute inset-0 h-full w-full object-contain p-3 transition-[transform,filter] duration-300 sm:p-4 ${tease ? "scale-[1.06] blur-[8px] saturate-[0.85]" : "sm:group-hover:scale-105"}`;
		const imgSrc = shirtImage(p) || p.image;
		const skuId = cartIdFor(p);
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
				<p class="relative z-[1] -mt-5 mb-0 ms-3 self-start rounded-kiosk-md bg-[#111] px-[0.9rem] py-[0.3rem] text-[0.8125rem] font-bold text-white tabular-nums shadow-[0_2px_6px_rgb(0_0_0_/_0.35)]" dir="rtl">${money(p.price)}</p>
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
   Cards/cart stay 44px; lightbox matches the 48px add-to-cart bar. */
function renderQtyBox(host, id) {
	if (!host) return;
	const q = qtyOf(id);
	const lightbox = host.dataset.variant === "lightbox";
	host.dataset.qtybox = id;
	host.innerHTML = "";

	if (q === 0) {
		const add = document.createElement("button");
		add.setAttribute("aria-label", "Add to cart");
		add.onclick = () => changeQty(id, 1);
		if (lightbox) {
			add.className =
				"relative flex h-12 w-full items-center justify-center rounded-kiosk-md bg-kiosk-cyan px-12 text-sm font-bold tracking-[0.08em] text-[#111] transition-transform duration-150 active:scale-95";
			const plus = document.createElement("span");
			plus.className = "absolute start-4 text-2xl leading-none font-bold";
			plus.textContent = "+";
			plus.setAttribute("aria-hidden", "true");
			const label = document.createElement("span");
			label.textContent = "ADD TO CART";
			add.append(plus, label);
		} else {
			add.className =
				"h-11 w-full rounded-kiosk-md border border-kiosk-cyan/40 bg-transparent text-2xl font-bold text-kiosk-cyan transition-transform duration-150 active:scale-95";
			add.textContent = "+";
		}
		host.appendChild(add);
		return;
	}

	const row = document.createElement("div");
	row.className = lightbox
		? "flex h-12 w-full items-stretch gap-3"
		: "flex h-11 items-center justify-between gap-1 rounded-kiosk-md bg-black/18 px-2";
	const btnCls = lightbox
		? "grid h-12 min-w-12 flex-1 place-items-center rounded-kiosk-md bg-kiosk-cyan px-6 text-3xl leading-none font-bold text-[#111] transition-transform duration-150 active:scale-90"
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
	num.className = lightbox
		? "grid min-w-[3rem] flex-1 place-items-center select-none text-xl font-bold text-kiosk-fg tabular-nums"
		: "select-none text-base font-bold text-kiosk-fg tabular-nums";
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
	if (document.getElementById("emptyCartConfirm").hidden) {
		document.getElementById("emptyCartBtn").hidden = count === 0;
	}
	if (!count) setEmptyConfirm(false);
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
		setEmptyConfirm(false);
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

	const line = resolveLine(cartIdFor(p));
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
	const tease = isTeaseSection();
	const teaseImg = tease ? " scale-[1.06] blur-[8px] saturate-[0.85]" : "";
	if (fill) {
		const aspect = fillMediaAspect(p) || "aspect-[4/5]";
		media.className = `relative ${aspect} h-[42vh] w-auto max-w-[84vw] shrink-0 overflow-hidden rounded-2xl bg-kiosk-elevated sm:h-[72vh] sm:max-w-full`;
		img.className = `absolute inset-0 h-full w-full object-cover select-none${teaseImg}`;
	} else {
		media.className = "flex shrink-0 items-center justify-center rounded-2xl bg-checker-dark p-3 sm:flex-1";
		img.className = `max-h-[42vh] max-w-[84vw] object-contain select-none sm:max-h-[72vh] sm:max-w-full${teaseImg}`;
	}

	const lbName = document.getElementById("lbName");
	lbName.textContent = p.name;
	lbName.dir = textDir(p.name);
	document.getElementById("lbCat").textContent = sectionLabel(productType(p), productSection(p));
	const sku = p.colors?.length ? shirtSku(p) : null;
	document.getElementById("lbPrice").textContent = money(sku?.price ?? p.price);
	document.getElementById("lbCounter").textContent = `${lbIndex + 1} / ${visible.length}`;

	const lbVariants = document.getElementById("lbVariants");
	renderShirtControls(lbVariants, p, {
		onChange: () => paintLightbox({ pushHash: true, replace: true }),
	});

	const lbQty = document.getElementById("lbQty");
	const skuId = activeSkuId(p);
	const cartId = cartIdFor(p);
	if (activeSectionMeta()?.viewOnly) {
		lbQty.hidden = true;
		lbQty.innerHTML = "";
		lbQty.removeAttribute("data-qtybox");
	} else {
		lbQty.hidden = false;
		renderQtyBox(lbQty, cartId);
	}

	if (pushHash) setHash(productHash(skuId), { push: !replace });
	setDocumentTitle();

	trackViewItem(resolveLine(cartId) || {
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
function toast(msg, kind = "info") {
	const host = document.getElementById("toasts");
	[...host.children].slice(0, -2).forEach((el) => el.remove());
	const el = document.createElement("div");
	const toastClass = {
		err: "max-w-full animate-pop overflow-hidden rounded-kiosk-md bg-red-600 px-4 py-2.5 text-sm font-medium text-white text-ellipsis whitespace-nowrap shadow-kiosk",
		ok: "max-w-full animate-pop overflow-hidden rounded-kiosk-md bg-[#4f0] px-4 py-2.5 text-sm font-medium text-[#14140a] text-ellipsis whitespace-nowrap shadow-kiosk",
		info: "max-w-full animate-pop overflow-hidden rounded-kiosk-md bg-kiosk-accent-light px-4 py-2.5 text-sm font-medium text-[#14140a] text-ellipsis whitespace-nowrap shadow-kiosk",
	};
	el.className = toastClass[kind] || toastClass.info;
	el.textContent = msg;
	host.appendChild(el);
	setTimeout(() => {
		el.style.transition = "opacity .3s";
		el.style.opacity = "0";
		setTimeout(() => el.remove(), 300);
	}, 1600);
}

/* ---------- checkout ---------- */
const isElatItem = (line) => line.type === "Collabs" && line.section === ELAT_SECTION;

async function submitOrder(event) {
	event.preventDefault();
	const submitBtn = document.getElementById("submitBtn");
	const responseDiv = document.getElementById("orderResponse");
	responseDiv.innerHTML = "";

	const el = (id) => document.getElementById(id);
	const val = (id) => el(id).value.trim();
	const customerName = val("customerName");
	const instaAccount = val("instaAccount").replace(/^@+/, "");
	const phone = val("phone");
	const phoneCall = val("phoneCall");
	const customerAddress = document.querySelector('#orderForm input[name="customerAddress"]:checked')?.value || "";
	const orderNotes = val("orderNotes");

	["customerName", "instaAccount", "phone", "phoneCall", "customerAddressGroup"].forEach((id) => el(id).classList.remove("is-invalid"));
	const missing = [];
	if (!customerName) missing.push(["customerName", "Name"]);
	if (!instaAccount) missing.push(["instaAccount", "Instagram"]);
	if (!customerAddress) missing.push(["customerAddressGroup", "Pickup / delivery"]);

	const phoneDigits = (n) => n.replace(/\D/g, "");
	const phoneErrs = [];
	if (!phone) missing.push(["phone", "WhatsApp"]);
	else if (phoneDigits(phone).length !== 10) {
		el("phone").classList.add("is-invalid");
		phoneErrs.push("WhatsApp must be 10 digits (e.g. 0912345678).");
	}
	if (phoneCall && phoneDigits(phoneCall).length !== 10) {
		el("phoneCall").classList.add("is-invalid");
		phoneErrs.push("Call number must be 10 digits, or leave it blank.");
	}

	if (missing.length || phoneErrs.length) {
		missing.forEach(([id]) => el(id).classList.add("is-invalid"));
		const msg = [
			missing.length ? `Please fill in: ${missing.map(([, l]) => l).join(", ")}` : "",
			...phoneErrs,
		].filter(Boolean).join(" ");
		notice(responseDiv, msg, "warn");
		buzz(30);
		const firstBad = (missing[0] && el(missing[0][0]))
			|| (el("phone").classList.contains("is-invalid") && el("phone"))
			|| el("phoneCall");
		firstBad.scrollIntoView({ block: "center", behavior: "smooth" });
		const focusEl = firstBad.id === "customerAddressGroup"
			? firstBad.querySelector("input")
			: firstBad;
		focusEl?.focus({ preventScroll: true });
		return;
	}

	const orderItems = Object.entries(cart)
		.filter(([, q]) => q > 0)
		.map(([id, q]) => {
			const line = resolveLine(id);
			return line && {
				id: line.id, name: line.name, category: sectionLabel(line.type, line.section),
				size: line.size || "",
				quantity: q, price: line.price, subtotal: line.price * q,
				type: line.type, section: line.section,
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
		const elatItems = orderItems.filter(isElatItem);
		const mainItems = orderItems.filter((line) => !isElatItem(line));
		const stamp = new Date().toISOString();
		const split = elatItems.length > 0 && mainItems.length > 0;
		const orderId = (crypto.randomUUID && crypto.randomUUID()) || `order_${Date.now()}`;
		const notes = split
			? [orderNotes, `Split order ${orderId}`].filter(Boolean).join("\n")
			: orderNotes;

		const sheetLine = ({ type, section, ...rest }) => rest;
		const payload = (items) => ({
			data: {
				Timestamp: stamp,
				Delivered: false,
				Name: customerName,
				Phone: phoneCall,
				"WA number": phone,
				"Insta Account": instaAccount,
				Items: JSON.stringify(items.map(sheetLine), null, 2),
				"Pickup / delivery": customerAddress,
				Notes: notes,
				Total: items.reduce((n, line) => n + line.subtotal, 0),
				"N. of Items": items.reduce((n, line) => n + line.quantity, 0),
			},
		});

		const postSheet = async (url, items) => {
			const res = await fetch(url, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload(items)),
			});
			if (!res.ok) throw new Error(`HTTP ${res.status} ${res.statusText}`);
		};

		await Promise.all([
			mainItems.length ? postSheet(SHEETDB_URL, mainItems) : null,
			elatItems.length ? postSheet(SHEETDB_ELAT_URL, elatItems) : null,
		].filter(Boolean));

		const value = cartTotal();
		const purchaseItems = itemsFromCart(resolveLine, cart);
		track("purchase", {
			transaction_id: orderId,
			currency: CURRENCY,
			value,
			items: purchaseItems,
		});

		notice(responseDiv, "Request sent. DM @dama.obsrv to confirm your order.", "ok");
		toast("Request sent. DM @dama.obsrv to confirm.");
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
		activeCat = "Tshirts";
		activeSection = sectionsFor("Tshirts")[0]?.id || null;
		setView("shop");
	});

	document.getElementById("cartBtn").onclick = openCart;
	document.getElementById("mobileCartBtn").onclick = openCart;
	document.getElementById("emptyCartBtn").onclick = () => setEmptyConfirm(true);
	document.getElementById("emptyCartCancel").onclick = () => setEmptyConfirm(false);
	document.getElementById("emptyCartDo").onclick = emptyCart;
	document.getElementById("cartClose").onclick = closeCart;
	document.getElementById("cartOverlay").onclick = closeCart;
	document.getElementById("checkoutBtn").onclick = showCheckoutStep;
	document.getElementById("backToCart").onclick = showCartStep;
	document.getElementById("orderForm").onsubmit = submitOrder;
	document.getElementById("customerAddressGroup")?.addEventListener("change", () => {
		document.getElementById("customerAddressGroup").classList.remove("is-invalid");
	});

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
