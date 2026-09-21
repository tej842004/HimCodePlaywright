require("dotenv").config();

const { chromium } = require("playwright");

const {
  getUncodedVisits,
  markVisitAsDownloaded,
  closeDatabase,
} = require("../database/database");

const { login } = require("../workflows/login");

async function downloadPhysicianOrders(page, visitNumber) {
  console.log("\n========================================");
  console.log("Looking for Physician Orders...");
  console.log("========================================");

  const fs = require("fs");
  const path = require("path");

  // -----------------------------------------
  // Download folder
  // -----------------------------------------

  const downloadFolder = path.join(
    __dirname,
    "him_coded_downloaded_files"
  );

  if (!fs.existsSync(downloadFolder)) {
    fs.mkdirSync(downloadFolder, {
      recursive: true,
    });
  }

  // -----------------------------------------
  // Find only actual Physician Orders cells
  // -----------------------------------------

  const getPhysicianOrders = () =>
    page
      .locator("vaadin-grid-cell-content")
      .filter({
        has: page.locator(
          'span#descimg[ctrl-name="descimg"][send-click="true"]'
        ).filter({
          hasText: /^PHYSICIAN ORDERS$/,
        }),
      });

  let physicianOrders = getPhysicianOrders();

  const count = await physicianOrders.count();

  console.log(
    `Found ${count} Physician Orders document(s).`
  );

  if (count === 0) {
    console.log("No Physician Orders found.");
    return;
  }

  // -----------------------------------------
  // Process every Physician Order
  // -----------------------------------------

  for (let i = 0; i < count; i++) {
    console.log("\n----------------------------------------");
    console.log(
      `Processing Physician Orders ${i + 1}/${count}`
    );
    console.log("----------------------------------------");

    // Re-find after returning to the list
    physicianOrders = getPhysicianOrders();

    const currentCount = await physicianOrders.count();

    if (i >= currentCount) {
      throw new Error(
        `Physician Order #${i + 1} is no longer available.`
      );
    }

    const currentOrder = physicianOrders.nth(i);

    // -----------------------------------------
    // Click actual Physician Orders span
    // -----------------------------------------

    const physicianOrderText = currentOrder.locator(
      'span#descimg[ctrl-name="descimg"][send-click="true"]'
    );

    await physicianOrderText.waitFor({
      state: "visible",
      timeout: 30000,
    });

    console.log(
      `Clicking actual PHYSICIAN ORDERS #${i + 1}...`
    );

    await physicianOrderText.click();

    await page.waitForTimeout(3000);

    // -----------------------------------------
    // Find enabled Export button
    // -----------------------------------------

    const exportButton = page.locator(
      'cpsi-button[title="Export"]:not([disabled])'
    );

    await exportButton.waitFor({
      state: "visible",
      timeout: 30000,
    });

    console.log("Enabled Export button found.");

    // -----------------------------------------
    // Click Export
    // -----------------------------------------

    const pagesBefore = page.context().pages();

    await exportButton.click();

    console.log("Export clicked.");

    await page.waitForTimeout(2000);

    const pagesAfter = page.context().pages();

    const pdfPage = pagesAfter.find(
      (p) => !pagesBefore.includes(p)
    );

    if (!pdfPage) {
      throw new Error(
        "PDF window was not opened after clicking Export."
      );
    }

    console.log("PDF opened in new tab.");

    // -----------------------------------------
    // Get PDF URL
    // -----------------------------------------

    const pdfUrl = pdfPage.url();

    console.log("PDF URL:");
    console.log(pdfUrl);

    if (
      !pdfUrl ||
      !pdfUrl.toLowerCase().includes(".pdf")
    ) {
      throw new Error(
        `New tab does not contain a PDF URL: ${pdfUrl}`
      );
    }

    // -----------------------------------------
    // Download PDF
    // -----------------------------------------

    console.log("Downloading PDF...");

    const response = await page.request.get(pdfUrl);

    if (!response.ok()) {
      throw new Error(
        `PDF download failed. HTTP status: ${response.status()}`
      );
    }

    // -----------------------------------------
    // Generate filename
    // -----------------------------------------

    const baseFileName =
      `${visitNumber}_${i + 1}`;

    let fileName = `${baseFileName}.pdf`;
    let filePath = path.join(
      downloadFolder,
      fileName
    );

    // -----------------------------------------
    // Prevent overwriting existing file
    // -----------------------------------------

    let duplicateNumber = 1;

    while (fs.existsSync(filePath)) {
      fileName =
        `${baseFileName}_${duplicateNumber}.pdf`;

      filePath = path.join(
        downloadFolder,
        fileName
      );

      duplicateNumber++;
    }

    // -----------------------------------------
    // Save PDF
    // -----------------------------------------

    await fs.promises.writeFile(
      filePath,
      await response.body()
    );

    console.log(
      `PDF saved successfully: ${filePath}`
    );

    // -----------------------------------------
    // Close PDF tab
    // -----------------------------------------

    console.log("Closing PDF tab...");

    await pdfPage.close();

    console.log("PDF tab closed.");

    // -----------------------------------------
    // Go back if another Physician Order exists
    // -----------------------------------------

    if (i < count - 1) {
      console.log(
        "Another Physician Order exists."
      );

      const backButton = page.locator(
        'cpsi-button:has(cpsi-icon[icon-id="TrubridgeEhr:System:ArrowLeft"])'
      );

      await backButton.waitFor({
        state: "visible",
        timeout: 30000,
      });

      await backButton.first().click();

      console.log(
        "Returned to document list."
      );

      // Wait for Physician Orders to appear again
      await getPhysicianOrders()
        .first()
        .waitFor({
          state: "visible",
          timeout: 30000,
        });

      await page.waitForTimeout(1500);

      console.log(
        "Physician Orders list is ready."
      );
    }
  }

  console.log("\n========================================");
  console.log("ALL PHYSICIAN ORDERS DOWNLOADED");
  console.log("========================================");
}

