export const catalogImageRoots = [
	"Stickers", "backboneAndStories", "blackAndWhite", "life", "newThings",
	"nostalgia", "Tshirts", "Posters",
];
export const thumbnailWidths = [384, 768];
export const cardImageSizes = [
	"(min-width: 80rem) 224px",
	"(min-width: 64rem) calc((100vw - 9rem) / 5)",
	"(min-width: 48rem) calc((100vw - 6rem) / 3)",
	"(min-width: 40rem) calc((100vw - 4.5rem) / 2)",
	"calc((100vw - 2.75rem) / 2)",
].join(", ");

export function isCatalogImage(path) {
	return catalogImageRoots.includes(path.split("/")[0]) && /\.(?:jpe?g|png|webp)$/i.test(path);
}

export function cardImageSrcset(path) {
	if (!isCatalogImage(path)) return "";
	const encoded = path.split("/").map(encodeURIComponent).join("/");
	return thumbnailWidths.map((width) => `/thumbnails/${width}/${encoded}.webp ${width}w`).join(", ");
}
