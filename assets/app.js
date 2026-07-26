/* ============================================================
 * DAMA OBSRV — storefront
 * Copy lives in assets/i18n.js. Structure/behavior in assets/base.css;
 * design.css supplies the look via CSS custom properties (see the top
 * of base.css for the token list).
 *
 * Runs from /index.html at the repo root. A page nested one level deep
 * can set `window.DAMA_BASE = "../"` before this script loads so
 * products.json and image paths still resolve.
 * ============================================================ */

const SHEETDB_URL = "https://sheetdb.io/api/v1/jog7er8l976bz";
const CART_KEY = "dama_cart_v2";

const assetUrl = (path) => (window.DAMA_BASE || "") + path;

const t = (k) => I18N[k];
const money = (n) => I18N.currency(n);
const catName = (c) => I18N.cats[c] || c;

/* ---------- state ---------- */
const PRODUCT_TYPES = ["Stickers", "Posters", "Tshirts", "Hoodies"];

let products = [];
let cart = loadCart();
let activeCat = "Stickers";
let activeStickerCategory = "01";
let visible = [];   // currently rendered products (drives lightbox nav)
let lbIndex = -1;

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
		const p = products.find((x) => x.id === id);
		return p ? sum + p.price * q : sum;
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
	if (qty > prev) toast(t("added"));
	else if (qty === 0 && prev > 0) toast(t("removed"));
}

const changeQty = (id, delta) => setQty(id, qtyOf(id) + delta);

/* ---------- data ---------- */
async function fetchProducts() {
	const res = await fetch(assetUrl("products.json"));
	if (!res.ok) throw new Error(`products.json → ${res.status}`);
	const data = await res.json();

	products = data.map((p) => ({ ...p, id: String(p.id) }));

	// Drop cart entries for products that no longer exist
	let pruned = false;
	for (const id of Object.keys(cart)) {
		if (!products.some((p) => p.id === id)) { delete cart[id]; pruned = true; }
	}
	if (pruned) saveCart();
}

/* ---------- rendering ---------- */
function renderFilters() {
	const wrap = document.querySelector("#filterNav .filter-nav__track");
	wrap.innerHTML = "";
	const make = (key, label) => {
		const b = document.createElement("button");
		b.dataset.cat = key;
		b.type = "button";
		b.setAttribute("aria-pressed", String(activeCat === key));
		b.textContent = label;
		b.className = "chip" + (activeCat === key ? " is-active" : "");
		b.onclick = () => {
			activeCat = key;
			renderFilters();
			renderStickerSubnav();
			renderGrid();
			document
				.querySelector(`#filterNav [data-cat="${CSS.escape(key)}"]`)
				?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
		};
		return b;
	};
	PRODUCT_TYPES.forEach((type) => wrap.appendChild(make(type, type)));
}

function stickerCategories() {
	return [...new Set(products.map((p) => p.category))].sort();
}

function renderStickerSubnav() {
	const nav = document.getElementById("stickerSubnav");
	const wrap = nav.querySelector(".sticker-subnav__track");
	const isVisible = activeCat === "Stickers";
	nav.hidden = !isVisible;
	if (!isVisible) return;

	wrap.innerHTML = `<span class="sticker-subnav__label">${escapeHtml(t("packs"))}</span>`;
	stickerCategories().forEach((category) => {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "subchip" + (activeStickerCategory === category ? " is-active" : "");
		button.dataset.stickerCategory = category;
		button.textContent = category;
		button.setAttribute("aria-pressed", String(activeStickerCategory === category));
		button.onclick = () => {
			activeStickerCategory = category;
			renderStickerSubnav();
			renderGrid();
			document
				.querySelector(`#stickerSubnav [data-sticker-category="${CSS.escape(category)}"]`)
				?.scrollIntoView({ inline: "center", block: "nearest", behavior: "smooth" });
		};
		wrap.appendChild(button);
	});
}

function filtered() {
	return activeCat === "Stickers"
		? products.filter((p) => p.category === activeStickerCategory)
		: [];
}

function renderGrid() {
	const grid = document.getElementById("grid");
	visible = filtered();
	grid.innerHTML = "";

	visible.forEach((p, i) => {
		const card = document.createElement("article");
		card.className = "card";
		card.style.animationDelay = `${Math.min(i, 10) * 25}ms`;

		card.innerHTML = `
			<button class="card__media" data-zoom aria-label="${escapeAttr(p.name)}">
				<img class="card__img" src="${encodeURI(assetUrl(p.image))}" alt="${escapeAttr(p.name)}" loading="lazy" decoding="async"
					onerror="this.style.opacity=.15" />
			</button>
			<div class="card__body">
				<h3 class="card__title">${escapeHtml(p.name)}</h3>
				<p class="card__cat">${escapeHtml(catName(p.category))}</p>
				<p class="card__price">${money(p.price)}</p>
				<div class="qty" data-qtybox="${p.id}"></div>
			</div>`;

		card.querySelector("[data-zoom]").onclick = () => openLightbox(i);
		grid.appendChild(card);
		renderQtyBox(card.querySelector(`[data-qtybox="${p.id}"]`), p.id);
	});

	document.getElementById("emptyState").hidden = visible.length > 0;
}

