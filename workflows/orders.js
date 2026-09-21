const { runPythonFunction } = require('../database/pythonRunner');

const ORDER_COLUMNS = [
  'Start Date/Time',
  'Description',
  'Status',
  'Additional Info',
  'Ordering Provider',
  'Order Type',
  'Department',
  'Order Set/List/Protocol',
];

/**
 * Returns the currently rendered rows from the virtualized grid.
 */
function orderRows(page) {
  return page.locator("#order_chronology_listCtrl cpsi-grid#grid tbody#items tr[role='row']");
}

/**
 * Wait until the Order Chronology grid exists and
 * contains usable rendered data.
 *
 * If the table is completely empty, return the rows
 * locator without throwing an error.
 */
async function waitForOrderGrid(page) {
  const list = page.locator('#order_chronology_listCtrl');

  await list.waitFor({
    state: 'visible',
    timeout: 30000,
  });

  const rows = orderRows(page);

  /*
   * The grid can exist before the virtualized row
   * contents are fully populated.
   *
   * We wait for either:
   *
   * 1. A usable row
   * 2. The grid to remain completely empty
   */
  const startTime = Date.now();

  while (Date.now() - startTime < 15000) {
    const count = await rows.count();

    /*
     * If rows exist, check whether they contain
     * actual Order Chronology data.
     */
    if (count > 0) {
      for (let i = 0; i < count; i++) {
        const row = rows.nth(i);

        const cells = row.locator("td[role='gridcell']");

        if ((await cells.count()) < 3) {
          continue;
        }

        const date = (await getCellValue(cells.nth(1))).trim();

        const description = (await getCellValue(cells.nth(2))).trim();

        if (date || description) {
          return rows;
        }
      }
    }

    /*
     * Check whether the Order Chronology grid is
     * explicitly showing an empty list / no data.
     *
     * This also covers:
     *
     * <tbody id="items" role="rowgroup"></tbody>
     */
    const listText = await list.textContent();

    if (listText && /EMPTY LIST|NO DATA FOUND|No Data Found/i.test(listText)) {
      console.log('Order Chronology table is empty.');

      return rows;
    }

    /*
     * If tbody#items exists and contains no rows,
     * treat it as an empty Order Chronology table.
     */
    const itemsCount = await list.locator("cpsi-grid#grid tbody#items tr[role='row']").count();

    if (itemsCount === 0) {
      /*
       * Give the application a little time to populate
       * the grid before deciding it is genuinely empty.
       */
      await page.waitForTimeout(500);

      const secondCount = await list.locator("cpsi-grid#grid tbody#items tr[role='row']").count();

      if (secondCount === 0) {
        console.log('Order Chronology table contains no rows.');

        return rows;
      }
    }

    await page.waitForTimeout(300);
  }

  /*
   * If the grid exists but never produces usable data,
   * return the rows locator instead of throwing.
   */
  console.log('Order Chronology grid contains no usable data.');

  return rows;
}

/**
 * Reads the actual slotted content from a grid cell.
 *
 * The grid uses:
 *
 * <td>
 *   <slot>
 *     <vaadin-grid-cell-content>
 *       ...
 *     </vaadin-grid-cell-content>
 *   </slot>
 * </td>
 */
async function getCellValue(cell) {
  return await cell.evaluate((cellElement) => {
    const slot = cellElement.querySelector('slot');

    if (!slot) {
      return '';
    }

    const assignedElements = slot.assignedElements({
      flatten: true,
    });

    for (const element of assignedElements) {
      /*
       * Many grid cells contain:
       *
       * <span title="actual value">
       */
      const span = element.matches('span[title]') ? element : element.querySelector('span[title]');

      if (span) {
        const title = span.getAttribute('title');

        if (title && title !== 'undefined') {
          return title.trim();
        }

        return (span.textContent || '').replace(/\s+/g, ' ').trim();
      }

      const text = (element.textContent || '').replace(/\s+/g, ' ').trim();

      if (text) {
        return text;
      }
    }

    return '';
  });
}

/**
 * Reads an Order Detail .dataValue element.
 *
 * Supports normal text elements and cp-textarea
 * elements that use an open shadow root.
 */
