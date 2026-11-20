import { defineConfig } from "vite";
import tailwindcss from "@tailwindcss/vite";
import sharp from "sharp";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { catalogImageRoots, isCatalogImage, thumbnailWidths } from "./src/catalog-images.js";

const root = path.dirname(fileURLToPath(import.meta.url));

/** Catalog image folders + generated JSON stay at repo root; serve/copy them for Vite. */
const CATALOG = [...catalogImageRoots, "products.json", "catalog-nav.json"];

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

	async function makeThumbnails(outDir, directory) {
		const entries = await fs.promises.readdir(path.join(root, directory), { withFileTypes: true });
		for (const entry of entries) {
			const image = `${directory}/${entry.name}`;
			if (entry.isDirectory()) {
				await makeThumbnails(outDir, image);
			} else if (entry.isFile() && isCatalogImage(image)) {
				await Promise.all(thumbnailWidths.map(async (width) => {
					const target = path.join(outDir, "thumbnails", String(width), `${image}.webp`);
					await fs.promises.mkdir(path.dirname(target), { recursive: true });
					await sharp(path.join(root, image)).rotate().resize({ width }).webp({ quality: 78 }).toFile(target);
				}));
			}
		}
	}

	return {
		name: "dama-catalog-static",
		configureServer(server) {
			server.middlewares.use((req, res, next) => {
				let rel;
				try {
					rel = decodeURIComponent((req.url || "").split("?")[0]).replace(/^\//, "");
				} catch {
					return next();
				}
				if (rel.includes("\\") || rel.split("/").includes("..")) return next();
				if (!rel || !isCatalog(rel)) return next();
				const file = path.join(root, rel);
				if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) return next();
				const ext = path.extname(file).toLowerCase();
				res.setHeader("Content-Type", MIME[ext] || "application/octet-stream");
				fs.createReadStream(file).pipe(res);
			});
		},
		async writeBundle({ dir }) {
			copyInto(dir);
			await Promise.all(catalogImageRoots.filter((directory) => fs.existsSync(path.join(root, directory)))
				.map((directory) => makeThumbnails(dir, directory)));
		},
	};
}

export default defineConfig({
	plugins: [tailwindcss(), catalogStatic()],
	server: {
		port: 5173,
		open: false,
		proxy: Object.fromEntries(["/api", "/media", "/mcp"].map((path) => [path, "http://127.0.0.1:3000"])),
	},
	build: {
		outDir: "dist",
		emptyOutDir: true,
		rollupOptions: {
			input: {
				main: path.join(root, "index.html"),
				admin: path.join(root, "admin.html"),
			},
		},
	},
});
