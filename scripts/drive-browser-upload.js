// Upload local files to a Google Drive folder through a Browserbase session (CDP).
// Usage: CONNECT_URL=wss://... node drive-browser-upload.js <folderId> <file> [file...]
const { chromium } = require('playwright');

const [folderId, ...files] = process.argv.slice(2);
const SHOT = process.env.SHOT_DIR || '.';

(async () => {
  const browser = await chromium.connectOverCDP(process.env.CONNECT_URL);
  const ctx = browser.contexts()[0];
  const page = ctx.pages()[0] || (await ctx.newPage());
  try {
    await page.goto(`https://drive.google.com/drive/folders/${folderId}`, {
      waitUntil: 'domcontentloaded', timeout: 90000,
    });
    await page.waitForTimeout(8000);
    const acct = await page.evaluate(() => {
      const a = document.querySelector('a[href*="SignOutOptions"], a[aria-label*="Google Account"]');
      return a ? a.getAttribute('aria-label') : null;
    });
    console.log('URL:', page.url());
    console.log('ACCOUNT:', acct);
    if (!/drive\.google\.com\/drive/.test(page.url())) {
      await page.screenshot({ path: `${SHOT}/drive-login-state.png` });
      throw new Error('Not on the Drive folder page — likely not logged in or no access.');
    }

    for (const file of files) {
      // Open the New menu, then "File upload" — Drive spawns a native chooser.
      const newBtn = page.locator(
        '[guidedhelpid="new_menu_button"], button[aria-label="New"], div[aria-label="New"]').first();
      await newBtn.click({ timeout: 20000 });
      await page.waitForTimeout(1500);
      const [chooser] = await Promise.all([
        page.waitForEvent('filechooser', { timeout: 20000 }),
        page.locator('li[role="menuitem"]:has-text("File upload")').first().click({ timeout: 15000 }),
      ]);
      await chooser.setFiles(file);
      console.log('CHOSEN:', file);

      // Wait for the upload toast to report completion.
      const done = page.locator('text=/upload complete/i').first();
      await done.waitFor({ timeout: 300000 });
      console.log('UPLOAD COMPLETE:', file);
      // Dismiss/settle before next file.
      await page.waitForTimeout(2000);
      await page.keyboard.press('Escape');
    }
    await page.screenshot({ path: `${SHOT}/drive-after-upload.png` });
  } catch (e) {
    try { await page.screenshot({ path: `${SHOT}/drive-error.png` }); } catch {}
    console.error('FAILED:', e.message);
    process.exitCode = 1;
  } finally {
    await browser.close();
  }
})();
