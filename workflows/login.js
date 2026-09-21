async function login(page) {
  console.log("Opening login page...");

  await page.goto("https://pinev.connect.evident.com/", {
    waitUntil: "domcontentloaded",
    timeout: 60000,
  });

  console.log("Entering username...");

  await page
    .locator("#input-cpsi-text-field-6")
    .fill(process.env.PINEV_USERNAME);

  console.log("Entering password...");

  await page
    .locator("#input-cpsi-password-field-7")
    .fill(process.env.PINEV_PASSWORD);

  console.log("Clicking Sign In...");

  await page.getByRole("button", { name: "Sign In" }).click();

  await page.waitForLoadState("domcontentloaded");

  console.log("Login completed.");

  await page.waitForTimeout(15 * 1000);
}

module.exports = {
  login,
};