async function readOrderDetailValue(dataValue) {
  return await dataValue.evaluate((element) => {
    /*
     * Normal text element.
     */
    if (element.tagName.toLowerCase() !== 'cp-textarea') {
      return (element.textContent || '').replace(/\s+/g, ' ').trim();
    }

    /*
     * cp-textarea uses an open shadow root.
     */
    const shadowRoot = element.shadowRoot;

    if (!shadowRoot) {
      return '';
    }

    const textarea = shadowRoot.querySelector('textarea');

    if (!textarea) {
      return '';
    }

    return (textarea.value || '').replace(/\s+/g, ' ').trim();
  });
}

/**
 * Reads the order description dynamically.
 *
 * IMPORTANT:
 *
 * Different Order Detail screens can use different
 * IDs for the description.
 *
 * Examples:
 *
 *   #or1_testdesc
 *   #orderDescription1
 *   #orderDescription2
 *   #orderDescription3
 *
 * The description can also be split across multiple
 * elements for multi-line descriptions.
 *
 * This function searches for all supported description
 * elements and combines them in DOM order.
 */
async function extractOrderDescription(orderInformation) {
  /*
   * First find all elements inside Order Information
   * that look like description elements.
   *
   * We intentionally do NOT use only:
   *
   * #or1_testdesc
   *
   * because other order types can use:
   *
   * orderDescription1
   * orderDescription2
   * etc.
   */
  const candidates = orderInformation.locator(
    '[id="or1_testdesc"], ' +
      '[id^="orderDescription"], ' +
      '[ctrl-name="or1_testdesc"], ' +
      '[ctrl-name^="orderDescription"]'
  );

  const count = await candidates.count();

  const descriptions = [];
  const seen = new Set();

  for (let i = 0; i < count; i++) {
    const candidate = candidates.nth(i);

    /*
     * Skip hidden elements when possible.
     */
    if (!(await candidate.isVisible())) {
      continue;
    }

    let value = '';

    /*
     * cp-textarea is possible, although the known
     * description examples are normally text elements.
     */
    if ((await candidate.evaluate((element) => element.tagName.toLowerCase())) === 'cp-textarea') {
      value = await readOrderDetailValue(candidate);
    } else {
      value = (await candidate.textContent())?.replace(/\s+/g, ' ').trim() || '';
    }

    if (!value) {
      continue;
    }

    /*
     * Avoid duplicate text if the same description
     * is exposed through both id and ctrl-name.
     */
    if (seen.has(value)) {
      continue;
    }

    seen.add(value);

    descriptions.push(value);
  }

  /*
   * If we found one or more explicit description
   * elements, combine them in DOM order.
   *
   * Example:
   *
   * orderDescription1 = "Medication A"
   * orderDescription2 = "Take once daily"
   *
   * Result:
   *
   * "Medication A Take once daily"
   */
  if (descriptions.length > 0) {
    return descriptions.join(' ').trim();
  }

  /*
   * FALLBACK
   *
   * Some versions of the application may use a
   * description element without one of the expected
   * IDs.
   *
   * We look at the content immediately before the
   * Order Information table.
   */
  const content = orderInformation.locator('.labeled-div-content').first();

  if (await content.count()) {
    /*
     * Look for dataValue elements that are NOT inside
     * the detail table.
     */
    const fallbackValues = content.locator('.dataValue:not(table .dataValue)');

    const fallbackCount = await fallbackValues.count();

    const fallbackDescriptions = [];

    for (let i = 0; i < fallbackCount; i++) {
      const element = fallbackValues.nth(i);

      if (!(await element.isVisible())) {
        continue;
      }

      const value = (await element.textContent())?.replace(/\s+/g, ' ').trim() || '';

      if (!value) {
        continue;
      }

      /*
       * Don't accidentally use known controls such
       * as boxed warning.
       */
      const id = await element.getAttribute('id');

      const ctrlName = await element.getAttribute('ctrl-name');

      const combinedIdentifier = `${id || ''} ${ctrlName || ''}`.toLowerCase();

      if (combinedIdentifier.includes('boxed_warn')) {
        continue;
      }

      if (!fallbackDescriptions.includes(value)) {
        fallbackDescriptions.push(value);
      }
    }

    if (fallbackDescriptions.length > 0) {
      return fallbackDescriptions.join(' ').trim();
    }
  }

  /*
   * Nothing found.
   */
  return '';
}

