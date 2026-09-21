require("dotenv").config();

const { chromium } = require("playwright");

const {
  getUncodedVisits,
  markVisitAsDownloaded,
  closeDatabase,
} = require("./database/database");

const { login } = require("./workflows/login");

async function downloadPhysicianOrders(page, visitNumber) {
  console.log("\n========================================");
  console.log("Looking for Physician Orders...");
  console.log("========================================");

  const fs = require("fs");
  const path = require("path");

  // -----------------------------------------
  // Base download folder
  // -----------------------------------------

  const baseDownloadFolder = path.join(__dirname, "him_coded_downloaded_files");

  if (!fs.existsSync(baseDownloadFolder)) {
    fs.mkdirSync(baseDownloadFolder, {
      recursive: true,
    });
  }

  // -----------------------------------------
  // Find Physician Orders
  // -----------------------------------------

  const getPhysicianOrders = () =>
    page.locator("vaadin-grid-cell-content").filter({
      has: page
        .locator('span#descimg[ctrl-name="descimg"][send-click="true"]')
        .filter({
          hasText: /^PHYSICIAN ORDERS$/i,
        }),
    });

  // -----------------------------------------
  // Find Provider Order
  // -----------------------------------------

  const getProviderOrders = () =>
    page.locator("vaadin-grid-cell-content").filter({
      has: page
        .locator('span#descimg[ctrl-name="descimg"][send-click="true"]')
        .filter({
          hasText: /^Provider Order$/i,
        }),
    });

  // -----------------------------------------
  // First check Physician Orders
  // -----------------------------------------

  let orders = getPhysicianOrders();
  let orderType = "Physician Orders";

  let count = await orders.count();

  console.log(`Found ${count} Physician Orders document(s).`);

  // -----------------------------------------
  // If no Physician Orders, check Provider Order
  // -----------------------------------------

  if (count === 0) {
    console.log("No Physician Orders found.");
    console.log("Looking for Provider Order...");

    orders = getProviderOrders();
    orderType = "Provider Order";

    count = await orders.count();

    console.log(`Found ${count} Provider Order document(s).`);
  }

  // -----------------------------------------
  // Neither Physician Order nor Provider Order
  // -----------------------------------------

  if (count === 0) {
    console.log("No Physician Orders found.");
    console.log("No Provider Order found.");
    console.log("No document available for this visit.");
    console.log("Visit will still be marked as downloaded.");

    return false;
  }

  console.log(`Using document type: ${orderType}`);

  // -----------------------------------------
  // Determine download folder
  //
  // 1 file -> base folder
  // 2+    -> multiple files folder
  // -----------------------------------------

  let downloadFolder;

  if (count <= 1) {
    downloadFolder = baseDownloadFolder;

    console.log(`Single ${orderType} detected.`);
    console.log("Using single-file download folder.");
  } else {
    downloadFolder = path.join(baseDownloadFolder, "multiple files");

    if (!fs.existsSync(downloadFolder)) {
      fs.mkdirSync(downloadFolder, {
        recursive: true,
      });
    }

    console.log(`Multiple ${orderType} detected (${count}).`);
    console.log("Using multiple-files download folder.");
  }

  console.log("Download folder:", downloadFolder);

  // -----------------------------------------
  // Process every Order
  // -----------------------------------------

  for (let i = 0; i < count; i++) {
    console.log("\n----------------------------------------");
    console.log(`Processing ${orderType} ${i + 1}/${count}`);
    console.log("----------------------------------------");

    // Re-find after returning to the list
    if (orderType === "Physician Orders") {
      orders = getPhysicianOrders();
    } else {
      orders = getProviderOrders();
    }

    const currentCount = await orders.count();

    if (i >= currentCount) {
      throw new Error(`${orderType} #${i + 1} is no longer available.`);
    }

    const currentOrder = orders.nth(i);

    // -----------------------------------------
    // Click actual Order span
    // -----------------------------------------

    const orderText = currentOrder.locator(
      'span#descimg[ctrl-name="descimg"][send-click="true"]',
    );

    // Print all attributes for debugging
    const attributes = await orderText.evaluate((el) => {
      return Array.from(el.attributes).reduce((obj, attr) => {
        obj[attr.name] = attr.value;
        return obj;
      }, {});
    });

    console.log(`${orderType} #${i + 1}:`, attributes);

    await orderText.waitFor({
      state: "visible",
      timeout: 30000,
    });

    console.log(`Clicking ${orderType} #${i + 1}...`);

    await orderText.click();

    await page.waitForTimeout(3000);

    // -----------------------------------------
    // Find enabled Export button
    // -----------------------------------------

    const exportButton = page.locator(
      'cpsi-button[title="Export"]:not([disabled])',
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

    const pdfPage = pagesAfter.find((p) => !pagesBefore.includes(p));

    if (!pdfPage) {
      throw new Error("PDF window was not opened after clicking Export.");
    }

    console.log("PDF opened in new tab.");

    // -----------------------------------------
    // Get PDF URL
    // -----------------------------------------

    const pdfUrl = pdfPage.url();

    console.log("PDF URL:");
    console.log(pdfUrl);

    if (!pdfUrl || !pdfUrl.toLowerCase().includes(".pdf")) {
      throw new Error(`New tab does not contain a PDF URL: ${pdfUrl}`);
    }

    // -----------------------------------------
    // Download PDF
    // -----------------------------------------

    console.log("Downloading PDF...");

    const response = await page.request.get(pdfUrl);

    if (!response.ok()) {
      throw new Error(`PDF download failed. HTTP status: ${response.status()}`);
    }

    // -----------------------------------------
    // Generate filename
    //
    // Single:
    //   1392502.pdf
    //
    // Multiple:
    //   1392502_1.pdf
    //   1392502_2.pdf
    //   1392502_3.pdf
    // -----------------------------------------

    let baseFileName;

    if (count <= 1) {
      baseFileName = `${visitNumber}`;
    } else {
      baseFileName = `${visitNumber}_${i + 1}`;
    }

    let fileName = `${baseFileName}.pdf`;

    let filePath = path.join(downloadFolder, fileName);

    // -----------------------------------------
    // Prevent overwriting existing file
    // -----------------------------------------

    let duplicateNumber = 1;

    while (fs.existsSync(filePath)) {
      fileName = `${baseFileName}_${duplicateNumber}.pdf`;

      filePath = path.join(downloadFolder, fileName);

      duplicateNumber++;
    }

    // -----------------------------------------
    // Save PDF
    // -----------------------------------------

    await fs.promises.writeFile(filePath, await response.body());

    console.log(`PDF saved successfully: ${filePath}`);

    // -----------------------------------------
    // Close PDF tab
    // -----------------------------------------

    console.log("Closing PDF tab...");

    await pdfPage.close();

    console.log("PDF tab closed.");

    // -----------------------------------------
    // Go back if another Order exists
    // -----------------------------------------

    if (i < count - 1) {
      console.log(`Another ${orderType} exists.`);

      const backButton = page.locator(
        'cpsi-button:has(cpsi-icon[icon-id="TrubridgeEhr:System:ArrowLeft"])',
      );

      await backButton.waitFor({
        state: "visible",
        timeout: 30000,
      });

      await backButton.first().click();

      console.log("Returned to document list.");

      // Wait for the correct order type to appear again
      const orderList =
        orderType === "Physician Orders"
          ? getPhysicianOrders()
          : getProviderOrders();

      await orderList.first().waitFor({
        state: "visible",
        timeout: 30000,
      });

      await page.waitForTimeout(1500);

      console.log(`${orderType} list is ready.`);
    }
  }

  console.log("\n========================================");
  console.log(`ALL ${orderType.toUpperCase()} DOWNLOADED`);
  console.log("========================================");

  return true;
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

  await page.waitForTimeout(15 * 1000);

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

  await page.waitForTimeout(15 * 1000);

  console.log("Patient Discussion loaded.");

  // -----------------------------------------
  // 3. Click Other
  // -----------------------------------------

  console.log("Clicking Other...");

  await page
    .locator("span#desc", {
      hasText: "Other",
    })
    .click();

  console.log("Other clicked.");

  await page.waitForTimeout(15 * 1000);

  // -----------------------------------------
  // 4. Download Physician / Provider Orders
  // -----------------------------------------

  const downloadSuccessful = await downloadPhysicianOrders(page, visitNumber);

  // -----------------------------------------
  // 5. If no document was found
  //    still mark as downloaded
  // -----------------------------------------

  if (!downloadSuccessful) {
    console.log(
      `No Physician Order or Provider Order found for ${visit.visitKey}.`,
    );

    console.log("No document to download.");

    console.log("Marking visit as downloaded and moving to next visit.");
  }

  // -----------------------------------------
  // 6. ALWAYS mark visit as downloaded
  // -----------------------------------------

  await markVisitAsDownloaded(visit.visitKey);

  console.log(
    `SUCCESS: ${visit.visitKey} - processing completed and database updated`,
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

        console.log(`Finished processing: ${visit.visitKey}`);
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
