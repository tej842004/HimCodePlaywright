const { runPythonFunction } = require("../database/pythonRunner");

async function transcriptions(page, visitKey) {
  try {
    // -----------------------------------------
    // 1. Get account number
    // -----------------------------------------

    const accountNumber = visitKey.split("V-").filter((x) => x.length > 0)[0];

    // -----------------------------------------
    // 2. Build URL
    // -----------------------------------------

    const url =
      `https://pinev.connect.evident.com/?` +
      `required_code_systems=icd9_and_icd10` +
      `&arid=1` +
      `&facid=1` +
      `&patient=${accountNumber}` +
      `&medical_records=true` +
      `&op=launch_charts_usher/mr_${accountNumber}_1/patTranscriptions`;

    console.log("Opening:", url);

    // -----------------------------------------
    // 3. Navigate
    // -----------------------------------------

    await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 120000,
    });

    await page.waitForTimeout(5 * 1000);

    // -----------------------------------------
    // 4. Wait for grid
    // -----------------------------------------

    const transactionGrid = page
      .locator("cpsi-grid#grid")
      .filter({ hasText: "Department" });

    await transactionGrid.waitFor({
      state: "visible",
      timeout: 120000,
    });

    // -----------------------------------------
    // 5. Extract transaction data
    // -----------------------------------------

    const transactions = await transactionGrid.evaluate((gridHost) => {
      if (!gridHost) {
        throw new Error("#grid not found");
      }

      const columnEls = gridHost.querySelectorAll("cpsi-grid-column");

      const columnCount = columnEls.length;

      if (columnCount === 0) {
        throw new Error("No cpsi-grid-column elements found");
      }

      const headers = [];

      for (let i = 0; i < columnCount; i++) {
        const headerSlot = gridHost.querySelector(
          `vaadin-grid-cell-content[slot="vaadin-grid-cell-content-${i}"]`,
        );

        const sorter = headerSlot
          ? headerSlot.querySelector("cpsi-grid-sorter")
          : null;

        headers.push(sorter ? sorter.textContent.trim() : `col${i}`);
      }

      const allCellContents = gridHost.querySelectorAll(
        "vaadin-grid-cell-content",
      );

      const dataCells = [];

      allCellContents.forEach((cellEl) => {
        const slotAttr = cellEl.getAttribute("slot");

        const match = slotAttr
          ? slotAttr.match(/vaadin-grid-cell-content-(\d+)/)
          : null;

        if (match) {
          const idx = parseInt(match[1], 10);

          if (idx >= columnCount) {
            dataCells.push({
              idx,
              el: cellEl,
            });
          }
        }
      });

      const rowsMap = {};

      dataCells.forEach((item) => {
        const relativeIdx = item.idx - columnCount;

        const rowIdx = Math.floor(relativeIdx / columnCount);

        const colIdx = relativeIdx % columnCount;

        const span = item.el.querySelector("span[title]");

        const text = span
          ? span.getAttribute("title").trim()
          : item.el.textContent.trim();

        if (!rowsMap[rowIdx]) {
          rowsMap[rowIdx] = {};
        }

        rowsMap[rowIdx][headers[colIdx]] = text;
      });

      const results = [];

      Object.keys(rowsMap).forEach((rowIdx) => {
        const row = rowsMap[rowIdx];

        const hasData = Object.values(row).some(
          (value) => value && value.length > 0,
        );

        if (hasData) {
          results.push(row);
        }
      });

      return results;
    });

    // -----------------------------------------
    // 6. Log extracted data
    // -----------------------------------------

    console.log(`Transactions found: ${transactions.length}`);

    console.log(transactions);

    // -----------------------------------------
    // 7. Save to database
    // -----------------------------------------

    const result = await runPythonFunction("insert_transectiondata", [
      visitKey,
      transactions,
    ]);

    if (result.success && result.result) {
      console.log(`Transaction data saved successfully for ${visitKey}.`);
    } else {
      console.log(`Transaction data was NOT saved for ${visitKey}.`);
    }

    return transactions;
  } catch (error) {
    console.error(`Error processing patient ${visitKey}:`, error);

    throw error;
  }
}

module.exports = {
  transcriptions,
};