/**
 * Extracts the Order Information section dynamically.
 *
 * IMPORTANT:
 *
 * Labels are NOT hard-coded.
 *
 * If a labeled row is followed by rows where the first
 * cell is blank, those rows are treated as continuation
 * rows for the previous label.
 *
 * Example:
 *
 * Signed:
 *   Verbal: 952961 HAMAMI ANWAR
 *
 *   Signature pending. Readback
 *
 *   successfully.
 *
 * becomes:
 *
 * "Signed":
 *   "Verbal: 952961 HAMAMI ANWAR Signature pending. Readback successfully."
 *
 * This applies to ALL labels dynamically.
 */
async function extractOrderDetails(page) {
  /*
   * Locate the specific Order Information section.
   */
  const orderInformation = page
    .locator('div.labeled-div')
    .filter({
      has: page.locator('div.div-label').filter({
        hasText: /^Order Information$/,
      }),
    })
    .first();

  await orderInformation.waitFor({
    state: 'visible',
    timeout: 30000,
  });

  /*
   * -----------------------------------------------
   * ORDER DESCRIPTION
   * -----------------------------------------------
   */
  const orderDescription = await extractOrderDescription(orderInformation);

  /*
   * -----------------------------------------------
   * ORDER INFORMATION TABLE
   * -----------------------------------------------
   */
  const rows = orderInformation.locator('table.cp-table > tbody > tr.cp-row');

  const rowCount = await rows.count();

  /*
   * Store the final values here.
   */
  const details = {};

  /*
   * IMPORTANT:
   *
   * This keeps track of the most recent label.
   *
   * Example:
   *
   * Row 1 -> Signed:
   * currentLabel = "Signed"
   *
   * Row 2 -> blank:
   * currentLabel remains "Signed"
   *
   * Row 3 -> blank:
   * currentLabel remains "Signed"
   *
   * Row 4 -> Cosigned:
   * currentLabel = "Cosigned"
   */
  let currentLabel = null;

  /*
   * Process every table row.
   */
  for (let i = 0; i < rowCount; i++) {
    const row = rows.nth(i);

    const cells = row.locator('td');

    const cellCount = await cells.count();

    if (cellCount === 0) {
      continue;
    }

    /*
     * -----------------------------------------------
     * READ LABEL
     * -----------------------------------------------
     *
     * The first <td> normally contains:
     *
     * Signed:
     *
     * or:
     *
     * Dose:
     *
     * etc.
     *
     * Continuation rows have an empty first <td>.
     */
    let label = (await cells.nth(0).textContent())?.replace(/\s+/g, ' ').trim() || '';

    /*
     * Remove trailing colon.
     */
    label = label.replace(/:\s*$/, '').trim();

    /*
     * If this row has a label, this becomes the
     * current field.
     *
     * If the row has NO label, we keep using the
     * previous label.
     */
    if (label) {
      currentLabel = label;

      /*
       * Initialize the field if it doesn't already exist.
       */
      if (!details[currentLabel]) {
        details[currentLabel] = '';
      }
    }

    /*
     * If there is no label AND there has never been
     * a previous label, there is nowhere to store
     * the value.
     */
    if (!currentLabel) {
      continue;
    }

    /*
     * -----------------------------------------------
     * READ DATA VALUES
     * -----------------------------------------------
     *
     * This works with:
     *
     * cp-text
     * cp-textarea
     * multiple .dataValue elements
     *
     * It also works on continuation rows.
     */
    const dataValues = row.locator('.dataValue');

    const dataValueCount = await dataValues.count();

    const values = [];

    for (let valueIndex = 0; valueIndex < dataValueCount; valueIndex++) {
      const dataValue = dataValues.nth(valueIndex);

      const value = await readOrderDetailValue(dataValue);

      if (value) {
        values.push(value);
      }
    }

    /*
     * -----------------------------------------------
     * FALLBACK
     * -----------------------------------------------
     *
     * If there are no .dataValue elements, use
     * the remaining table cells.
     */
    if (values.length === 0) {
      for (let cellIndex = 1; cellIndex < cellCount; cellIndex++) {
        const value = (await cells.nth(cellIndex).textContent())?.replace(/\s+/g, ' ').trim() || '';

        if (value) {
          values.push(value);
        }
      }
    }

    /*
     * -----------------------------------------------
     * APPEND VALUE
     * -----------------------------------------------
     *
     * This is the important fix.
     *
     * If this is the first value:
     *
     * Signed:
     *   Verbal: 952961 HAMAMI ANWAR
     *
     * details.Signed =
     *   "Verbal: 952961 HAMAMI ANWAR"
     *
     * Then the next blank-label row:
     *
     *   Signature pending. Readback
     *
     * is appended:
     *
     * details.Signed =
     *   "Verbal: 952961 HAMAMI ANWAR Signature pending. Readback"
     *
     * Then:
     *
     *   successfully.
     *
     * is appended:
     *
     * details.Signed =
     *   "Verbal: 952961 HAMAMI ANWAR Signature pending. Readback successfully."
     */
    if (values.length > 0) {
      const newValue = values.join(' ').trim();

      if (details[currentLabel]) {
        details[currentLabel] = `${details[currentLabel]} ${newValue}`.replace(/\s+/g, ' ').trim();
      } else {
        details[currentLabel] = newValue;
      }
    }
  }

  /*
   * Return Order Description first, followed by
   * all dynamically discovered Order Information
   * fields.
   */
  return {
    'Order Description': orderDescription,
    ...details,
  };
}

