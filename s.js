import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const PRICE = 350;
const IMAGE_EXT = /\.(jpe?g|png|webp|gif)$/i;

const CURATED_TITLES = {
	"bg designs.jpg": "Dead Love Pack",
	"bg designs 02.jpg": "Homeland Pack",
	"bg designs 03.jpg": "From Damascus Pack",
	"bg designs 06.jpg": "Between Us Pack",
	"bg designs 9.jpg": "Internal Tourism Pack",
};

const NUGGET_TITLES = {
	"02 ع-small.png": "Kohl Pot",
	"03 ع-small.png": "Best Shawarma",
	"04 ع-small.png": "Loose Weapon",
	"05 ع-small.png": "Stamp Sheet One",
	"06 ع-small.png": "Stamp Sheet Two",
	"07 ع-small.png": "War Is Bad For You",
	"08 ع-small.png": "Official Speaker",
	"09 ع-small.png": "Five Piastres",
	"10 ع-small.png": "All Eyes",
	"11 ع-small.png": "Five Lira",
	"12 ع-small.png": "One Lira",
	"15 ع-small.png": "Damascus Window",
	"19 ع-small.png": "Ease Our Minds",
	"20 ع-small.png": "Coffee Cups",
	"21 ع-small.png": "Black Ink One",
	"22 ع-small.png": "Black Ink Two",
	"23 ع-small.png": "Square Mosaic Box",
	"24 ع-small.png": "No Going Back",
	"25 ع-small.png": "Octagon Mosaic Box",
	"26 ع-small.png": "Fresh Cut",
	"27 ع-small.png": "TV Table",
	"29 ع-small.png": "City Life",
	"32 ع-small.png": "Black Ink Three",
	"34 ع-small.png": "New Signal",
	"36 ع-small.png": "Bright Edge",
	"37 ع-small.png": "Local Merch",
	"39 ع (2)-small.png": "Black Ink Four",
	"40 ع-small.png": "Yellow Horizon",
	"47 ع-small.png": "Take a Stand",
	"49 ع-small.png": "Black Ink Five",
	"51 ع-small.png": "Nothing Happened Sketch",
	"52 ع-small.png": "Daily Route",
	"55 ع-small.png": "Street Pulse",
	"56 ع-small.png": "Welcome to Damascus",
	"61 ع-small.png": "Soft Landing",
	"62 ع-small.png": "Black Ink Six",
	"63 ع-small.png": "Black Ink Seven",
	"64 ع-small.png": "Welcome 3 Damascus",
	"65 ع-small.png": "Black Ink Eight",
	"66 ع (2)-small.png": "Shawarma Star",
	"67 ع (2)-small.png": "Black Ink Nine",
	"75 ع-small.png": "Damascus Shabak",
	"76 ع-small.png": "Jenin Jenin",
	"78 ع-small.png": "Crossword",
	"80 ع-small.png": "Watermelon Fountain",
	"83 L-small.png": "On-the-Go Portrait",
	"84 ع-small.png": "House Keys",
	"85 ع-small.png": "Fall Forever",
	"87 ع-small.png": "Heart Trademark",
	"90 ع-small.png": "That Ice Cream",
	"91 ع-small.png": "Jasmine City",
	"92 ع-small.png": "North Star",
	"96 ع-small.png": "Protect Her",
	"98 ع-small.png": "Freedom Is Duty",
	"100 ع-small.png": "This Frog Wont Boil",
	"201 ع-small.png": "Nothing Happened",
	"1011-small.png": "For the Era",
	"1012 2-small.png": "Resistance Is Not Cool",
	"1014 ع-small.png": "Wake Up Girl",
	"1014-small.png": "Wake Up Boy",
	"10189-small.png": "Life Frame",
	"897 ش-small.png": "Thirty on Me",
	"897-small.png": "Got Thirty?",
	"Matisse - Dance but Syrian-small.png": "Syrian Dance",
	"mirro3r ع-small.png": "Mirror Mad Damascus",
	"mirror ع-small.png": "Inlaid Mirror",
};

function listImages(dir) {
	if (!fs.existsSync(dir)) return [];
	return fs
		.readdirSync(dir, { withFileTypes: true })
		.filter((f) => f.isFile() && IMAGE_EXT.test(f.name))
		.map((f) => f.name)
		.sort((a, b) => a.localeCompare(b, undefined, { sensitivity: "base" }));
}

function fallbackTitle(fileName) {
	let stem = path.parse(fileName).name;
	stem = stem
		.replace(/-small$/i, "")
		.replace(/\s*ع$/u, "")
		.replace(/\s*ش$/u, "")
		.replace(/\s*L$/i, "")
		.replace(/\s*\(2\)$/, "")
		.trim();
	return `Nugget ${stem}`;
}

function shirtTitle(fileName) {
	return path.parse(fileName).name.replace(/_/g, " ").trim();
}

function buildCatalog() {
	const products = [];
	let id = 1;

	const stickerSections = [
		{ folder: "Curated Collections", section: "curated", titles: CURATED_TITLES },
		{ folder: "Nuggets", section: "nuggets", titles: NUGGET_TITLES },
	];

	for (const { folder, section, titles } of stickerSections) {
		const dir = path.join(root, "Stickers", folder);
		for (const fileName of listImages(dir)) {
			products.push({
				id: id++,
				name: titles[fileName] || fallbackTitle(fileName),
				price: PRICE,
				image: `Stickers/${folder}/${fileName}`,
				type: "Stickers",
				section,
				category: section,
			});
		}
	}

	const shirtsDir = path.join(root, "Tshirts");
	for (const fileName of listImages(shirtsDir)) {
		products.push({
			id: id++,
			name: shirtTitle(fileName),
			price: PRICE,
			image: `Tshirts/${fileName}`,
			type: "Tshirts",
			category: "tshirts",
		});
	}

	return products;
}

const products = buildCatalog();
const outPath = path.join(root, "products.json");
fs.writeFileSync(outPath, `${JSON.stringify(products, null, 4)}\n`, "utf8");

const curated = products.filter((p) => p.section === "curated").length;
const nuggets = products.filter((p) => p.section === "nuggets").length;
const shirts = products.filter((p) => p.type === "Tshirts").length;
const fallbacks = products.filter((p) => String(p.name).startsWith("Nugget "));

console.log(`Wrote ${products.length} products → ${outPath}`);
console.log(`  Stickers curated: ${curated}`);
console.log(`  Stickers nuggets: ${nuggets}`);
console.log(`  Tshirts: ${shirts}`);
console.log(`  Price: ${PRICE}`);
if (fallbacks.length) {
	console.log("  Fallback titles:");
	for (const p of fallbacks) console.log(`    ${p.image} → ${p.name}`);
}
