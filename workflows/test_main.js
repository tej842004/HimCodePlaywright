require('dotenv').config();

const { chromium } = require('playwright');

const { login } = require('./login');
const { order } = require('./orders');

async function main() {
  const browser = await chromium.launch({
    headless: false,
  });

  const context = await browser.newContext({
    acceptDownloads: true,
  });

  const page = await context.newPage();

  try {
    await login(page);

    console.log('Login completed.');

    const orders = await order(page);

    console.log('\nFINAL JSON:');

    console.log(JSON.stringify(orders, null, 2));

    /*
     * Keep browser open for testing.
     */
    await new Promise((resolve) => setTimeout(resolve, 60000));
  } catch (error) {
    console.error('\nORDER WORKFLOW FAILED');
    console.error(error);
  } finally {
    console.log('Closing browser...');

    await browser.close();
  }
}

main();