/**
 * Extracts the Administrations section.
 *
 * Some orders have an Administrations section.
 * Some orders do not have the section at all.
 * Some have the section but no administration rows.
 *
 * In either case, return [] instead of throwing an error.
 */
async function extractAdministrations(page) {
  const administrationsSection = page
    .locator('div.labeled-div')
    .filter({
      has: page.locator('div.div-label').filter({
        hasText: /^Administrations$/,
      }),
    })
    .first();

  /*
   * Some orders do not contain an Administrations section.
   *
   * locator.count() does not wait for the element,
   * so this safely handles a completely missing section.
   */
  const sectionCount = await administrationsSection.count();

  if (sectionCount === 0) {
    console.log('Administrations section not present. Returning empty list.');

    return [];
  }

  await administrationsSection.waitFor({
    state: 'visible',
    timeout: 10000,
  });

  const administrationRows = administrationsSection.locator(
    "#resultlist cpsi-grid#list tbody#items tr[role='row']"
  );

  /*
   * Give the Administrations grid a moment to render.
   */
  await page.waitForTimeout(500);

  const count = await administrationRows.count();

  /*
   * Administrations section exists, but there are
   * no rows. This corresponds to:
   *
   * <tbody id="items" role="rowgroup"></tbody>
   *
   * and the UI showing "EMPTY LIST".
   */
  if (count === 0) {
    console.log('Administrations section is empty. Returning empty list.');

    return [];
  }

  async function readAdministrationRow(row) {
    return await row.evaluate((rowElement) => {
      const cell = rowElement.querySelector("td[role='gridcell']");

      if (!cell) {
        return null;
      }

      const slot = cell.querySelector('slot');

      if (!slot) {
        return null;
      }

      const assignedElements = slot.assignedElements({
        flatten: true,
      });

      let content = null;

      for (const element of assignedElements) {
        if (element.matches('vaadin-grid-cell-content')) {
          content = element;
          break;
        }
      }

      if (!content) {
        return null;
      }

      function getValue(ctrlName) {
        const element = content.querySelector(`[ctrl-name="${ctrlName}"]`);

        if (!element) {
          return '';
        }

        return (element.textContent || '').replace(/\s+/g, ' ').trim();
      }

      const ariaRowIndex = rowElement.getAttribute('aria-rowindex');

      const rowNumber = ariaRowIndex ? Number(ariaRowIndex) : null;

      return {
        rowNumber,
        Date: getValue('admin_date'),
        Time: getValue('admin_time'),
        Action: getValue('admin_action'),
        Dose: getValue('admin_dose_unit'),
        Route: getValue('admin_route'),
        Site: getValue('admin_site'),
        Credentials: getValue('admin_credentials'),
        Scanned: getValue('scanned'),
      };
    });
  }

  const administrations = [];

  for (let i = 0; i < count; i++) {
    const row = administrationRows.nth(i);

    const administration = await readAdministrationRow(row);

    if (
      !administration ||
      (!administration.Date && !administration.Time && !administration.Action)
    ) {
      continue;
    }

    administrations.push(administration);
  }

  administrations.sort((a, b) => a.rowNumber - b.rowNumber);

  return administrations.map(({ rowNumber, ...administration }) => administration);
}

/**
 * Scroll the virtualized grid.
 *
 * Uses smaller increments to allow the application
 * to recycle/render rows correctly.
 */
