const { chromium } = require("playwright");

const { login } = require("../workflows/login");
const { clinical_history } = require("../workflows/clinical_history");

const { fetch_updated_records, closeDatabase } = require("../database/database");

async function main() {
  let browser;

  try {
    // =====================================================
    // 1. Fetch visits from database
    // =====================================================

    console.log("Fetching updated records from database...");

    const visitKeys = await fetch_updated_records();

    console.log(`Found ${visitKeys.length} visit(s).`);

    if (visitKeys.length === 0) {
      console.log("No updated records found.");
      return;
    }

    // =====================================================
    // 2. Start browser
    // =====================================================

    console.log("Starting browser...");

    browser = await chromium.launch({
      headless: false,
    });

    // =====================================================
    // 3. Create context
    // =====================================================

    const context = await browser.newContext();

    // =====================================================
    // 4. Create page
    // =====================================================

    const page = await context.newPage();

    // =====================================================
    // 5. Login ONCE
    // =====================================================

    await login(page);

    console.log("Login completed.");

    // =====================================================
    // 6. Process each visit
    // =====================================================

    for (const visitKey of visitKeys) {
      console.log("");
      console.log("========================================");
      console.log(`STARTING VISIT: ${visitKey}`);
      console.log("========================================");

      try {
        // =================================================
        // Run Clinical History
        // =================================================

        console.log("");
        console.log(`Running Clinical History for ${visitKey}...`);

        await clinical_history(page, visitKey);

        console.log(`Clinical History completed for ${visitKey}.`);

        console.log("");
        console.log(`VISIT COMPLETED: ${visitKey}`);
      } catch (error) {
        console.error("");
        console.error(`FAILED VISIT: ${visitKey}`);
        console.error(error);

        // Continue with next visit
        continue;
      }
    }

    // =====================================================
    // 7. All visits completed
    // =====================================================

    console.log("");
    console.log("========================================");
    console.log("ALL VISITS COMPLETED");
    console.log("========================================");
  } catch (error) {
    console.error("");
    console.error("========================================");
    console.error("MAIN WORKFLOW FAILED");
    console.error("========================================");

    console.error(error);
  } finally {
    // =====================================================
    // 8. Close browser
    // =====================================================

    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }

    // =====================================================
    // 9. Close database
    // =====================================================

    await closeDatabase();
  }
}

main();
