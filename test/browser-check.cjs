const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');

(async () => {
  const browser = await chromium.launch({ headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const errors = [];
  const badResponses = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(message.text());
  });
  page.on('response', (response) => {
    if (response.status() >= 400) badResponses.push(`${response.status()} ${response.url()}`);
  });

  await page.goto(process.env.HERDVIEW_URL || 'http://127.0.0.1:8795/', { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('#conn-state')?.textContent.startsWith('ready'));
  await page.locator('#term-container canvas').first().waitFor({ state: 'visible' });
  await page.waitForFunction(() => document.querySelector('#term-title')?.textContent.includes('demo'));
  await page.locator('#term-container canvas').first().click();
  await page.keyboard.type('echo HERDVIEW_TYPING_OK');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  await page.locator('#btn-observe').click();
  await page.locator('#mode-badge').waitFor({ state: 'visible' });
  await page.waitForTimeout(500);
  await page.keyboard.type('echo HERDVIEW_OBSERVE_BLOCKED');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(300);
  await page.screenshot({
    path: process.env.HERDVIEW_SCREENSHOT || '/mnt/secure/k8s/github/herdview/browser-validation.png',
    fullPage: true,
  });
  console.log(JSON.stringify({
    title: await page.locator('#term-title').textContent(),
    connection: await page.locator('#conn-state').textContent(),
    canvases: await page.locator('#term-container canvas').count(),
    observeVisible: await page.locator('#mode-badge').isVisible(),
    errors,
    badResponses,
  }, null, 2));
  await browser.close();
  if (errors.length || badResponses.length) process.exitCode = 1;
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