async function scrollOrderGrid(page, amount = 250) {
  return await page
    .locator('#order_chronology_listCtrl cpsi-grid#grid')
    .evaluate((grid, amount) => {
      const shadow = grid.shadowRoot;

      if (!shadow) {
        return {
          success: false,
          reason: 'Grid shadow root not found.',
        };
      }

      const items = shadow.querySelector('#items');

      if (!items) {
        return {
          success: false,
          reason: '#items element not found.',
        };
      }

      let scrollable = null;

      let element = items;

      while (element) {
        const style = getComputedStyle(element);

        if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
          scrollable = element;
          break;
        }

        element = element.parentElement;
      }

      /*
       * Fallback.
       */
      if (!scrollable) {
        element = items.parentElement;

        while (element) {
          if (element.scrollHeight > element.clientHeight) {
            scrollable = element;
            break;
          }

          element = element.parentElement;
        }
      }

      if (!scrollable) {
        /*
         * The grid may contain real order data but have
         * nothing to scroll.
         *
         * This happens when all rows fit inside the visible
         * grid area, for example when there is only one order.
         *
         * Treat this as being already at the bottom instead
         * of throwing an error.
         */
        return {
          success: true,
          before: 0,
          after: 0,
          scrollHeight: 0,
          clientHeight: 0,
          atBottom: true,
        };
      }

      const before = scrollable.scrollTop;

      const maxScrollTop = Math.max(0, scrollable.scrollHeight - scrollable.clientHeight);

      const targetScrollTop = Math.min(before + amount, maxScrollTop);

      scrollable.scrollTop = targetScrollTop;

      return {
        success: true,
        before,
        after: scrollable.scrollTop,
        scrollHeight: scrollable.scrollHeight,
        clientHeight: scrollable.clientHeight,
        atBottom: scrollable.scrollTop >= maxScrollTop - 2,
      };
    }, amount);
}

/**
 * Return the virtualized grid to the top.
 */
async function scrollOrderGridToTop(page) {
  await page.locator('#order_chronology_listCtrl cpsi-grid#grid').evaluate((grid) => {
    const shadow = grid.shadowRoot;

    if (!shadow) {
      return;
    }

    const items = shadow.querySelector('#items');

    if (!items) {
      return;
    }

    let scrollable = null;

    let element = items;

    while (element) {
      const style = getComputedStyle(element);

      if (/(auto|scroll)/.test(style.overflowY) && element.scrollHeight > element.clientHeight) {
        scrollable = element;
        break;
      }

      element = element.parentElement;
    }

    if (!scrollable) {
      element = items.parentElement;

      while (element) {
        if (element.scrollHeight > element.clientHeight) {
          scrollable = element;
          break;
        }

        element = element.parentElement;
      }
    }

    if (scrollable) {
      scrollable.scrollTop = 0;
    }
  });

  /*
   * Allow the virtualized grid to recycle rows.
   */
  await page.waitForTimeout(1000);
}

/**
 * Read all currently rendered Order Chronology rows.
 */
async function readVisibleOrderRows(page) {
  const rows = orderRows(page);

  const count = await rows.count();

  const visibleOrders = [];

  for (let i = 0; i < count; i++) {
    const row = rows.nth(i);

    const ariaRowIndex = await row.getAttribute('aria-rowindex');

    const cells = row.locator("td[role='gridcell']");

    const cellCount = await cells.count();

    if (cellCount < 3) {
      continue;
    }

    const values = [];

    for (let columnIndex = 1; columnIndex < cellCount; columnIndex++) {
      values.push(await getCellValue(cells.nth(columnIndex)));
    }

    const date = (values[0] || '').trim();

    const description = (values[1] || '').trim();

    /*
     * Ignore rows that are currently being recycled.
     */
    if (!date && !description) {
      continue;
    }

    const rowNumber = ariaRowIndex ? Number(ariaRowIndex) - 1 : null;

    visibleOrders.push({
      row,
      rowNumber,
      date,
      description,
      values,
    });
  }

  return visibleOrders;
}

/**
 * Extract every order from the virtualized grid.
 */
