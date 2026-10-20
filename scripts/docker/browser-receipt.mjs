import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';
import { PDFDocument } from 'pdf-lib';

const baseURL = process.argv[2];
const id = process.argv[3];
const output = resolve(process.argv[4] ?? 'test-results/docker-receipt');
assert.ok(/^http:\/\/localhost:\d+$/.test(baseURL ?? ''));
assert.ok(/^\d+$/.test(id ?? ''));
const browser = await chromium.launch({ channel: 'chrome', headless: false });
try {
  const context = await browser.newContext({ acceptDownloads: true, viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto(baseURL + '/auth/login');
  await page.getByLabel('Email:', { exact: true }).fill('user1@example.com');
  await page.getByLabel('Password:', { exact: true }).fill('password1');
  await page.getByRole('button', { name: 'Login', exact: true }).click();
  await page.waitForURL(url => !url.pathname.startsWith('/auth/login'));
  await page.goto(baseURL + '/checkout?itineraryId=' + id);
  const confirm = page.getByRole('button', { name: 'Confirm Demo Booking', exact: true });
  if (await confirm.isVisible()) {
    await confirm.click();
    await page.getByRole('button', { name: 'Demo booking confirmed', exact: true }).waitFor();
  }
  const responsePromise = page.waitForResponse(response => response.url().includes('/api/invoice?'));
  const downloadPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Download demo receipt PDF', exact: true }).click();
  const [response, download] = await Promise.all([responsePromise, downloadPromise]);
  assert.equal(response.status(), 200);
  const headers = await response.allHeaders();
  assert.match(headers['content-type'], /^application\/pdf/);
  assert.match(headers['content-disposition'], /attachment;.*filename=/);
  assert.equal(download.suggestedFilename(), `invoice_${id}.pdf`);
  assert.equal(await download.failure(), null);
  const path = output + '.pdf';
  await download.saveAs(path);
  const bytes = readFileSync(path);
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  const pages = (await PDFDocument.load(bytes)).getPageCount();
  assert.equal(pages, 2);
  await page.getByRole('button', { name: 'Download demo receipt PDF', exact: true }).waitFor();
  assert.ok(!(await page.locator('body').innerText()).includes('Received non-PDF response'));
  assert.deepEqual(errors, []);
  await page.screenshot({ path: output + '.png', fullPage: true });
  const evidence = { browser: await browser.version(), profile: 'isolated Chrome without extensions', status: response.status(), contentType: headers['content-type'], contentDisposition: headers['content-disposition'], filename: download.suggestedFilename(), bytes: bytes.length, pages, pageErrors: errors, result: 'PASS' };
  writeFileSync(output + '.json', JSON.stringify(evidence, null, 2));
  console.log(JSON.stringify(evidence));
} finally { await browser.close(); }