async function processVisit(page, visit) {
  const visitNumber = visit.visitNumber;

  console.log(`\nProcessing ${visit.visitKey}`);
  console.log(`Visit number: ${visitNumber}`);

  // -----------------------------------------
  // 1. Open MR Summary
  // -----------------------------------------

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

  await page.waitForTimeout(15 * 1000)

  console.log("MR Summary loaded.");

  // -----------------------------------------
  // 2. Open Patient Discussion
  // -----------------------------------------

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

  await page.waitForTimeout(15 * 1000)

  console.log("Patient Discussion loaded.");

  console.log("Clicking Other...");

  await page.locator('span#desc', { hasText: 'Other' }).click();

  console.log("Other clicked.");

  await page.waitForTimeout(15 * 1000)

  await downloadPhysicianOrders(page, visitNumber);

  await markVisitAsDownloaded(visit.visitKey);

  console.log(
    `SUCCESS: ${visit.visitKey} - downloads completed and database updated`
  );
}

async function main() {
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });

  const page = await context.newPage();

  // Don't let normal Playwright operations hang forever
  page.setDefaultTimeout(30000);

  try {
    // -----------------------------------------
    // 1. Get visits from PostgreSQL
    // -----------------------------------------

    console.log("Getting uncoded visits from database...");

    const visits = await getUncodedVisits();

    console.log(`Found ${visits.length} visit(s).`);

    if (visits.length === 0) {
      console.log("No visits to process.");
      return;
    }

    // -----------------------------------------
    // 2. Login ONCE
    // -----------------------------------------

    await login(page);

    // -----------------------------------------
    // 3. Process each visit
    // -----------------------------------------

    for (const visit of visits) {
      try {
        await processVisit(page, visit);

        console.log(`SUCCESS: ${visit.visitKey}`);

      } catch (error) {
        console.error(`FAILED: ${visit.visitKey}`);
        console.error(error.message);
      }
    }

  } catch (error) {
    console.error("Main process failed:");
    console.error(error);

  } finally {
    await closeDatabase();

    // Keep browser open for now while testing
    // await browser.close();
  }
}

main();