async function extractOrders(page) {
  const rows = await waitForOrderGrid(page);

  /*
   * Check whether the grid contains actual order data.
   *
   * Some empty grids still render one row containing:
   *
   *     No Data Found
   *
   * That row must be treated as an empty result.
   */
  const initialRowCount = await rows.count();

  if (initialRowCount === 0) {
    console.log('');
    console.log('No Order Chronology data found.');
    console.log('Returning empty order list.');
    console.log('');

    return [];
  }

  let hasActualOrderData = false;

  for (let i = 0; i < initialRowCount; i++) {
    const row = rows.nth(i);

    const cells = row.locator("td[role='gridcell']");

    if ((await cells.count()) < 3) {
      continue;
    }

    const date = (await getCellValue(cells.nth(1))).trim();

    const description = (await getCellValue(cells.nth(2))).trim();

    /*
     * Ignore the application's empty-grid row:
     *
     *     No Data Found
     */
    if (date === 'No Data Found' || description === 'No Data Found') {
      continue;
    }

    /*
     * A real order should have at least a date
     * or description.
     */
    if (date || description) {
      hasActualOrderData = true;
      break;
    }
  }

  /*
   * No real orders were found.
   *
   * This covers:
   *
   *     <tbody id="items"></tbody>
   *
   * and:
   *
   *     No Data Found
   */
  if (!hasActualOrderData) {
    console.log('');
    console.log('No Order Chronology data found.');
    console.log('Returning empty order list.');
    console.log('');

    return [];
  }

  await scrollOrderGridToTop(page);

  const orders = [];

  const seen = new Set();

  let lastScrollTop = -1;
  let unchangedScrolls = 0;

  console.log('');
  console.log('Scanning entire Order Chronology grid...');
  console.log('');

  while (true) {
    await page.waitForTimeout(700);

    const visibleOrders = await readVisibleOrderRows(page);

    for (const visibleOrder of visibleOrders) {
      const { rowNumber, date, description, values } = visibleOrder;

      const key = rowNumber ? `${rowNumber}|${date}|${description}` : `${date}|${description}`;

      if (seen.has(key)) {
        continue;
      }

      seen.add(key);

      const item = {
        rowNumber: rowNumber || orders.length + 1,
      };

      ORDER_COLUMNS.forEach((column, index) => {
        item[column] = values[index] || '';
      });

      orders.push(item);

      console.log(`Extracted row ${item.rowNumber}: ` + `${date} | ${description}`);
    }

    const scrollResult = await scrollOrderGrid(page, 250);

    if (!scrollResult.success) {
      throw new Error(`Could not scroll Order Chronology: ` + scrollResult.reason);
    }

    await page.waitForTimeout(700);

    if (scrollResult.atBottom) {
      await page.waitForTimeout(1000);

      const finalVisibleOrders = await readVisibleOrderRows(page);

      for (const visibleOrder of finalVisibleOrders) {
        const { rowNumber, date, description, values } = visibleOrder;

        const key = rowNumber ? `${rowNumber}|${date}|${description}` : `${date}|${description}`;

        if (seen.has(key)) {
          continue;
        }

        seen.add(key);

        const item = {
          rowNumber: rowNumber || orders.length + 1,
        };

        ORDER_COLUMNS.forEach((column, index) => {
          item[column] = values[index] || '';
        });

        orders.push(item);

        console.log(`Extracted row ${item.rowNumber}: ` + `${date} | ${description}`);
      }

      break;
    }

    if (scrollResult.after === lastScrollTop) {
      unchangedScrolls++;

      if (unchangedScrolls >= 8) {
        break;
      }
    } else {
      unchangedScrolls = 0;
    }

    lastScrollTop = scrollResult.after;
  }

  /*
   * Sort by actual grid row number.
   */
  orders.sort((a, b) => a.rowNumber - b.rowNumber);

  /*
   * Validate that row numbers are sequential.
   */
  for (let i = 0; i < orders.length; i++) {
    const expectedRowNumber = i + 1;

    if (orders[i].rowNumber !== expectedRowNumber) {
      throw new Error(
        `ORDER EXTRACTION VALIDATION FAILED.\n` +
          `Expected grid row ${expectedRowNumber}.\n` +
          `Found grid row ${orders[i].rowNumber}.\n` +
          `Date: ${orders[i]['Start Date/Time']}\n` +
          `Description: ${orders[i].Description}`
      );
    }
  }

  await scrollOrderGridToTop(page);

  console.log('');
  console.log(`Total rows extracted: ${orders.length}`);
  console.log('');

  return orders;
}

/**
 * Find an order anywhere in the virtualized grid.
 *
 * We search using the actual Date + Description,
 * NOT aria-rowindex.
 */
