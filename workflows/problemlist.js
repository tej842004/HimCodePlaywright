const { runPythonFunction } = require('../database/pythonRunner');

async function problemlist(page, visitKey) {
  try {
    // -----------------------------------------
    // 1. Get account number
    // -----------------------------------------

    const accountNumber = visitKey.split('V-').filter((x) => x.length > 0)[0];

    if (!accountNumber) {
      throw new Error(`Invalid visit key: ${visitKey}`);
    }

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
      `&op=launch_charts_usher/mr_${accountNumber}_1/problist`;

    console.log('Opening:', url);

    // -----------------------------------------
    // 3. Navigate
    // -----------------------------------------

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await page.waitForTimeout(5 * 1000);

    console.log('Problem List page loaded.');

    // -----------------------------------------
    // 4. Click "All" radio button
    // -----------------------------------------

    console.log('Clicking All radio button...');

    const allRadioButton = page
      .locator('cp-radiobutton#radfilterAll')
      .locator('vaadin-radio-button#radio');

    await allRadioButton.waitFor({
      state: 'visible',
      timeout: 120000,
    });

    await allRadioButton.click();

    console.log('All radio button clicked.');

    await page.waitForTimeout(2000);

    // -----------------------------------------
    // 5. Wait for Problem List application
    // -----------------------------------------

    console.log('Waiting for Problem List grid...');

    await page.waitForFunction(
      () => {
        const launcher = document.querySelector('body > cp-app-launcher');

        if (!launcher || !launcher.shadowRoot) {
          return false;
        }

        const control = launcher.shadowRoot.querySelector('#control');

        if (!control || !control.shadowRoot) {
          return false;
        }

        const mainpanel = control.shadowRoot.querySelector('#mainpanel');

        if (!mainpanel || !mainpanel.shadowRoot) {
          return false;
        }

        const screens = mainpanel.shadowRoot.querySelectorAll('[id^="screen_"]');

        for (const screen of screens) {
          if (!screen.shadowRoot) {
            continue;
          }

          const problemList = screen.shadowRoot.querySelector('#maplistproblems');

          if (!problemList || !problemList.shadowRoot) {
            continue;
          }

          const grid = problemList.shadowRoot.querySelector('cpsi-grid');

          if (grid) {
            return true;
          }
        }

        return false;
      },
      {
        timeout: 120000,
      }
    );

    console.log('Problem List grid found.');

    // -----------------------------------------
    // 6. Extract Problem List data
    // -----------------------------------------

    const problems = await page.evaluate(async () => {
      function delay(ms) {
        return new Promise((resolve) => setTimeout(resolve, ms));
      }

      // -----------------------------------------
      // Find cp-app-launcher
      // -----------------------------------------

      const launcher = document.querySelector('body > cp-app-launcher')?.shadowRoot;

      if (!launcher) {
        throw new Error('cp-app-launcher shadowRoot not found');
      }

      // -----------------------------------------
      // Find control
      // -----------------------------------------

      const control = launcher.querySelector('#control')?.shadowRoot;

      if (!control) {
        throw new Error('#control shadowRoot not found');
      }

      // -----------------------------------------
      // Find mainpanel
      // -----------------------------------------

      const mainpanel = control.querySelector('#mainpanel')?.shadowRoot;

      if (!mainpanel) {
        throw new Error('#mainpanel shadowRoot not found');
      }

      // -----------------------------------------
      // Find Problem List component
      // -----------------------------------------

      let maplistproblems = null;

      const screens = mainpanel.querySelectorAll('[id^="screen_"]');

      screens.forEach((screenEl) => {
        if (!screenEl.shadowRoot) {
          return;
        }

        const found = screenEl.shadowRoot.querySelector('#maplistproblems');

        if (found) {
          maplistproblems = found;
        }
      });

      if (!maplistproblems) {
        throw new Error('maplistproblems not found');
      }

      console.log('[Browser] #maplistproblems found.');

      // -----------------------------------------
      // Find cpsi-grid
      // -----------------------------------------

      const gridHost = maplistproblems.shadowRoot?.querySelector('cpsi-grid');

      if (!gridHost) {
        throw new Error('cpsi-grid not found');
      }

      console.log('[Browser] cpsi-grid found.');

      // -----------------------------------------
      // Wait for grid table
      // -----------------------------------------

      let upgraded = false;

      for (let attempt = 0; attempt < 30; attempt++) {
        if (gridHost.shadowRoot && gridHost.shadowRoot.querySelector('#table')) {
          upgraded = true;
          break;
        }

        await delay(300);
      }

      if (!upgraded) {
        throw new Error('grid table never rendered');
      }

      const scrollTable = gridHost.shadowRoot.querySelector('#table');

      if (!scrollTable) {
        throw new Error('#table not found');
      }

      console.log('[Browser] Grid table rendered.');

      // -----------------------------------------
      // Wait for grid loading
      // -----------------------------------------

      for (let attempt = 0; attempt < 40; attempt++) {
        if (!gridHost.hasAttribute('loading')) {
          break;
        }

        await delay(400);
      }

      await delay(700);

      console.log('[Browser] Grid loading completed.');

      // -----------------------------------------
      // Get total record count
      // -----------------------------------------

      let totalCount = null;

      for (let probeAttempt = 0; probeAttempt < 5 && totalCount === null; probeAttempt++) {
        try {
          totalCount = await new Promise((resolve, reject) => {
            const timeout = setTimeout(() => {
              reject(new Error('probe timeout'));
            }, 15000);

            gridHost.dataProvider(
              {
                page: 0,
                pageSize: 1,
                sortOrders: [],
                filters: [],
              },
              (items, size) => {
                clearTimeout(timeout);
                resolve(size);
              }
            );
          });
        } catch (error) {
          totalCount = null;

          await delay(1500);
        }
      }

      console.log(`[Browser] Total problems: ${totalCount}`);

      // -----------------------------------------
      // Force all rows visible
      // -----------------------------------------

      gridHost.setAttribute('all-rows-visible', '');

      if (typeof gridHost.recalculateColumnWidths === 'function') {
        try {
          gridHost.recalculateColumnWidths();
        } catch (error) {
          // Ignore
        }
      }

      try {
        gridHost.style.height = 'auto';
      } catch (error) {
        // Ignore
      }

      // -----------------------------------------
      // Extract fields
      // -----------------------------------------

      function extractFields(el) {
        function get(name) {
          const span = el.querySelector(`span[ctrl-name="${name}"]`);

          return span ? span.textContent.trim() : '';
        }

        const rankVal = get('pl1_rank');

        return {
          rank: rankVal === '' ? null : rankVal,

          description: get('pl1_probdesc'),

          icd10: get('pl1_probdiagcd'),

          diagnosisDate: get('pl1_diagdate'),

          status: get('pl1_probtypedesc'),

          addressedDate: get('pl1_problastaddr'),

          physician: get('phys1_name'),

          onsetDate: get('pl1_onsetdate'),

          medicalHx: get('pl1_medicalhistory'),
        };
      }

      // -----------------------------------------
      // Find visible rows
      // -----------------------------------------

      function collectVisibleRows() {
        const cellContents = gridHost.querySelectorAll('vaadin-grid-cell-content');

        const found = [];

        cellContents.forEach((cell) => {
          const mapDiv = cell.querySelector('.cp-map');

          if (mapDiv) {
            found.push(mapDiv);
          }
        });

        return found;
      }

      // -----------------------------------------
      // Store unique records
      // -----------------------------------------

      const collected = new Map();

      function collectNow() {
        collectVisibleRows().forEach((el) => {
          const data = extractFields(el);

          const key =
            (data.rank || '') +
            '|' +
            data.description +
            '|' +
            data.icd10 +
            '|' +
            data.addressedDate +
            '|' +
            data.physician +
            '|' +
            data.status;

          if (data.description) {
            collected.set(key, data);
          }
        });
      }

      // -----------------------------------------
      // Poll for rows
      // -----------------------------------------

      const maxWaitMs = 60000;
      const pollMs = 1000;

      let waited = 0;
      let lastCount = -1;
      let stableRounds = 0;

      console.log('[Browser] Waiting for problem rows...');

      while (waited < maxWaitMs) {
        collectNow();

        console.log(`[Browser] Problems collected: ${collected.size} / ${totalCount ?? 'unknown'}`);

        if (totalCount !== null && collected.size >= totalCount) {
          break;
        }

        if (collected.size === lastCount) {
          stableRounds++;
        } else {
          stableRounds = 0;
          lastCount = collected.size;
        }

        if (totalCount === null && stableRounds >= 8 && collected.size > 0) {
          break;
        }

        await delay(pollMs);

        waited += pollMs;
      }

      // -----------------------------------------
      // Scroll fallback
      // -----------------------------------------

      if (totalCount !== null && collected.size < totalCount) {
        console.log('[Browser] Starting scroll fallback...');

        gridHost.removeAttribute('all-rows-visible');

        await delay(1000);

        function scrollTo(position) {
          scrollTable.scrollTop = position;

          scrollTable.dispatchEvent(
            new Event('scroll', {
              bubbles: true,
            })
          );
        }

        const step = Math.max(60, Math.floor(scrollTable.clientHeight * 0.4));

        let iterations = 0;
        let stuckCount = 0;

        scrollTo(0);

        await delay(1500);

        collectNow();

        while (iterations < 500 && collected.size < totalCount) {
          const beforeScroll = scrollTable.scrollTop;

          scrollTo(scrollTable.scrollTop + step);

          await delay(1500);

          collectNow();

          if (scrollTable.scrollTop === beforeScroll) {
            stuckCount++;

            if (stuckCount >= 4) {
              break;
            }
          } else {
            stuckCount = 0;
          }

          iterations++;
        }

        scrollTo(scrollTable.scrollHeight);

        for (let i = 0; i < 5; i++) {
          await delay(1500);

          collectNow();
        }

        scrollTo(0);

        console.log('[Browser] Scroll fallback completed.');
      }

      // -----------------------------------------
      // Convert Map to Array
      // -----------------------------------------

      const results = Array.from(collected.values());

      // -----------------------------------------
      // Sort by rank
      // -----------------------------------------

      results.sort((a, b) => {
        const ra = a.rank === null ? Infinity : parseInt(a.rank, 10);

        const rb = b.rank === null ? Infinity : parseInt(b.rank, 10);

        return ra - rb;
      });

      return results;
    });

    // -----------------------------------------
    // 7. Log extracted data
    // -----------------------------------------

    console.log('');
    console.log('========================================');
    console.log('PROBLEM LIST EXTRACTION COMPLETE');
    console.log('========================================');

    console.log(`Problems found: ${problems.length}`);

    console.log(problems);

    console.log('========================================');

    // -----------------------------------------
    // 8. Save to database
    // -----------------------------------------

    const result = await runPythonFunction('problemlist', [visitKey, problems]);

    if (result.success && result.result) {
      console.log(`Problem List data saved successfully for ${visitKey}.`);
    } else {
      console.log(`Problem List data was NOT saved for ${visitKey}.`);
    }

    // -----------------------------------------
    // 9. Return extracted data
    // -----------------------------------------

    return problems;
  } catch (error) {
    console.error(`Error processing problem list for ${visitKey}:`, error);

    throw error;
  }
}

module.exports = {
  problemlist,
};
