const fs = require("fs");
const path = require("path");

async function scrapeDirectory(directoryPath, outputFileName = "output.json") {
	let idCounter = 1;
	const result = [];

	try {
		const folders = await fs.promises.readdir(directoryPath, {
			withFileTypes: true,
		});

		for (const folder of folders) {
			if (folder.isDirectory()) {
				const categoryName = folder.name;
				const folderPath = path.join(directoryPath, folder.name);

				const files = await fs.promises.readdir(folderPath, {
					withFileTypes: true,
				});

				for (const file of files) {
					if (file.isFile()) {
						result.push({
							id: idCounter++,
							name: path.parse(file.name).name, // Get file name without extension
							price: 5000, // Always 10
							image: path.join(categoryName, file.name), // Relative path to the image
							category: categoryName,
						});
					}
				}
			}
		}

		// Save the result to a JSON file
		const outputPath = path.join(directoryPath, outputFileName);
		await fs.promises.writeFile(outputPath, JSON.stringify(result, null, 4));
		console.log(`Data successfully saved to ${outputPath}`);
	} catch (err) {
		console.error("Error scraping directory:", err);
	}

	return result;
}

// Example usage:
const currentDirectory = "."; // Scrape the current directory
scrapeDirectory(currentDirectory, "scraped_data.json")
	.then((data) => {
		// You can optionally do something with the data here if needed
		// console.log(data); // If you still want to log it to console
	})
	.catch((error) => {
		console.error("Failed to scrape directory:", error);
	});

