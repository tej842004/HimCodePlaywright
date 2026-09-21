const { runPythonFunction } = require("../database/pythonRunner");

async function charges(page, visitKey) {
  try {
    // =====================================================
    // 1. Build URL
    // =====================================================

    const accountNumber = visitKey.split("V-")[1];

    const url =
      `https://pinev.connect.evident.com/?` +
      `required_code_systems=icd9_and_icd10` +
      `&arid=1` +
      `&facid=1` +
      `&patient=${accountNumber}` +
      `&medical_records=true` +
      `&op=launch_charts_usher/mr_${accountNumber}_1/charges`;

    console.log("========================================");
    console.log("Starting charges extraction");
    console.log("Visit Key:", visitKey);
    console.log("Account Number:", accountNumber);
    console.log("URL:", url);
    console.log("========================================");

    // =====================================================
    // 2. Navigate
    // =====================================================

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    console.log("Page loaded.");

    await page.waitForTimeout(5 * 1000);

    // =====================================================
    // 3. Wait for application / Shadow DOM
    // =====================================================

    console.log("Waiting for application to load...");

    await page.waitForFunction(
      () => {
        const launcher = document.querySelector("body > cp-app-launcher");

        if (!launcher?.shadowRoot) {
          return false;
        }

        const control = launcher.shadowRoot.querySelector("#control");

        if (!control?.shadowRoot) {
          return false;
        }

        const mainpanel = control.shadowRoot.querySelector("#mainpanel");

        if (!mainpanel?.shadowRoot) {
          return false;
        }

        return true;
      },
      {
        timeout: 120000,
      },
    );

    console.log("Application Shadow DOM is ready.");

    // =====================================================
    // 4. YOUR EXISTING EXTRACTION CODE
    // =====================================================

    const transactions = await page.evaluate(async () => {
      const pageSize = 20;
      const settleDelayMs = 120;
      const pageTimeoutMs = 8000;

      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      // ===================================================
      // Find cp-app-launcher
      // ===================================================

      console.log("[Browser] Looking for cp-app-launcher...");

      const launcher = document.querySelector(
        "body > cp-app-launcher",
      )?.shadowRoot;

      if (!launcher) {
        throw new Error("cp-app-launcher shadowRoot not found");
      }

      console.log("[Browser] cp-app-launcher found.");

      // ===================================================
      // Find #control
      // ===================================================

      const control = launcher.querySelector("#control")?.shadowRoot;

      if (!control) {
        throw new Error("#control shadowRoot not found");
      }

      console.log("[Browser] #control found.");

      // ===================================================
      // Find #mainpanel
      // ===================================================

      const mainpanel = control.querySelector("#mainpanel")?.shadowRoot;

      if (!mainpanel) {
        throw new Error("#mainpanel shadowRoot not found");
      }

      console.log("[Browser] #mainpanel found.");

      // ===================================================
      // Find #searchItemsDiv
      // ===================================================

      let searchItemsDiv = null;

      const screens = mainpanel.querySelectorAll('[id^="screen_"]');

      console.log(`[Browser] Found ${screens.length} screen elements.`);

      screens.forEach((screenEl) => {
        if (!screenEl.shadowRoot) {
          return;
        }

        const found = screenEl.shadowRoot.querySelector("#searchItemsDiv");

        if (found) {
          searchItemsDiv = found;
        }
      });

      if (!searchItemsDiv) {
        throw new Error("searchItemsDiv not found");
      }

      console.log("[Browser] #searchItemsDiv found.");

      // ===================================================
      // Find departmentSearchList
      // ===================================================

      const maplist = searchItemsDiv.querySelector("#departmentSearchList");

      if (!maplist) {
        throw new Error("departmentSearchList not found");
      }

      if (!maplist.shadowRoot) {
        throw new Error("departmentSearchList shadowRoot not found");
      }

      const maplistRoot = maplist.shadowRoot;

      console.log("[Browser] #departmentSearchList found.");

      // ===================================================
      // Find cpsi-grid
      // ===================================================

      const gridHost = maplistRoot.querySelector("cpsi-grid");

      if (!gridHost) {
        throw new Error("cpsi-grid not found");
      }

      console.log("[Browser] cpsi-grid found.");

      // ===================================================
      // Extract order description
      // ===================================================

      function extractDescription(item) {
        // -----------------------------------------------
        // Try _element
        // -----------------------------------------------

        if (item._element) {
          const span = item._element.querySelector(
            'span[ctrl-name="order_description"]',
          );

          if (span) {
            return span.textContent.trim();
          }
        }

        // -----------------------------------------------
        // Try markup
        // -----------------------------------------------

        if (item.markup) {
          const match = item.markup.match(
            /<span[^>]*ctrl-name="order_description"[^>]*>([^<]*)<\/span>/,
          );

          if (match) {
            return match[1].trim();
          }
        }

        return null;
      }

      // ===================================================
      // Load one page
      // ===================================================

      function loadPage(pageNumber) {
        console.log(`[Browser] Loading page ${pageNumber}...`);

        const dataPromise = new Promise((resolve) => {
          gridHost.dataProvider(
            {
              page: pageNumber,
              pageSize: pageSize,
              sortOrders: [],
              filters: [],
            },

            (items, size) => {
              console.log(
                `[Browser] Page ${pageNumber} returned ${items?.length || 0} items. Total records: ${size}`,
              );

              resolve({
                items,
                size,
              });
            },
          );
        });

        const timeoutPromise = new Promise((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Timeout loading page ${pageNumber}`));
          }, pageTimeoutMs);
        });

        return Promise.race([dataPromise, timeoutPromise]);
      }

      // ===================================================
      // Extract all pages
      // ===================================================

      console.log("[Browser] Loading first page...");

      const firstPage = await loadPage(0);

      const totalRecords = firstPage.size;

      const totalPages = Math.ceil(totalRecords / pageSize);

      console.log("========================================");

      console.log(`[Browser] Total Records: ${totalRecords}`);

      console.log(`[Browser] Page Size: ${pageSize}`);

      console.log(`[Browser] Total Pages: ${totalPages}`);

      console.log("========================================");

      // ===================================================
      // Store unique records
      // ===================================================

      const results = [];

      const seenKeys = new Set();

      function pushUnique(item) {
        const rowKey = item.key !== undefined ? String(item.key) : null;

        // -----------------------------------------------
        // Avoid duplicate rows
        // -----------------------------------------------

        if (rowKey !== null) {
          if (seenKeys.has(rowKey)) {
            return;
          }

          seenKeys.add(rowKey);
        }

        // -----------------------------------------------
        // Extract description
        // -----------------------------------------------

        const description = extractDescription(item);

        if (description) {
          results.push(description);

          console.log(`[Browser] Extracted: ${description}`);
        }
      }

      // ===================================================
      // Process first page
      // ===================================================

      await delay(settleDelayMs);

      firstPage.items.forEach((item) => {
        pushUnique(item);
      });

      console.log(`[Browser] Finished page 1/${totalPages}`);

      // ===================================================
      // Process remaining pages
      // ===================================================

      for (let pageNumber = 1; pageNumber < totalPages; pageNumber++) {
        const response = await loadPage(pageNumber);

        await delay(settleDelayMs);

        response.items.forEach((item) => {
          pushUnique(item);
        });

        console.log(`[Browser] Finished page ${pageNumber + 1}/${totalPages}`);

        console.log(`[Browser] Total extracted so far: ${results.length}`);
      }

      // ===================================================
      // Return results
      // ===================================================

      console.log("========================================");

      console.log(`[Browser] EXTRACTION COMPLETE`);

      console.log(`[Browser] Total unique rows: ${results.length}`);

      console.log("========================================");

      return results;
    });

    // =====================================================
    // 5. Display result
    // =====================================================

    console.log("");
    console.log("========================================");
    console.log("FINAL EXTRACTION RESULT");
    console.log("========================================");

    console.log(`Total extracted rows: ${transactions.length}`);

    transactions.forEach((description, index) => {
      console.log(`${index + 1}. ${description}`);
    });

    console.log("========================================");

    // =====================================================
    // 7. Send to Python / DB
    // =====================================================

    const result = await runPythonFunction("search_charges", [
      visitKey,
      transactions,
    ]);

    if (result.success && result.result) {
      console.log(`Charge data saved successfully for ${visitKey}.`);
    } else {
      console.log(`Charge data was NOT saved for ${visitKey}.`);
    }

    return transactions;
  } catch (error) {
    console.error(`Error processing charges for ${visitKey}:`, error);

    throw error;
  }
}

module.exports = {
  charges,
};
