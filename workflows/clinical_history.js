const { runPythonFunction } = require('../database/pythonRunner');

async function clinical_history(page, visitKey) {
  try {
    // =====================================================
    // 1. Get account number
    // =====================================================

    const accountNumber = visitKey.split('V-').filter((x) => x.length > 0)[0];

    if (!accountNumber) {
      throw new Error(`Invalid visit key: ${visitKey}`);
    }

    // =====================================================
    // 2. Build URL
    // =====================================================

    const url =
      `https://pinev.connect.evident.com/?` +
      `required_code_systems=icd9_and_icd10` +
      `&arid=1` +
      `&facid=1` +
      `&patient=${accountNumber}` +
      `&medical_records=true` +
      `&op=launch_charts_usher/mr_${accountNumber}_1/patCH`;

    console.log('Opening Clinical History page...');
    console.log(url);

    // =====================================================
    // 3. Open page
    // =====================================================

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await page.waitForTimeout(5000);

    console.log('Clinical History page loaded.');

    // =====================================================
    // 4. Find the EXACT Clinical History grid
    // =====================================================

    console.log('Waiting for Clinical History grid...');

    await page.waitForFunction(
      () => {
        function findListMapCtrl(root) {
          if (!root) return null;

          const direct = root.querySelector?.('#listMapCtrl');

          if (direct) {
            return direct;
          }

          const all = root.querySelectorAll?.('*') || [];

          for (const el of all) {
            if (el.shadowRoot) {
              const found = findListMapCtrl(el.shadowRoot);

              if (found) {
                return found;
              }
            }
          }

          return null;
        }

        const listMapCtrl = findListMapCtrl(document);

        if (!listMapCtrl) {
          return false;
        }

        if (!listMapCtrl.shadowRoot) {
          return true;
        }

        return true;
      },
      {
        timeout: 120000,
      }
    );

    console.log('#listMapCtrl found.');

    // =====================================================
    // 5. Wait until rows actually exist
    //
    // IMPORTANT:
    // Rows are inside:
    //
    // #listMapCtrl
    //   -> cp-listctrl
    //      -> shadowRoot
    //         -> cpsi-grid#grid
    //            -> shadowRoot
    //               -> #items
    //                  -> tr[role=row]
    //
    // =====================================================

    console.log('Waiting for Clinical History rows...');

    await page.waitForFunction(
      () => {
        function findElement(root, selector) {
          if (!root) return null;

          const direct = root.querySelector?.(selector);

          if (direct) {
            return direct;
          }

          const elements = root.querySelectorAll?.('*') || [];

          for (const el of elements) {
            if (el.shadowRoot) {
              const found = findElement(el.shadowRoot, selector);

              if (found) {
                return found;
              }
            }
          }

          return null;
        }

        // Find the specific listMapCtrl
        const listMapCtrl = findElement(document, '#listMapCtrl');

        if (!listMapCtrl) {
          return false;
        }

        // cp-listctrl
        const listCtrl = listMapCtrl.querySelector('cp-listctrl');

        if (!listCtrl) {
          return false;
        }

        // cp-listctrl shadow root
        if (!listCtrl.shadowRoot) {
          return false;
        }

        // Exact grid
        const grid = listCtrl.shadowRoot.querySelector('cpsi-grid#grid');

        if (!grid) {
          return false;
        }

        // Grid shadow root
        if (!grid.shadowRoot) {
          return false;
        }

        // Actual row container
        const items = grid.shadowRoot.querySelector('#items');

        if (!items) {
          return false;
        }

        // IMPORTANT:
        // Don't require text here.
        // Just wait until real body rows exist.
        const rows = items.querySelectorAll('tr[role="row"][aria-rowindex]');

        return rows.length > 0;
      },
      {
        timeout: 120000,
      }
    );

    console.log('Clinical History rows found.');

    // =====================================================
    // 6. Extract rows
    // =====================================================

    const results = await page.evaluate(() => {
      // ---------------------------------------------------
      // Helper: recursively find element
      // ---------------------------------------------------

      function findElement(root, selector) {
        if (!root) return null;

        const direct = root.querySelector?.(selector);

        if (direct) {
          return direct;
        }

        const elements = root.querySelectorAll?.('*') || [];

        for (const el of elements) {
          if (el.shadowRoot) {
            const found = findElement(el.shadowRoot, selector);

            if (found) {
              return found;
            }
          }
        }

        return null;
      }

      // ---------------------------------------------------
      // Find listMapCtrl
      // ---------------------------------------------------

      const listMapCtrl = findElement(document, '#listMapCtrl');

      if (!listMapCtrl) {
        throw new Error('#listMapCtrl not found');
      }

      // ---------------------------------------------------
      // Find cp-listctrl
      // ---------------------------------------------------

      const listCtrl = listMapCtrl.querySelector('cp-listctrl');

      if (!listCtrl) {
        throw new Error('cp-listctrl not found');
      }

      if (!listCtrl.shadowRoot) {
        throw new Error('cp-listctrl shadowRoot not found');
      }

      // ---------------------------------------------------
      // Find exact grid
      // ---------------------------------------------------

      const grid = listCtrl.shadowRoot.querySelector('cpsi-grid#grid');

      if (!grid) {
        throw new Error('cpsi-grid#grid not found');
      }

      if (!grid.shadowRoot) {
        throw new Error('cpsi-grid shadowRoot not found');
      }

      // ---------------------------------------------------
      // Find row container
      // ---------------------------------------------------

      const items = grid.shadowRoot.querySelector('#items');

      if (!items) {
        throw new Error('#items not found');
      }

      // ---------------------------------------------------
      // Get actual body rows
      // ---------------------------------------------------

      const rows = Array.from(items.querySelectorAll('tr[role="row"][aria-rowindex]'));

      console.log(`[Browser] Actual Clinical History rows: ${rows.length}`);

      // ---------------------------------------------------
      // Get cell content by slot name
      // ---------------------------------------------------

      function getSlotText(slotName) {
        if (!slotName) {
          return '';
        }

        /*
         * The row <td> contains:
         *
         * <slot name="vaadin-grid-cell-content-31"></slot>
         *
         * The actual value is represented by:
         *
         * <vaadin-grid-cell-content
         *      slot="vaadin-grid-cell-content-31">
         *      <span title="XR">XR</span>
         * </vaadin-grid-cell-content>
         *
         * Therefore we resolve the slot name here.
         */

        const content = grid.querySelector(
          `vaadin-grid-cell-content[slot="${CSS.escape(slotName)}"]`
        );

        if (!content) {
          return '';
        }

        return content.textContent.replace(/\s+/g, ' ').trim();
      }

      // ---------------------------------------------------
      // Extract one row
      // ---------------------------------------------------

      function extractRow(row) {
        const cells = Array.from(row.querySelectorAll(':scope > td'));

        const values = [];

        for (const cell of cells) {
          const slot = cell.querySelector('slot');

          if (!slot) {
            values.push('');
            continue;
          }

          const slotName = slot.getAttribute('name');

          values.push(getSlotText(slotName));
        }

        /*
         * Column order from the actual HTML:
         *
         * 0 = selection checkbox
         * 1 = Type
         * 2 = Description
         * 3 = Signed By
         * 4 = Acct#
         * 5 = Date
         * 6 = Admit Dt
         * 7 = Disc Dt
         * 8 = PACS
         * 9 = Attachments
         */

        return {
          type: values[1] || '',
          description: values[2] || '',
          signedBy: values[3] || '',
          acctNumber: values[4] || '',
          date: values[5] || '',
          admitDate: values[6] || '',
          dischargeDate: values[7] || '',
          pacs: values[8] || '',
          attachments: values[9] || '',
        };
      }

      // ---------------------------------------------------
      // Extract all rows
      // ---------------------------------------------------

      const results = [];

      for (const row of rows) {
        const result = extractRow(row);

        // Ignore completely empty rows
        const hasData = Object.values(result).some((value) => value !== '');

        if (hasData) {
          results.push(result);
        }
      }

      return results;
    });

    // =====================================================
    // 7. Print result
    // =====================================================

    console.log('');
    console.log('========================================');
    console.log('CLINICAL HISTORY RESULT');
    console.log('========================================');

    console.log(`Rows found: ${results.length}`);

    console.log(JSON.stringify(results, null, 2));

    console.log('========================================');

    // -----------------------------------------
    // 8. Save to database
    // -----------------------------------------

    const databaseResult = await runPythonFunction('clinical_history', [visitKey, results]);

    if (databaseResult.success && databaseResult.result) {
      console.log(`Clinical History data saved successfully for ${visitKey}.`);
    } else {
      console.log(`Clinical History data was NOT saved for ${visitKey}.`);
    }

    // -----------------------------------------
    // 9. Return extracted data
    // -----------------------------------------

    return results;
  } catch (error) {
    console.error(`Error processing Clinical History for ${visitKey}:`, error);

    throw error;
  }
}

module.exports = {
  clinical_history,
};
