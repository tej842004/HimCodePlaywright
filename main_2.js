require("dotenv").config();

const { chromium } = require("playwright");

const { login } = require("./workflows/login");
const { transcriptions } = require("./workflows/transcriptions");
const { charges } = require("./workflows/charges");
const { problemlist } = require("./workflows/problemlist");
const { clinical_history } = require("./workflows/clinical_history");
const { order } = require("./workflows/orders");
const { notes } = require("./workflows/notes");

const { runPythonFunction } = require("./database/pythonRunner");
const { getPendingVisitKeys, closeDatabase } = require("./database/database");

async function main() {
  let browser;

  try {
    // =====================================================
    // 1. Start browser
    // =====================================================

    console.log("Starting browser...");

    browser = await chromium.launch({
      headless: false,
    });

    // =====================================================
    // 2. Create context
    // =====================================================

    const context = await browser.newContext();

    // =====================================================
    // 3. Create page
    // =====================================================

    const page = await context.newPage();

    // =====================================================
    // 4. Login ONCE
    // =====================================================

    await login(page);

    console.log("Login completed.");

    // =====================================================
    // 5. Get visit keys from database
    // =====================================================

    console.log("");
    console.log("========================================");
    console.log("GETTING VISITS FROM DATABASE");
    console.log("========================================");

    const visitKeys = await getPendingVisitKeys();

    console.log(`Total visits found: ${visitKeys.length}`);

    if (visitKeys.length === 0) {
      console.log("No visits found where updatedtime IS NULL.");
      return;
    }

    console.log("Visit keys:");

    visitKeys.forEach((visitKey, index) => {
      console.log(`${index + 1}. ${visitKey}`);
    });

    // =====================================================
    // 6. Process each visit
    // =====================================================

    for (const visitKey of visitKeys) {
      console.log("");
      console.log("========================================");
      console.log(`STARTING VISIT: ${visitKey}`);
      console.log("========================================");

      try {
        // -----------------------------------------------
        // TRANSCRIPTIONS
        // -----------------------------------------------

        console.log("");
        console.log(`Running transcriptions for ${visitKey}...`);

        const transcriptionData = await transcriptions(page, visitKey);

        console.log(`Transcriptions completed for ${visitKey}.`);

        // -----------------------------------------------
        // CHARGES
        // -----------------------------------------------

        console.log("");
        console.log(`Running charges for ${visitKey}...`);

        const chargeData = await charges(page, visitKey);

        console.log(`Charges completed for ${visitKey}.`);

        // -----------------------------------------------
        // PROBLEM LIST
        // -----------------------------------------------

        console.log("");
        console.log(`Running problem list for ${visitKey}...`);

        const problemListData = await problemlist(page, visitKey);

        console.log(`Problem List completed for ${visitKey}.`);

        // -----------------------------------------------
        // CLINICAL HISTORY
        // -----------------------------------------------

        console.log("");
        console.log(`Running clinical history for ${visitKey}...`);

        await clinical_history(page, visitKey);

        console.log(`Clinical History completed for ${visitKey}.`);

        // -----------------------------------------------
        // ORDER CHRONOLOGY
        // -----------------------------------------------

        console.log("");
        console.log(`Running order chronology for ${visitKey}...`);

        await order(page, visitKey);

        console.log(`Order Chronology completed for ${visitKey}.`);

        // -----------------------------------------------
        // NOTES
        // -----------------------------------------------

        console.log("");
        console.log(`Running notes for ${visitKey}...`);

        const notesData = await notes(page, visitKey);

        console.log(`Notes completed for ${visitKey}.`);

        // -----------------------------------------------
        // BUILD combine_json
        // -----------------------------------------------

        let combine_json = "";

        combine_json += `Visit_key :${visitKey}`;

        combine_json += JSON.stringify(transcriptionData);

        combine_json += JSON.stringify(chargeData);

        combine_json += JSON.stringify(problemListData);

        combine_json += JSON.stringify(notesData);

        // -----------------------------------------------
        // INSERT ENCOUNTER AI CODE SNAPSHOT
        // -----------------------------------------------

        console.log("");
        console.log(`Saving encounter AI code snapshot for ${visitKey}...`);

        const snapshotResult = await runPythonFunction(
          "insert_encounter_ai_code_snapshot",
          [visitKey, combine_json, "mistral-small-latest"],
          //[visitKey, combine_json, "zai-glm-5-2"],
          // [visitKey, combine_json, "GPT-5.6 Sol"],
        );

        if (snapshotResult.success && snapshotResult.result) {
          console.log(
            `Encounter AI code snapshot saved successfully for ${visitKey}.`,
          );
        } else {
          console.log(
            `Encounter AI code snapshot was NOT saved for ${visitKey}.`,
          );
        }

        // -----------------------------------------------
        // UPDATE TIME
        // -----------------------------------------------

        console.log("");
        console.log(`Updating time for ${visitKey}...`);

        const updateTimeResult = await runPythonFunction("updatetime", [
          visitKey,
        ]);

        if (updateTimeResult.success && updateTimeResult.result) {
          console.log(`Time updated successfully for ${visitKey}.`);
        } else {
          console.log(`Time was NOT updated for ${visitKey}.`);
        }

        // -----------------------------------------------
        // VISIT COMPLETED
        // -----------------------------------------------

        console.log("");
        console.log("========================================");
        console.log(`VISIT COMPLETED: ${visitKey}`);
        console.log("========================================");
      } catch (error) {
        console.error("");
        console.error(`FAILED VISIT: ${visitKey}`);
        console.error(error);

        // Continue to next visit
        continue;
      }
    }

    console.log("");
    console.log("========================================");
    console.log("ALL VISITS COMPLETED");
    console.log("========================================");
  } catch (error) {
    console.error("MAIN WORKFLOW FAILED:");
    console.error(error);
  } finally {
    // =====================================================
    // Close browser
    // =====================================================

    if (browser) {
      console.log("Closing browser...");
      await browser.close();
    }

    // =====================================================
    // Close database connection
    // =====================================================

    try {
      await closeDatabase();
      console.log("Database connection closed.");
    } catch (error) {
      console.error("Error closing database:", error);
    }
  }
}

main();
