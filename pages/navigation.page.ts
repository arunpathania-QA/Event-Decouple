import { expect, type Page } from '@playwright/test';

export class NavigationPage {
  constructor(private readonly page: Page) {}

  async openHome() {
    await this.page.goto('/pages/home');
  }

  async goToEventTypes() {
    await this.page.locator('a').filter({ hasText: 'Settings and Configuration' }).click();
    await this.page.locator('a').filter({ hasText: 'System Settings' }).click();
    await this.page.getByRole('link', { name: 'Manage Types' }).click();
    await this.page.locator('sd-managetype-header a').filter({ hasText: 'Accreditation' }).click();
    // The side menu also contains "Events". The category switcher is the open menuitem.
    await this.page.getByRole('menuitem', { name: 'Events', exact: true }).click();
    await this.page.getByRole('link', { name: 'Event Types' }).click();
  }

  async goToAllWorkflows() {
    const search = this.page.getByRole('textbox', { name: 'Search Workflows' });
    // This route sometimes paints only the footer. Open it again until the grid search is there.
    for (let attempt = 1; attempt <= 3; attempt++) {
      await this.page.goto('/pages/settings/workflow-all', { waitUntil: 'domcontentloaded' });
      const ready = await search.waitFor({ state: 'visible', timeout: 15_000 }).then(() => true).catch(() => false);
      if (ready) return;
      console.log(`[Workflows] page shell only, reload ${attempt}/3`);
    }
    await expect(search).toBeVisible({ timeout: 20_000 });
  }

  async goToAllEvents() {
    await this.page.goto('/pages/events/list');
  }
}
