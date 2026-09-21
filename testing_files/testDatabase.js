const { getUncodedVisits, closeDatabase } = require("../database");

async function main() {
  try {
    const visits = await getUncodedVisits();

    console.log(`Found ${visits.length} uncoded visit(s)\n`);

    for (const visit of visits) {
      console.log(
        `Visit Key: ${visit.visitKey} | Visit Number: ${visit.visitNumber}`,
      );
    }
  } catch (error) {
    console.error("Database error:", error.message);
  } finally {
    await closeDatabase();
  }
}

main();
