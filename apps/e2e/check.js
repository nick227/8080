const { chromium } = require('@playwright/test');
(async () => {
  const browser = await chromium.launch();
  const page = await browser.newPage();
  page.on('console', msg => console.log('PAGE LOG:', msg.type(), msg.text()));
  page.on('pageerror', error => console.log('PAGE ERROR:', error.message));
  try {
    await page.goto('http://localhost:5173/');
    await page.waitForTimeout(2000);
  } catch (err) {
    console.error("GOTO ERROR", err);
  }
  await browser.close();
})();
