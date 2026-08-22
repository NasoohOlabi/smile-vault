import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const SHOP_DIR = path.join(root, "catalog", "shop");
const DEFAULT_PRICE = 350;

/** Minimal YAML loader for catalog files (maps, lists, quotes, folded `>`). */
function loadYaml(text) {
	const lines = String(text || "").replace(/\t/g, "  ").split(/\r?\n/);
	let i = 0;

	const peek = () => (i < lines.length ? lines[i] : null);
	const indentOf = (line) => (/^ */.exec(line) || [""])[0].length;

	function skipBlankAndComments() {
		while (i < lines.length) {
			const line = lines[i];
			if (!line.trim() || line.trimStart().startsWith("#")) {
				i++;
				continue;
			}
			break;
		}
	}

	function parseScalar(raw) {
		const s = String(raw ?? "").trim();
		if (s === "[]") return [];
		if (s === "{}" ) return {};
		if (s === "null" || s === "~" || s === "") return null;
		if (s === "true") return true;
		if (s === "false") return false;
		if (/^-?\d+(\.\d+)?$/.test(s)) return Number(s);
		if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
			const q = s[0];
			return s.slice(1, -1).replace(new RegExp(`\\\\${q}`, "g"), q).replace(/\\n/g, "\n");
		}
		return s;
	}

	function parseFolded(baseIndent) {
		i++;
		const parts = [];
		while (i < lines.length) {
			const line = lines[i];
			if (!line.trim()) {
				parts.push("");
				i++;
				continue;
			}
			if (indentOf(line) <= baseIndent) break;
			parts.push(line.slice(baseIndent).replace(/^  /, ""));
			i++;
		}
		return parts.join(" ").replace(/ +/g, " ").trim();
	}

	function parseBlock(minIndent) {
		skipBlankAndComments();
		const first = peek();
		if (first == null) return null;
		const ind = indentOf(first);
		if (ind < minIndent) return null;

		if (first.trimStart().startsWith("- ")) {
			const list = [];
			while (i < lines.length) {
				skipBlankAndComments();
				const line = peek();
				if (line == null) break;
				if (indentOf(line) < ind) break;
				if (!line.trimStart().startsWith("- ")) break;
				const itemIndent = indentOf(line);
				const rest = line.trimStart().slice(2);
				i++;
				if (!rest) {
					list.push(parseBlock(itemIndent + 2));
				} else if (rest.includes(": ") || /:$/.test(rest)) {
					// Inline first key on the dash line, then more keys at itemIndent+2
					const obj = {};
					const ci = rest.indexOf(":");
					const k = rest.slice(0, ci).trim();
					const v = rest.slice(ci + 1).trim();
					if (!v) obj[k] = parseBlock(itemIndent + 2);
					else if (v === ">" || v === "|") obj[k] = parseFolded(itemIndent);
					else obj[k] = parseScalar(v);
					Object.assign(obj, parseMapContinuation(itemIndent + 2) || {});
					list.push(obj);
				} else {
					list.push(parseScalar(rest));
				}
			}
			return list;
		}

		return parseMapContinuation(ind);
	}

	function parseMapContinuation(ind) {
		const obj = {};
		let any = false;
		while (i < lines.length) {
			skipBlankAndComments();
			const line = peek();
			if (line == null) break;
			const cur = indentOf(line);
			if (cur < ind) break;
			if (cur > ind) break;
			if (line.trimStart().startsWith("- ")) break;
			const trimmed = line.trim();
			const ci = trimmed.indexOf(":");
			if (ci < 0) break;
			const key = trimmed.slice(0, ci).trim();
			const val = trimmed.slice(ci + 1).trim();
			i++;
			any = true;
			if (!val) obj[key] = parseBlock(ind + 2);
			else if (val === ">" || val === "|") obj[key] = parseFolded(ind);
			else obj[key] = parseScalar(val);
		}
		return any ? obj : null;
	}

	const doc = parseBlock(0);
	return doc == null ? {} : doc;
}

function readYaml(filePath) {
	if (!fs.existsSync(filePath)) return null;
	const raw = fs.readFileSync(filePath, "utf8");
	if (!raw.trim()) return null;
	return loadYaml(raw);
}

function loadMeta(dir) {
	return readYaml(path.join(dir, "_meta.yaml")) || {};
}

function humanize(slug) {
	return String(slug || "")
		.split("-")
		.filter(Boolean)
		.map((w) => w.charAt(0).toUpperCase() + w.slice(1))
		.join(" ");
}

function typeLabel(slug, meta) {
	if (meta.label) return meta.label;
	const known = {
		posters: "Posters",
		stickers: "Stickers",
		tshirts: "Tshirts",
		hoodies: "Hoodies",
		collabs: "Collabs",
	};
	return known[slug] || humanize(slug);
}

