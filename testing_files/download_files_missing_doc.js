require("dotenv").config();

const { chromium } = require("playwright");
const fs = require("fs");
const path = require("path");

const {
  getVisitsWithMissingDocuments,
  markVisitAsDownloaded,
  closeDatabase,
} = require("../database/database");

const { login } = require("../workflows/login");

// =====================================================
// INPUT FILE
// =====================================================

const INPUT_VISITS_FILE = path.join(
  __dirname,
  "missing_physician_order_visits.txt",
);

// =====================================================
// OUTPUT FILE
//
// This will be created in the project folder:
//
// C:\Users\Administrator\Desktop\HimCodePlaywright\
//     missing_physician_orders.txt
// =====================================================

const NO_PHYSICIAN_ORDER_FILE = path.join(
  __dirname,
  "missing_physician_orders.txt",
);

// =====================================================
// Read visit keys
// =====================================================

function readVisitKeys() {
  if (!fs.existsSync(INPUT_VISITS_FILE)) {
    throw new Error(`Input visit file not found:\n${INPUT_VISITS_FILE}`);
  }

  const content = fs.readFileSync(INPUT_VISITS_FILE, "utf8");

  const visitKeys = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /^V-\d+$/.test(line));

  // Remove duplicates
  return [...new Set(visitKeys)];
}

// =====================================================
// Add visit key to "no physician orders" TXT
// =====================================================

function addNoPhysicianOrderVisit(visitKey) {
  let existing = new Set();

  if (fs.existsSync(NO_PHYSICIAN_ORDER_FILE)) {
    const content = fs.readFileSync(NO_PHYSICIAN_ORDER_FILE, "utf8");

    existing = new Set(
      content
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean),
    );
  }

  if (existing.has(visitKey)) {
    console.log(
      `Visit ${visitKey} is already present in ${path.basename(
        NO_PHYSICIAN_ORDER_FILE,
      )}.`,
    );

    return;
  }

  fs.appendFileSync(NO_PHYSICIAN_ORDER_FILE, `${visitKey}\n`, "utf8");

  console.log(`Added ${visitKey} to ${NO_PHYSICIAN_ORDER_FILE}`);
}

// =====================================================
// Download Physician Orders
//
// Returns:
//   true  = at least one Physician Order downloaded
//   false = no Physician Orders found
// =====================================================

