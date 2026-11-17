import { expect, type Page } from '@playwright/test';

export class EventTypesPage {
  constructor(private readonly page: Page) {}

  async exists(name: string): Promise<boolean> {
    const search = this.page.getByRole('textbox', { name: /search/i }).first();
    if (await search.waitFor({ state: 'visible', timeout: 8_000 }).then(() => true).catch(() => false)) {
      await search.fill(name);
    }

    return this.page
      .getByText(name, { exact: true })
      .first()
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
  }

  async addEventType(name: string) {
    await this.page.getByRole('button', { name: 'Add an Event Type' }).click();
    await this.page.getByRole('textbox', { name: 'Enter Name' }).fill(name);
    await this.page.getByRole('button', { name: 'Save' }).click();
    await expect(this.page.getByText(name, { exact: true })).toBeVisible({ timeout: 20_000 });
  }

  /** Create the event type only when it does not already exist. */
  async ensureEventType(name: string): Promise<'existing' | 'created'> {
    if (await this.exists(name)) {
      return 'existing';
    }
    await this.addEventType(name);
    return 'created';
  }
}