function listChildDirs(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((d) => d.isDirectory())
		.map((d) => d.name)
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function orderedChildDirs(dir, meta) {
	const kids = listChildDirs(dir);
	const order = Array.isArray(meta.order) ? meta.order : [];
	const seen = new Set();
	const out = [];
	for (const id of order) {
		if (kids.includes(id) && !seen.has(id)) {
			out.push(id);
			seen.add(id);
		}
	}
	for (const id of kids) {
		if (!seen.has(id)) out.push(id);
	}
	return out;
}

function resolvePrice(value, fallback) {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (value == null || value === "") return fallback;
	const n = Number(String(value).trim());
	return Number.isFinite(n) ? n : fallback;
}

function normalizeItems(doc) {
	if (!doc) return { price: DEFAULT_PRICE, items: [] };
	const price = resolvePrice(doc.price, DEFAULT_PRICE);
	let items = doc.items;
	if (!items && Array.isArray(doc)) items = doc;
	if (!Array.isArray(items)) items = [];
	return { price, items };
}

function pushProduct(products, {
	title,
	price,
	image,
	type,
	section,
	variantColor,
	variantSide,
	variantDefault,
	defaultSide,
}) {
	const product = {
		id: products.length + 1,
		name: title,
		title,
		price,
		image,
		type,
	};
	if (variantColor != null && variantColor !== "") product.variantColor = String(variantColor);
	if (variantSide) product.variantSide = variantSide;
	if (variantDefault) product.variantDefault = true;
	if (defaultSide) product.defaultSide = defaultSide;
	if (section) {
		product.section = section;
		product.category = section;
	} else {
		product.category = type.toLowerCase();
	}
	products.push(product);
}

function isTruthyDefault(v) {
	return v === true || v === "true" || v === "yes" || v === 1 || v === "1";
}

function expandItemImages(raw, defaultPrice) {
	const title = String(raw.title || raw.name || "").trim();
	if (!title) return [];
	const price = resolvePrice(raw.price, defaultPrice);
	const itemDefaultColor =
		raw.defaultColor == null || raw.defaultColor === ""
			? null
			: String(raw.defaultColor).trim();
	const itemDefaultSide = ["front", "back"].includes(String(raw.defaultSide || "").trim())
		? String(raw.defaultSide).trim()
		: null;
	const rows = [];

	if (Array.isArray(raw.variants) && raw.variants.length) {
		for (const v of raw.variants) {
			if (!v || typeof v !== "object") continue;
			const color = v.color == null || v.color === "" ? "" : String(v.color).trim();
			const vPrice = resolvePrice(v.price, price);
			const isDefault =
				isTruthyDefault(v.default) ||
				(itemDefaultColor != null && color === itemDefaultColor);
			const variantDefaultSide = ["front", "back"].includes(String(v.defaultSide || "").trim())
				? String(v.defaultSide).trim()
				: itemDefaultSide;
			const sides = [
				["front", v.front],
				["back", v.back],
			];
			let any = false;
			for (const [side, img] of sides) {
				const image = String(img || "").trim();
				if (!image) continue;
				any = true;
				rows.push({
					title,
					price: vPrice,
					image,
					variantColor: color,
					variantSide: side,
					variantDefault: isDefault,
					defaultSide: isDefault ? variantDefaultSide : null,
				});
			}
			const lone = String(v.image || "").trim();
			if (!any && lone) {
				rows.push({
					title,
					price: vPrice,
					image: lone,
					variantColor: color,
					variantSide: color ? "back" : "",
					variantDefault: isDefault,
					defaultSide: isDefault ? variantDefaultSide : null,
				});
			}
		}
		return rows;
	}

	const image = String(raw.image || "").trim();
	if (image) rows.push({ title, price, image });
	return rows;
}

function pushProducts(products, { type, section, itemsDoc }) {
	const { price: defaultPrice, items } = normalizeItems(itemsDoc);
	for (const raw of items) {
		if (!raw || typeof raw !== "object") continue;
		for (const row of expandItemImages(raw, defaultPrice)) {
			pushProduct(products, { ...row, type, section });
		}
	}
}

function build() {
	const products = [];
	const types = [];
	const shopMeta = loadMeta(SHOP_DIR);
	const typeSlugs = orderedChildDirs(SHOP_DIR, shopMeta);

	for (const typeSlug of typeSlugs) {
		const typeDir = path.join(SHOP_DIR, typeSlug);
		const typeMeta = loadMeta(typeDir);
		const type = typeLabel(typeSlug, typeMeta);
		const leafItemsPath = path.join(typeDir, "items.yaml");
		const sectionSlugs = orderedChildDirs(typeDir, typeMeta);

		if (fs.existsSync(leafItemsPath)) {
			pushProducts(products, {
				type,
				section: null,
				itemsDoc: readYaml(leafItemsPath),
			});
			types.push({ id: type, slug: typeSlug, label: type, sections: [] });
			continue;
		}

		const sections = [];
		for (const sectionSlug of sectionSlugs) {
			const sectionDir = path.join(typeDir, sectionSlug);
			const sectionMeta = loadMeta(sectionDir);
			const itemsPath = path.join(sectionDir, "items.yaml");
			if (!fs.existsSync(itemsPath)) continue;

			const section = {
				id: sectionSlug,
				label: sectionMeta.label || humanize(sectionSlug),
			};
			if (sectionMeta.feature && typeof sectionMeta.feature === "object") {
				const feature = { ...sectionMeta.feature };
				if (typeof feature.copy === "string") feature.copy = feature.copy.trim();
				section.feature = feature;
			}
			sections.push(section);

			pushProducts(products, {
				type,
				section: sectionSlug,
				itemsDoc: readYaml(itemsPath),
			});
		}

		types.push({ id: type, slug: typeSlug, label: type, sections });
	}

	return {
		products,
		nav: { types },
	};
}

const { products, nav } = build();
const productsPath = path.join(root, "products.json");
const navPath = path.join(root, "catalog-nav.json");

fs.writeFileSync(productsPath, `${JSON.stringify(products, null, 4)}\n`, "utf8");
fs.writeFileSync(navPath, `${JSON.stringify(nav, null, 4)}\n`, "utf8");

const byType = Object.create(null);
for (const p of products) {
	const key = p.section ? `${p.type}/${p.section}` : p.type;
	byType[key] = (byType[key] || 0) + 1;
}

console.log(`Wrote ${products.length} products → ${productsPath}`);
console.log(`Wrote nav (${nav.types.length} types) → ${navPath}`);
for (const [k, n] of Object.entries(byType)) console.log(`  ${k}: ${n}`);