async function findOrderRow(page, expectedOrder) {
  await waitForOrderGrid(page);

  const expectedDate = String(expectedOrder['Start Date/Time'] || '').trim();

  const expectedDescription = String(expectedOrder.Description || '').trim();

  const targetRowNumber = Number(expectedOrder.rowNumber);

  console.log(
    `Searching for row ${targetRowNumber}: ` + `${expectedDate} | ` + `${expectedDescription}`
  );

  await scrollOrderGridToTop(page);

  let lastScrollTop = -1;
  let unchangedScrolls = 0;

  while (true) {
    /*
     * Wait for virtualized rows to settle.
     */
    await page.waitForTimeout(900);

    const visibleOrders = await readVisibleOrderRows(page);

    /*
     * Search actual row contents.
     */
    for (const visibleOrder of visibleOrders) {
      if (visibleOrder.date === expectedDate && visibleOrder.description === expectedDescription) {
        console.log(`Found row ${targetRowNumber}.`);

        return visibleOrder.row;
      }
    }

    /*
     * Not found yet.
     */
    const scrollResult = await scrollOrderGrid(page, 250);

    if (!scrollResult.success) {
      throw new Error(`Could not scroll Order Chronology: ` + scrollResult.reason);
    }

    await page.waitForTimeout(900);

    /*
     * Bottom reached.
     */
    if (scrollResult.atBottom) {
      await page.waitForTimeout(1200);

      const finalVisibleOrders = await readVisibleOrderRows(page);

      for (const visibleOrder of finalVisibleOrders) {
        if (
          visibleOrder.date === expectedDate &&
          visibleOrder.description === expectedDescription
        ) {
          console.log(`Found row ${targetRowNumber} ` + `during final grid scan.`);

          return visibleOrder.row;
        }
      }

      return null;
    }

    /*
     * Safety check.
     */
    if (scrollResult.after === lastScrollTop) {
      unchangedScrolls++;

      if (unchangedScrolls >= 8) {
        return null;
      }
    } else {
      unchangedScrolls = 0;
    }

    lastScrollTop = scrollResult.after;
  }
}

/**
 * Find the visible Back button.
 */
async function findVisibleBackButton(page) {
  const backButtons = page.locator('cpsi-button[title="Back"]');

  const backCount = await backButtons.count();

  for (let i = 0; i < backCount; i++) {
    const candidate = backButtons.nth(i);

    if (await candidate.isVisible()) {
      return candidate;
    }
  }

  return null;
}

/**
 * Main Order Chronology workflow.
 */
