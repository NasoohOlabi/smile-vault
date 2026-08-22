import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Catalog image folders + generated JSON stay at repo root; serve/copy them for Vite. */
const CATALOG = [
	"Stickers",
	"backboneAndStories",
	"blackAndWhite",
	"life",
	"newThings",
	"nostalgia",
	"Tshirts",
	"Posters",
	"products.json",
	"catalog-nav.json",
];

const MIME = {
	".png": "image/png",
	".jpg": "image/jpeg",
	".jpeg": "image/jpeg",
	".webp": "image/webp",
	".gif": "image/gif",
	".svg": "image/svg+xml",
	".json": "application/json; charset=utf-8",
};

function catalogStatic() {
	const isCatalog = (rel) => {
		const top = rel.split("/")[0];
		if (CATALOG.includes(top) || CATALOG.includes(rel)) return true;
		if (top === "assets" && /\.(png|jpe?g|webp|gif|svg)$/i.test(rel)) return true;
		return false;
	};

	const copyInto = (outDir) => {
		for (const item of CATALOG) {
			const src = path.join(root, item);
			if (!fs.existsSync(src)) continue;
			fs.cpSync(src, path.join(outDir, item), { recursive: true });
		}
		const assetsSrc = path.join(root, "assets");
		const assetsOut = path.join(outDir, "assets");
		fs.mkdirSync(assetsOut, { recursive: true });
		for (const name of fs.readdirSync(assetsSrc)) {
			if (/\.(png|jpe?g|webp|gif|svg)$/i.test(name)) {
				fs.copyFileSync(path.join(assetsSrc, name), path.join(assetsOut, name));
			}
		}
	};

	return {
		name: "dama-catalog-static",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				const rel = decodeURIComponent((req.url || "").split("?")[0]).replace(/^\//, "");
				if (!rel || !isCatalog(rel)) return next();
				const file = path.join(root, rel);
				if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
				const ext = path.extname(file).toLowerCase();
				res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
				fs.createReadStream(file).pipe(res);
			});
		},
		writeBundle(_opts, _bundle) {
			copyInto(path.join(root, "dist"));
		},
	};
}

function ordersProxy() {
	return {
		name: "dama-orders-proxy",
		configureServer(server) {
			server.middlewares.use(async (req, res, next) => {
				if (!(req.url || "").startsWith("/__dama_orders")) return next();
				try {
					const upstream = await fetch("https://docs.google.com/spreadsheets/d/1W2wjikf5fOYqkaY5Qoal4820Z5WYw2FiIZyU8JNIJZY/gviz/tq?tqx=out:json&gid=0");
					res.statusCode = upstream.status;
					res.setHeader("Content-Type", "application/json; charset=utf-8");
					res.end(await upstream.text());
				} catch {
					res.statusCode = 502;
					res.end(JSON.stringify({ error: "Orders sheet unavailable" }));
				}
			});
		},
	};
}

export default defineConfig({
	plugins: [tailwindcss(), catalogStatic(), ordersProxy()],
	server: {
		port: 5173,
		open: false,
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: path.join(root, "index.html"),
				orders: path.join(root, "orders.html"),
			},
		},
	},
});
