const { chromium } = require('playwright');
const { login } = require('../workflows/login');

async function testNotes(page, visitKey) {
  try {
    // =========================================
    // 1. Get account number
    // =========================================

    const accountNumber = visitKey.split('V-').filter((x) => x.length > 0)[0];

    if (!accountNumber) {
      throw new Error(`Invalid visit key: ${visitKey}`);
    }

    // =========================================
    // 2. Build URL
    // =========================================

    const url =
      `https://pinev.connect.evident.com/?` +
      `required_code_systems=icd9_and_icd10` +
      `&arid=1` +
      `&facid=1` +
      `&patient=${accountNumber}` +
      `&medical_records=true` +
      `&op=launch_charts_usher/mr_${accountNumber}_1/notes_runner`;

    console.log('');
    console.log('========================================');
    console.log('TESTING NOTES');
    console.log('========================================');

    console.log('Visit Key:', visitKey);
    console.log('Account Number:', accountNumber);
    console.log('URL:', url);

    // =========================================
    // 3. Open Notes page
    // =========================================

    console.log('');
    console.log('Opening Notes page...');

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await page.waitForTimeout(5000);

    console.log('Notes page loaded.');

    // =========================================
    // 4. Find frame containing Notes grid
    // =========================================

    console.log('');
    console.log('Searching all frames for Notes grid...');

    let notesFrame = null;

    for (const frame of page.frames()) {
      try {
        const count = await frame.locator('hl2-note-list-grid').count();

        console.log(`Frame: ${frame.url()} -> hl2-note-list-grid = ${count}`);

        if (count > 0) {
          notesFrame = frame;
          break;
        }
      } catch (error) {
        // Ignore inaccessible frame
      }
    }

    if (!notesFrame) {
      throw new Error('hl2-note-list-grid was not found in any frame.');
    }

    console.log('Notes grid found.');

    // =========================================
    // 5. Find AG Grid
    // =========================================

    const noteListGrid = notesFrame.locator('hl2-note-list-grid');

    const agGrid = noteListGrid.locator('ag-grid-angular');

    await agGrid.waitFor({
      state: 'attached',
      timeout: 60000,
    });

    console.log('AG Grid found.');

    // =========================================
    // 6. Wait for rows
    // =========================================

    const rows = agGrid.locator('.ag-center-cols-container [role="row"]');

    await rows.first().waitFor({
      state: 'attached',
      timeout: 60000,
    });

    await notesFrame.waitForTimeout(1000);

    const rowCount = await rows.count();

    console.log('');
    console.log('========================================');
    console.log('NOTES ROWS');
    console.log('========================================');

    console.log('Total rows:', rowCount);

    if (rowCount === 0) {
      throw new Error('No Notes rows found.');
    }

    // =========================================
    // 7. Extract metadata + row-id
    // =========================================

    const notes = [];

    for (let i = 0; i < rowCount; i++) {
      const row = rows.nth(i);

      // IMPORTANT:
      // Save AG Grid's actual row-id.
      // We will use this ID to find the same
      // row again before clicking it.

      const rowId = await row.getAttribute('row-id');

      if (!rowId) {
        console.log(`WARNING: Row ${i} does not have row-id.`);
      }

      const getCellText = async (colId) => {
        const cell = row.locator(`[col-id="${colId}"]`);

        if ((await cell.count()) === 0) {
          return '';
        }

        return (await cell.textContent())?.trim() || '';
      };

      const visitNumber = await getCellText('data.visit.display');

      const noteType = await getCellText('2');

      const chartedDateTime = await getCellText('3');

      const signedDateTime = await getCellText('4');

      const enteredBy = await getCellText('5');

      notes.push({
        rowId,
        visitNumber,
        noteType,
        chartedDateTime,
        signedDateTime,
        enteredBy,
        noteHtml: '',
      });
    }

    console.log('');
    console.log('Metadata extracted:');

    console.log(JSON.stringify(notes, null, 2));

    // =========================================
    // 8. Process each note
    // =========================================

    for (let i = 0; i < notes.length; i++) {
      const note = notes[i];

      console.log('');
      console.log('========================================');
      console.log(`PROCESSING NOTE ${i + 1} OF ${notes.length}`);
      console.log('========================================');

      console.log('Row ID:', note.rowId);
      console.log('Visit:', note.visitNumber);
      console.log('Note Type:', note.noteType);
      console.log('Charted:', note.chartedDateTime);
      console.log('Signed:', note.signedDateTime);
      console.log('Entered By:', note.enteredBy);

      // =======================================
      // 8A. Find EXACT same row again
      // =======================================

      if (!note.rowId) {
        console.log('Skipping because row-id is missing.');

        continue;
      }

      const exactRow = agGrid.locator(
        `.ag-center-cols-container [role="row"][row-id="${note.rowId}"]`
      );

      // =======================================
      // 8B. Make sure exact row is available
      // =======================================

      try {
        await exactRow.waitFor({
          state: 'attached',
          timeout: 10000,
        });
      } catch (error) {
        console.log(`Row ${note.rowId} is not currently rendered.`);

        console.log('This is likely AG Grid virtualization.');

        // Try scrolling the grid to bring the row
        // into the DOM.

        await notesFrame.evaluate((rowId) => {
          const row = document.querySelector(`[role="row"][row-id="${rowId}"]`);

          if (row) {
            row.scrollIntoView({
              block: 'center',
            });
          }
        }, note.rowId);

        await notesFrame.waitForTimeout(1000);

        // Find it again after scrolling.
        const retryRow = agGrid.locator(
          `.ag-center-cols-container [role="row"][row-id="${note.rowId}"]`
        );

        await retryRow.waitFor({
          state: 'attached',
          timeout: 10000,
        });
      }

      // =======================================
      // 8C. Find exact row one final time
      // =======================================

      const targetRow = agGrid.locator(
        `.ag-center-cols-container [role="row"][row-id="${note.rowId}"]`
      );

      await targetRow.waitFor({
        state: 'attached',
        timeout: 15000,
      });

      // =======================================
      // 8D. Verify row identity BEFORE click
      // =======================================

      const actualRowId = await targetRow.getAttribute('row-id');

      console.log('Row ID before click:', actualRowId);

      if (actualRowId !== note.rowId) {
        throw new Error(`Row mismatch before click. Expected ${note.rowId}, got ${actualRowId}`);
      }

      // =======================================
      // 8E. Click EXACT row
      // =======================================

      console.log('Clicking exact row...');

      await targetRow.click();

      console.log('Exact row clicked.');

      // =======================================
      // 8F. Wait for note HTML
      // =======================================

      let noteHtml = '';

      console.log('Waiting for note content...');

      // First try renderedtemplate.
      const renderedTemplate = notesFrame.locator('renderedtemplate');

      try {
        await renderedTemplate.first().waitFor({
          state: 'attached',
          timeout: 10000,
        });

        noteHtml = await renderedTemplate.first().evaluate((el) => el.outerHTML);
      } catch (error) {
        // Ignore and try fallback.
      }

      // =======================================
      // 8G. Fallback note container
      // =======================================

      if (!noteHtml) {
        const noteContainer = notesFrame.locator('.note-content-container');

        try {
          await noteContainer.first().waitFor({
            state: 'attached',
            timeout: 10000,
          });

          noteHtml = await noteContainer.first().evaluate((el) => el.outerHTML);
        } catch (error) {
          // Ignore.
        }
      }

      // =======================================
      // 8H. Save HTML to SAME note object
      // =======================================

      note.noteHtml = noteHtml;

      console.log('Note HTML length:', noteHtml.length);

      if (noteHtml) {
        console.log('Note HTML successfully extracted.');
      } else {
        console.log('WARNING: Note HTML was empty.');
      }

      // =======================================
      // 8I. Small delay before next row
      // =======================================

      await notesFrame.waitForTimeout(500);
    }

    // =========================================
    // 9. Final result
    // =========================================

    console.log('');
    console.log('========================================');
    console.log('FINAL NOTES RESULT');
    console.log('========================================');

    console.log(JSON.stringify(notes, null, 2));

    console.log('========================================');

    return notes;
  } catch (error) {
    console.error('');
    console.error('========================================');
    console.error('NOTES TEST FAILED');
    console.error('========================================');

    console.error(error);

    throw error;
  }
}

// =====================================================
// MAIN
// =====================================================

async function main() {
  let browser;

  try {
    console.log('Starting browser...');

    browser = await chromium.launch({
      headless: false,
    });

    const context = await browser.newContext();

    const page = await context.newPage();

    // =========================================
    // Login
    // =========================================

    await login(page);

    console.log('Login completed.');

    // =========================================
    // Test visit
    // =========================================

    const visitKey = 'V-1392423';

    await testNotes(page, visitKey);

    // =========================================
    // Keep browser open
    // =========================================

    console.log('');
    console.log('Browser will remain open for 60 seconds...');

    await page.waitForTimeout(60000);
  } catch (error) {
    console.error(error);
  } finally {
    if (browser) {
      console.log('Closing browser...');
      await browser.close();
    }
  }
}

main();
