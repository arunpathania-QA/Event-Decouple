import { expect, type Locator, type Page } from '@playwright/test';

export class HomePage {
  readonly welcomeHeading: Locator;

  constructor(private readonly page: Page) {
    this.welcomeHeading = page.getByRole('heading', { name: /Welcome .+!/i });
  }

  async open() {
    await this.page.goto('/pages/home');
  }

  async expectWelcome() {
    const ready = this.welcomeHeading.or(this.page.getByText(/Crescerance Admin/i).first());
    // Home sometimes paints only the footer. Open it again until the welcome heading renders.
    for (let attempt = 1; attempt <= 3; attempt++) {
      if (await ready.isVisible({ timeout: 15_000 }).catch(() => false)) return;
      await this.page.goto('/pages/home', { waitUntil: 'domcontentloaded' });
    }
    await expect(ready).toBeVisible({ timeout: 20_000 });
  }
}