async function downloadPhysicianOrders(page, visitNumber) {
  console.log("\n========================================");
  console.log("Looking for Physician Orders...");
  console.log("========================================");

  const baseDownloadFolder = path.join(__dirname, "him_coded_downloaded_files");

  if (!fs.existsSync(baseDownloadFolder)) {
    fs.mkdirSync(baseDownloadFolder, {
      recursive: true,
    });
  }

  // -----------------------------------------------------
  // Find Physician Orders
  // -----------------------------------------------------

  const getPhysicianOrders = () =>
    page.locator("vaadin-grid-cell-content").filter({
      has: page
        .locator('span#descimg[ctrl-name="descimg"][send-click="true"]')
        .filter({
          hasText: /^PHYSICIAN ORDERS$/,
        }),
    });

  let physicianOrders = getPhysicianOrders();

  const count = await physicianOrders.count();

  console.log(`Found ${count} Physician Order document(s).`);

  // -----------------------------------------------------
  // NO PHYSICIAN ORDERS
  // -----------------------------------------------------

  if (count === 0) {
    console.log("No Physician Orders found.");

    // IMPORTANT:
    // Return false so processVisit() knows
    // not to mark the visit as downloaded.
    return false;
  }

  // -----------------------------------------------------
  // Determine download folder
  // -----------------------------------------------------

  let downloadFolder;

  if (count <= 1) {
    downloadFolder = baseDownloadFolder;

    console.log("Single Physician Order detected.");
    console.log("Using single-file download folder.");
  } else {
    downloadFolder = path.join(baseDownloadFolder, "multiple files");

    if (!fs.existsSync(downloadFolder)) {
      fs.mkdirSync(downloadFolder, {
        recursive: true,
      });
    }

    console.log(`Multiple Physician Orders detected (${count}).`);

    console.log("Using multiple-files download folder.");
  }

  console.log("Download folder:", downloadFolder);

  // -----------------------------------------------------
  // Process every Physician Order
  // -----------------------------------------------------

  for (let i = 0; i < count; i++) {
    console.log("\n----------------------------------------");
    console.log(`Processing Physician Order ${i + 1}/${count}`);
    console.log("----------------------------------------");

    // Re-find after returning to the list
    physicianOrders = getPhysicianOrders();

    const currentCount = await physicianOrders.count();

    if (i >= currentCount) {
      throw new Error(`Physician Order #${i + 1} is no longer available.`);
    }

    const currentOrder = physicianOrders.nth(i);

    // ---------------------------------------------------
    // Click actual Physician Orders text
    // ---------------------------------------------------

    const physicianOrderText = currentOrder.locator(
      'span#descimg[ctrl-name="descimg"][send-click="true"]',
    );

    await physicianOrderText.waitFor({
      state: "visible",
      timeout: 30000,
    });

    console.log(`Clicking actual PHYSICIAN ORDERS #${i + 1}...`);

    await physicianOrderText.click();

    await page.waitForTimeout(3000);

    // ---------------------------------------------------
    // Find enabled Export button
    // ---------------------------------------------------

    const exportButton = page.locator(
      'cpsi-button[title="Export"]:not([disabled])',
    );

    await exportButton.waitFor({
      state: "visible",
      timeout: 30000,
    });

    console.log("Enabled Export button found.");

    // ---------------------------------------------------
    // Click Export
    // ---------------------------------------------------

    const pagesBefore = page.context().pages();

    await exportButton.click();

    console.log("Export clicked.");

    await page.waitForTimeout(2000);

    const pagesAfter = page.context().pages();

    const pdfPage = pagesAfter.find((p) => !pagesBefore.includes(p));

    if (!pdfPage) {
      throw new Error("PDF window was not opened after clicking Export.");
    }

    console.log("PDF opened in new tab.");

    // ---------------------------------------------------
    // Get PDF URL
    // ---------------------------------------------------

    const pdfUrl = pdfPage.url();

    console.log("PDF URL:");
    console.log(pdfUrl);

    if (!pdfUrl || !pdfUrl.toLowerCase().includes(".pdf")) {
      throw new Error(`New tab does not contain a PDF URL: ${pdfUrl}`);
    }

    // ---------------------------------------------------
    // Download PDF
    // ---------------------------------------------------

    console.log("Downloading PDF...");

    const response = await page.request.get(pdfUrl);

    if (!response.ok()) {
      throw new Error(`PDF download failed. HTTP status: ${response.status()}`);
    }

    // ---------------------------------------------------
    // Generate filename
    // ---------------------------------------------------

    let baseFileName;

    if (count <= 1) {
      baseFileName = `${visitNumber}`;
    } else {
      baseFileName = `${visitNumber}_${i + 1}`;
    }

    let fileName = `${baseFileName}.pdf`;

    let filePath = path.join(downloadFolder, fileName);

    // ---------------------------------------------------
    // Prevent overwriting
    // ---------------------------------------------------

    let duplicateNumber = 1;

    while (fs.existsSync(filePath)) {
      fileName = `${baseFileName}_${duplicateNumber}.pdf`;

      filePath = path.join(downloadFolder, fileName);

      duplicateNumber++;
    }

    // ---------------------------------------------------
    // Save PDF
    // ---------------------------------------------------

    await fs.promises.writeFile(filePath, await response.body());

    console.log(`PDF saved successfully: ${filePath}`);

    // ---------------------------------------------------
    // Close PDF tab
    // ---------------------------------------------------

    console.log("Closing PDF tab...");

    await pdfPage.close();

    console.log("PDF tab closed.");

    // ---------------------------------------------------
    // Return to document list
    // ---------------------------------------------------

    if (i < count - 1) {
      console.log("Another Physician Order exists.");

      const backButton = page.locator(
        'cpsi-button:has(cpsi-icon[icon-id="TrubridgeEhr:System:ArrowLeft"])',
      );

      await backButton.waitFor({
        state: "visible",
        timeout: 30000,
      });

      await backButton.first().click();

      console.log("Returned to document list.");

      await getPhysicianOrders().first().waitFor({
        state: "visible",
        timeout: 30000,
      });

      await page.waitForTimeout(1500);

      console.log("Physician Orders list is ready.");
    }
  }

  console.log("\n========================================");
  console.log("ALL PHYSICIAN ORDERS DOWNLOADED");
  console.log("========================================");

  // IMPORTANT
  return true;
}

// =====================================================
// Process one visit
// =====================================================