/* Quantity control: full-width "add" button at qty 0, stepper otherwise.
   Everything is 44px tall so it clears the minimum touch target. */
function renderQtyBox(host, id) {
	if (!host) return;
	const q = qtyOf(id);
	host.dataset.qtybox = id;
	host.innerHTML = "";

	if (q === 0) {
		const add = document.createElement("button");
		add.className = "qty__add";
		add.textContent = "+";
		add.setAttribute("aria-label", t("added"));
		add.onclick = () => changeQty(id, 1);
		host.appendChild(add);
		return;
	}

	const row = document.createElement("div");
	row.className = "qty__row";
	const btn = (label, delta, aria) => {
		const b = document.createElement("button");
		b.className = "qty__btn";
		b.textContent = label;
		b.setAttribute("aria-label", aria);
		b.onclick = () => changeQty(id, delta);
		return b;
	};
	const num = document.createElement("span");
	num.className = "qty__num";
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
	document.getElementById("barCount").textContent = I18N.itemsCount(count);
	document.getElementById("checkoutBtn").disabled = count === 0;
	renderBarThumbs();
	document.getElementById("mobileBar").classList.toggle("is-visible", count > 0);
}

/* Stacked thumbnails of what's in the cart, on the sticky bar. */
function renderBarThumbs() {
	const host = document.getElementById("barThumbs");
	host.innerHTML = "";
	Object.keys(cart).slice(0, 3).forEach((id) => {
		const p = products.find((x) => x.id === id);
		if (!p) return;
		const img = document.createElement("img");
		img.src = encodeURI(assetUrl(p.image));
		img.alt = "";
		img.loading = "lazy";
		img.className = "bar-thumbs__img";
		host.appendChild(img);
	});
}

