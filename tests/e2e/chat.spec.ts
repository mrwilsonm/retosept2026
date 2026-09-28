import { test, expect } from '@playwright/test';
test('chat muestra herramientas, exige fechas y confirma desde la tarjeta', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Registro de Contratos', exact: true })).toBeVisible();
  await page.getByRole('button', { name: /Procesar buzón/ }).click();
  await expect(page.getByRole('heading', { name: 'Confirma los datos de msg-006' })).toBeVisible();
  await page.getByRole('button', { name: 'Confirmar y registrar' }).click();
  await expect(page.getByRole('alert')).toContainText('Completa fecha inicio');
  await page.getByLabel(/^fecha inicio/).fill('2026-08-31');
  await page.getByLabel(/^fecha fin/).fill('2027-08-31');
  await page.screenshot({ path: 'test-results/revision-desktop.png', fullPage: true });
  await page.getByRole('button', { name: 'Confirmar y registrar' }).click();
  await expect(page.getByRole('heading', { name: 'Confirma los datos de msg-006' })).toHaveCount(0);
  await expect(page.getByText('Revisión aplicada a msg-006.', { exact: false })).toBeVisible();
  await page.getByRole('button', { name: /Ver último reporte/ }).click();
  await expect(page.locator('.report')).toContainText('Pólizas pendientes');
  await page.reload();
  await expect(page.getByText('Revisión aplicada a msg-006.', { exact: false })).toBeVisible();
  expect(errors).toEqual([]);
});
test('la interfaz se adapta a móvil sin desbordamiento horizontal', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/');
  await expect(page.getByRole('heading', { name: 'Registro de Contratos', exact: true })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  await page.screenshot({ path: 'test-results/inicio-mobile.png', fullPage: true });
});