async function processVisit(page, visit) {
  const visitNumber = visit.visitNumber;

  console.log("\n========================================");
  console.log(`Processing ${visit.visitKey}`);
  console.log(`Visit number: ${visitNumber}`);
  console.log("========================================");

  // -----------------------------------------------------
  // 1. Open MR Summary
  // -----------------------------------------------------

  const summaryUrl =
    `https://pinev.connect.evident.com/?` +
    `required_code_systems=icd9_and_icd10` +
    `&arid=1` +
    `&facid=1` +
    `&patient=${visitNumber}` +
    `&medical_records=true` +
    `&op=launch_charts_usher/mr_${visitNumber}_1/mr_summary`;

  console.log("Opening MR Summary...");

  await page.goto(summaryUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(15 * 1000);

  console.log("MR Summary loaded.");

  // -----------------------------------------------------
  // 2. Open Patient Discussion
  // -----------------------------------------------------

  const patientDiscussionUrl =
    `https://pinev.connect.evident.com/?` +
    `required_code_systems=icd9_and_icd10` +
    `&arid=1` +
    `&facid=1` +
    `&patient=${visitNumber}` +
    `&medical_records=true` +
    `&op=launch_charts_usher/mr_${visitNumber}_1/patdisc`;

  console.log("Opening Patient Discussion...");

  await page.goto(patientDiscussionUrl, {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  await page.waitForTimeout(15 * 1000);

  console.log("Patient Discussion loaded.");

  // -----------------------------------------------------
  // 3. Click Other
  // -----------------------------------------------------

  console.log("Clicking Other...");

  const other = page.locator("span#desc", { hasText: "Other" });

  await other.waitFor({
    state: "visible",
    timeout: 30000,
  });

  await other.click();

  console.log("Other clicked.");

  await page.waitForTimeout(15 * 1000);

  // -----------------------------------------------------
  // 4. Download Physician Orders
  // -----------------------------------------------------

  const downloaded = await downloadPhysicianOrders(page, visitNumber);

  // -----------------------------------------------------
  // 5. IMPORTANT
  //
  // Only mark downloaded when an actual document
  // was found and downloaded.
  // -----------------------------------------------------

  if (downloaded) {
    await markVisitAsDownloaded(visit.visitKey);

    console.log(
      `SUCCESS: ${visit.visitKey} - Physician Orders downloaded and database updated`,
    );
  } else {
    // ---------------------------------------------------
    // No Physician Orders
    // ---------------------------------------------------

    addNoPhysicianOrderVisit(visit.visitKey);

    console.log(
      `NO DOCUMENT: ${visit.visitKey} - added to missing_physician_orders.txt`,
    );
  }

  return downloaded;
}

// =====================================================
// MAIN
// =====================================================

async function main() {
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });

  const page = await context.newPage();

  page.setDefaultTimeout(30000);

  try {
    // ---------------------------------------------------
    // 1. Read supplied visit keys
    // ---------------------------------------------------

    console.log("Reading visit keys...");

    const visitKeys = readVisitKeys();

    console.log(`Found ${visitKeys.length} unique visit key(s).`);

    if (visitKeys.length === 0) {
      console.log("No visit keys to process.");
      return;
    }

    // ---------------------------------------------------
    // 2. Get visits from database
    // ---------------------------------------------------

    console.log("Getting visit information from database...");

    const visits = await getVisitsWithMissingDocuments(visitKeys);

    console.log(`Found ${visits.length} matching visit(s) in database.`);

    // ---------------------------------------------------
    // Detect visit keys missing from database
    // ---------------------------------------------------

    const foundVisitKeys = new Set(visits.map((visit) => visit.visitKey));

    const missingFromDatabase = visitKeys.filter(
      (visitKey) => !foundVisitKeys.has(visitKey),
    );

    if (missingFromDatabase.length > 0) {
      console.log(
        "\nWARNING: These visit keys were not found in the database:",
      );

      for (const visitKey of missingFromDatabase) {
        console.log(`  ${visitKey}`);
      }
    }

    if (visits.length === 0) {
      console.log("No matching visits found in database.");
      return;
    }

    // ---------------------------------------------------
    // 3. Login ONCE
    // ---------------------------------------------------

    console.log("\nLogging in...");

    await login(page);

    console.log("Login completed.");

    // ---------------------------------------------------
    // 4. Process every visit
    // ---------------------------------------------------

    let successfulDownloads = 0;
    let noPhysicianOrders = 0;
    let failed = 0;

    for (const visit of visits) {
      try {
        const downloaded = await processVisit(page, visit);

        if (downloaded) {
          successfulDownloads++;
        } else {
          noPhysicianOrders++;
        }
      } catch (error) {
        failed++;

        console.error(`\nFAILED: ${visit.visitKey}`);

        console.error(error);
      }
    }

    // ---------------------------------------------------
    // 5. Final summary
    // ---------------------------------------------------

    console.log("\n");
    console.log("========================================");
    console.log("FINAL RESULT");
    console.log("========================================");

    console.log(`Total database visits processed: ${visits.length}`);

    console.log(`Physician Orders downloaded: ${successfulDownloads}`);

    console.log(`No Physician Orders: ${noPhysicianOrders}`);

    console.log(`Failed: ${failed}`);

    if (noPhysicianOrders > 0) {
      console.log("\nNo-document visit keys saved to:");

      console.log(NO_PHYSICIAN_ORDER_FILE);
    }

    console.log("========================================");
  } catch (error) {
    console.error("Main process failed:");

    console.error(error);
  } finally {
    await closeDatabase();

    // Keep browser open while testing
    // await browser.close();
  }
}

main();