async function order(page, visitKey) {
  try {
    // -----------------------------------------
    // 1. Get account number
    // -----------------------------------------

    const accountNumber = visitKey.split('V-').filter((x) => x.length > 0)[0];

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
      `&op=launch_charts_usher/mr_${accountNumber}_1/orderChronology`;

    console.log('Opening:', url);

    // -----------------------------------------
    // 3. Navigate
    // -----------------------------------------

    await page.goto(url, {
      waitUntil: 'domcontentloaded',
      timeout: 120000,
    });

    await page.waitForTimeout(5 * 1000);

    // -----------------------------------------
    // 4. Extract all orders
    // -----------------------------------------

    const orders = await extractOrders(page);

    // -----------------------------------------
    // 5. Log extracted data
    // -----------------------------------------

    console.log(`Orders found: ${orders.length}`);

    console.log(orders);

    // -----------------------------------------
    // 6. Process every order
    // -----------------------------------------

    console.log('');
    console.log('Starting row-by-row processing...');
    console.log('');

    for (let index = 0; index < orders.length; index++) {
      const currentOrder = orders[index];

      console.log('--------------------------------------------------');

      console.log(
        `Opening row ${index + 1} of ` +
          `${orders.length} ` +
          `(grid row ${currentOrder.rowNumber})`
      );

      console.log(`Date: ${currentOrder['Start Date/Time']}`);

      console.log(`Description: ${currentOrder.Description}`);

      // -----------------------------------------
      // Find the actual row by its data
      // -----------------------------------------

      const row = await findOrderRow(page, currentOrder);

      if (!row) {
        throw new Error(
          `Could not find order row.\n` +
            `Grid row: ${currentOrder.rowNumber}\n` +
            `Date: ${currentOrder['Start Date/Time']}\n` +
            `Description: ${currentOrder.Description}`
        );
      }

      // -----------------------------------------
      // Get cells
      // -----------------------------------------

      const cells = row.locator("td[role='gridcell']");

      if ((await cells.count()) < 3) {
        throw new Error(
          `Matched row does not contain enough cells.\n` + `Grid row: ${currentOrder.rowNumber}`
        );
      }

      // -----------------------------------------
      // FINAL verification immediately before
      // clicking
      // -----------------------------------------

      const actualDate = (await getCellValue(cells.nth(1))).trim();

      const actualDescription = (await getCellValue(cells.nth(2))).trim();

      const expectedDate = String(currentOrder['Start Date/Time'] || '').trim();

      const expectedDescription = String(currentOrder.Description || '').trim();

      console.log(`Matched row: ${actualDate} | ${actualDescription}`);

      // -----------------------------------------
      // Never click the wrong order
      // -----------------------------------------

      if (actualDate !== expectedDate || actualDescription !== expectedDescription) {
        throw new Error(
          `ROW MISMATCH - refusing to click.\n` +
            `Grid row: ${currentOrder.rowNumber}\n` +
            `Expected: ${expectedDate} | ${expectedDescription}\n` +
            `Found: ${actualDate} | ${actualDescription}`
        );
      }

      // -----------------------------------------
      // Start Date/Time cell
      // -----------------------------------------

      const startDateCell = cells.nth(1);

      await startDateCell.scrollIntoViewIfNeeded();

      await page.waitForTimeout(300);

      // -----------------------------------------
      // One final read immediately before
      // double-click
      // -----------------------------------------

      const finalDate = (await getCellValue(cells.nth(1))).trim();

      const finalDescription = (await getCellValue(cells.nth(2))).trim();

      if (finalDate !== expectedDate || finalDescription !== expectedDescription) {
        throw new Error(
          `ROW CHANGED BEFORE CLICK - refusing to click.\n` +
            `Expected: ${expectedDate} | ${expectedDescription}\n` +
            `Found: ${finalDate} | ${finalDescription}`
        );
      }

      console.log('Double-clicking correct row...');

      await startDateCell.dblclick();

      console.log('Order opened.');

      // -----------------------------------------
      // Wait for Order Detail
      // -----------------------------------------

      console.log('Waiting 6 seconds...');

      await page.waitForTimeout(6000);

      console.log('6 seconds completed.');

      // -----------------------------------------
      // ORDER DETAIL
      // -----------------------------------------

      console.log('Extracting Order Detail...');

      const orderDetails = await extractOrderDetails(page);

      console.log('Order Detail extracted.');

      currentOrder['order details'] = orderDetails;

      if (!orderDetails['Order Description']) {
        console.warn('WARNING: Order Description was not found for this order.');

        console.warn(`Grid Description: ${currentOrder.Description}`);
      } else {
        console.log(`Order Description: ${orderDetails['Order Description']}`);
      }

      console.log(JSON.stringify(orderDetails, null, 2));

      // -----------------------------------------
      // ADMINISTRATIONS
      // -----------------------------------------

      console.log('Extracting Administrations...');

      const administrations = await extractAdministrations(page);

      console.log('Administrations extracted.');

      currentOrder['administrations'] = administrations;

      console.log(JSON.stringify(administrations, null, 2));

      // -----------------------------------------
      // BACK
      // -----------------------------------------

      console.log('Clicking Back...');

      const backButton = await findVisibleBackButton(page);

      if (!backButton) {
        const backCount = await page.locator('cpsi-button[title="Back"]').count();

        throw new Error(`No visible Back button found. ` + `Total Back buttons: ${backCount}`);
      }

      await backButton.scrollIntoViewIfNeeded();

      await backButton.click();

      console.log('Back button clicked.');

      // -----------------------------------------
      // Wait for chronology grid
      // -----------------------------------------

      await waitForOrderGrid(page);

      await page.waitForTimeout(1500);

      console.log('Returned to Order Chronology.');

      console.log('');
    }

    // -----------------------------------------
    // 7. Final result
    // -----------------------------------------

    console.log(`Order Chronology completed for ${visitKey}.`);

    console.log(`Total rows processed: ${orders.length}`);

    // -----------------------------------------
    // 8. Save to database
    // -----------------------------------------

    const result = await runPythonFunction('orders', [visitKey, orders]);

    if (result.success && result.result) {
      console.log(`Order data saved successfully for ${visitKey}.`);
    } else {
      console.log(`Order data was NOT saved for ${visitKey}.`);
    }

    return orders;
  } catch (error) {
    console.error(`Error processing patient ${visitKey}:`, error);

    throw error;
  }
}

module.exports = {
  order,
};
