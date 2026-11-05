import { expect, type Page } from '@playwright/test';

/**
 * Step 3 – Confirm/Update User Information.
 * Review the participant already shown on the page, then let the caller click Next once.
 * This step must not open Edit, fill fields, or click Save.
 */
export async function settleConfirmUser(page: Page, participantMatch: string): Promise<void> {
  const stepHeading = page.getByRole('heading', { name: /Confirm\/Update User/i });
  const contactDetails = page.getByText(/Contact Details|Basic Information/i).first();
  await expect(stepHeading.or(contactDetails).first()).toBeVisible({ timeout: 30_000 });

  await page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);

  const person = new RegExp(participantMatch.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
  await expect(page.getByText(person).first()).toBeVisible({ timeout: 30_000 });
  await expect(page.locator('sd-email-type-renderer').getByText(/@/).first()).toBeVisible({ timeout: 45_000 });
  await expect(contactDetails).toBeVisible({ timeout: 15_000 });
  await page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);
}

/** Visible persona validation text. Read this when Next leaves the step for Home. */
export async function confirmValidationMessage(page: Page): Promise<string> {
  const nodes = page.locator(
    '.text-danger, .error-message, .toast-error, .alert-danger, .invalid-feedback, sd-email-type-renderer .ng-invalid, sd-phone-type-renderer .ng-invalid',
  );
  const messages: string[] = [];
  const count = Math.min(await nodes.count(), 8);
  for (let i = 0; i < count; i++) {
    const text = (await nodes.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
    if (text && !messages.includes(text)) messages.push(text.slice(0, 200));
  }
  return messages.join(' | ') || 'no validation message was visible';
}