function renderCartBody() {
	const body = document.getElementById("cartBody");
	const entries = Object.entries(cart).filter(([, q]) => q > 0);
	body.innerHTML = "";

	if (!entries.length) {
		body.innerHTML = `
			<div class="cart-empty">
				<p class="cart-empty__title">${escapeHtml(t("emptyCart"))}</p>
				<p class="cart-empty__sub">${escapeHtml(t("emptyCartSub"))}</p>
			</div>`;
		return;
	}

	entries.forEach(([id, q]) => {
		const p = products.find((x) => x.id === id);
		if (!p) return;
		const row = document.createElement("div");
		row.className = "cart-row";
		row.innerHTML = `
			<div class="cart-row__thumb">
				<img src="${encodeURI(assetUrl(p.image))}" alt="" loading="lazy" />
			</div>
			<div class="cart-row__info">
				<p class="cart-row__name">${escapeHtml(p.name)}</p>
				<p class="cart-row__price">${money(p.price)} × ${q} = <b>${money(p.price * q)}</b></p>
				<button class="cart-row__remove" data-remove>${escapeHtml(t("remove"))}</button>
			</div>
			<div class="qty qty--compact" data-qtybox="${p.id}"></div>`;
		row.querySelector("[data-remove]").onclick = () => setQty(id, 0);
		body.appendChild(row);
		renderQtyBox(row.querySelector(`[data-qtybox="${p.id}"]`), p.id);
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

const showCheckoutStep = () => { document.getElementById("orderForm").hidden = false; };
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
function openLightbox(index) {
	lbIndex = index;
	const lb = document.getElementById("lightbox");
	lb.hidden = false;
	lockScroll();
	requestAnimationFrame(() => lb.classList.add("is-visible"));
	paintLightbox();
}

function paintLightbox() {
	const p = visible[lbIndex];
	if (!p) return closeLightbox();
	const img = document.getElementById("lbImg");
	img.src = encodeURI(assetUrl(p.image));
	img.alt = p.name;
	document.getElementById("lbName").textContent = p.name;
	document.getElementById("lbCat").textContent = catName(p.category);
	document.getElementById("lbPrice").textContent = money(p.price);
	document.getElementById("lbCounter").textContent = `${lbIndex + 1} / ${visible.length}`;
	renderQtyBox(document.getElementById("lbQty"), p.id);

	// Warm the neighbours so swiping feels instant
	[-1, 1].forEach((d) => {
		const n = visible[(lbIndex + d + visible.length) % visible.length];
		if (n) new Image().src = encodeURI(assetUrl(n.image));
	});
}

function stepLightbox(delta) {
	if (!visible.length) return;
	lbIndex = (lbIndex + delta + visible.length) % visible.length;
	paintLightbox();
}

function closeLightbox() {
	const lb = document.getElementById("lightbox");
	if (lb.hidden) return;
	lb.classList.remove("is-visible");
	unlockScroll();
	setTimeout(() => {
		lb.hidden = true;
		const stage = document.getElementById("lbStage");
		stage.style.transform = "";
		stage.style.opacity = "";
	}, 200);
	document.getElementById("lbQty").removeAttribute("data-qtybox");
	lbIndex = -1;
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
	el.className = "toast" + (kind === "err" ? " toast--err" : "");
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
	if (!customerName) missing.push(["customerName", t("fName")]);
	if (!customerAddress) missing.push(["customerAddress", t("fAddress")]);

	const digits = phone.replace(/\D/g, "");
	let phoneErr = "";
	if (!phone) missing.push(["phone", t("fPhone")]);
	else if (digits.length !== 10) phoneErr = t("badPhone");

	if (missing.length || phoneErr) {
		missing.forEach(([id]) => el(id).classList.add("is-invalid"));
		if (phoneErr) el("phone").classList.add("is-invalid");
		const msg = [
			missing.length ? `${t("missing")} ${missing.map(([, l]) => l).join(t("listSep"))}` : "",
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
			const p = products.find((x) => x.id === id);
			return p && {
				id: p.id, name: p.name, category: catName(p.category),
				quantity: q, price: p.price, subtotal: p.price * q,
			};
		})
		.filter(Boolean);

	if (!orderItems.length) {
		notice(responseDiv, t("cartEmptyErr"), "err");
		return;
	}

	submitBtn.disabled = true;
	submitBtn.textContent = t("submitting");

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

		notice(responseDiv, t("success"), "ok");
		toast(t("success"));
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
		notice(responseDiv, t("failed"), "err");
	} finally {
		submitBtn.disabled = false;
		submitBtn.textContent = t("submit");
	}
}

function notice(host, msg, kind) {
	host.innerHTML = `<div class="notice notice--${kind}">${escapeHtml(msg)}</div>`;
}

/* ---------- copy ---------- */
function applyI18n() {
	document.querySelectorAll("[data-i18n]").forEach((el) => { el.textContent = t(el.dataset.i18n); });
	document.querySelectorAll("[data-i18n-placeholder]").forEach((el) => { el.placeholder = t(el.dataset.i18nPlaceholder); });
	document.querySelectorAll("[data-i18n-title]").forEach((el) => { el.title = t(el.dataset.i18nTitle); });

	const unitPrice = products.length ? Math.min(...products.map((p) => p.price)) : 5000;
	document.getElementById("statPrice").textContent = money(unitPrice);

	if (products.length) {
		renderFilters();
		renderStickerSubnav();
		renderGrid();
		renderCartBody();
		updateTotals();
		if (lbIndex >= 0) paintLightbox();
	}
}

/* ---------- helpers ---------- */
const escapeHtml = (s) =>
	String(s).replace(/[&<>"']/g, (c) =>
		({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const escapeAttr = escapeHtml;

function renderSkeleton() {
	document.getElementById("skeleton").innerHTML = Array.from({ length: 8 })
		.map(() => `
			<div class="skel-card">
				<div class="skel-card__media"></div>
				<div class="skel-card__lines">
					<div class="skel-line"></div>
					<div class="skel-line skel-line--sm"></div>
				</div>
			</div>`)
		.join("");
}

/* ---------- boot ---------- */
document.addEventListener("DOMContentLoaded", async () => {
	renderSkeleton();
	applyI18n();
	initSheetDrag();
	initLightboxSwipe();

	document.getElementById("cartBtn").onclick = openCart;
	document.getElementById("mobileCartBtn").onclick = openCart;
	document.getElementById("cartClose").onclick = closeCart;
	document.getElementById("cartOverlay").onclick = closeCart;
	document.getElementById("checkoutBtn").onclick = showCheckoutStep;
	document.getElementById("backToCart").onclick = showCartStep;
	document.getElementById("orderForm").onsubmit = submitOrder;

	document.getElementById("lbClose").onclick = closeLightbox;
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

	// Android back / browser back closes an open overlay instead of leaving the page
	addEventListener("popstate", () => {
		if (!document.getElementById("lightbox").hidden) closeLightbox();
		else if (!document.getElementById("cartDrawer").hidden) closeCart();
	});

	try {
		await fetchProducts();
		document.getElementById("statCount").textContent = products.length;
		renderFilters();
		renderStickerSubnav();
		renderGrid();
		renderCartBody();
		updateTotals();
	} catch (err) {
		console.error(err);
		const empty = document.getElementById("emptyState");
		empty.hidden = false;
		empty.textContent = t("failed");
	} finally {
		document.getElementById("skeleton").remove();
	}
});
