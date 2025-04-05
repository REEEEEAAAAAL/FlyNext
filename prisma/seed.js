const { PrismaClient } = require("@prisma/client");
const fs = require("fs");
const path = require("path");

const prisma = new PrismaClient();

async function main() {
	await prisma.$transaction([
		prisma.airport.deleteMany(),
		prisma.city.deleteMany(),
	]);
	// seed cities
	const cities = JSON.parse(
		fs.readFileSync("prisma/seed_data/cities.json", "utf-8")
	);

	await prisma.city.createMany({
		data: cities.map((city) => ({
			name: city.city,
			country: city.country,
		})),
	});

	// city
	const cityRecords = await prisma.city.findMany();
	const cityNameToId = new Map(
		cityRecords.map((city) => [city.name, city.id])
	);

	// seed airports
	const airports = JSON.parse(
		fs.readFileSync("prisma/seed_data/airports.json", "utf-8")
	);

	await prisma.airport.createMany({
		data: airports.map((airport) => {
			const cityId = cityNameToId.get(airport.city);
			if (!cityId) {
				throw new Error(`City not found: ${airport.city}`);
			}
			return {
				externalId: airport.id,
				code: airport.code,
				name: airport.name,
				cityId: cityId,
				country: airport.country,
			};
		}),
	});

	// generate_data.sql
	const sqlPath = path.join(__dirname, "generate_data.sql");
	const sql = fs.readFileSync(sqlPath, "utf-8");
	await prisma.$executeRawUnsafe(sql);
	console.log("Additional SQL data seeded successfully.");
}

main()
	.catch((e) => {
		console.error(e);
		process.exit(1);
	})
	.finally(async () => {
		await prisma.$disconnect();
	});
