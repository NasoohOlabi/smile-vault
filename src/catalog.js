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
export const TSHIRT_SIZES = ["S", "M", "L"];

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

export function groupTshirts(raw) {
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

export function isShirt(p) {
	const type = p?.type || "";
	return type === "Tshirts" || type === "Collabs";
}

export function parseLineId(id) {
	id = String(id);
	const i = id.lastIndexOf("::");
	if (i > 0) {
		const size = id.slice(i + 2);
		if (TSHIRT_SIZES.includes(size)) return { skuId: id.slice(0, i), size };
	}
	return { skuId: id, size: null };
}

export function resolveCatalogLine(products, id) {
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


export function productSection(product) {
	return product.section || product.category;
}
