const { chromium } = require('playwright');

const { login } = require('./workflows/login');
const { ingestHimCodingWorklist } = require('./workflows/himCodingWorklist');

const { insertBotSchedulerRunInfo, closeDatabase } = require('./database/database');

async function main() {
  let browser;

  // =====================================================
  // Bot information
  // =====================================================

  const botName = 'cpsi_him_work_log';

  // =====================================================
  // Bot run start time
  // =====================================================

  const startedAt = new Date();

  let status = 'failed';

  console.log('');
  console.log('========================================');
  console.log('BOT RUN STARTED');
  console.log('Bot Name:', botName);
  console.log('Started At:', startedAt.toISOString());
  console.log('========================================');

  try {
    // =====================================================
    // 1. Start browser
    // =====================================================

    console.log('Starting browser...');

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

    console.log('Login completed.');

    // =====================================================
    // 5. Run HIM Coding Worklist
    // =====================================================

    await ingestHimCodingWorklist(page);

    // =====================================================
    // Everything completed successfully
    // =====================================================

    status = 'success';

    console.log('');
    console.log('========================================');
    console.log('ALL WORKFLOWS COMPLETED');
    console.log('========================================');
  } catch (error) {
    // =====================================================
    // Workflow failed
    // =====================================================

    status = 'failed';

    console.error('');
    console.error('========================================');
    console.error('MAIN WORKFLOW FAILED');
    console.error('========================================');

    console.error(error);
  } finally {
    // =====================================================
    // 6. Set ending time
    // =====================================================

    const endedAt = new Date();

    console.log('');
    console.log('========================================');
    console.log('BOT RUN FINISHED');
    console.log('Bot Name:', botName);
    console.log('Started At:', startedAt.toISOString());
    console.log('Ended At:', endedAt.toISOString());
    console.log('Status:', status);
    console.log('========================================');

    // =====================================================
    // 7. Insert bot run information into database
    // =====================================================

    try {
      console.log('Saving bot run information...');

      await insertBotSchedulerRunInfo(botName, startedAt, endedAt, status);

      console.log('Bot run information saved successfully.');
    } catch (dbError) {
      console.error('Failed to save bot run information:');
      console.error(dbError);
    }

    // =====================================================
    // 8. Close browser
    // =====================================================

    if (browser) {
      console.log('Closing browser...');

      try {
        await browser.close();
      } catch (browserError) {
        console.error('Error while closing browser:', browserError);
      }
    }

    // =====================================================
    // 9. Close database pool
    // =====================================================

    try {
      await closeDatabase();
    } catch (dbCloseError) {
      console.error('Error while closing database:', dbCloseError);
    }
  }
}

main();
