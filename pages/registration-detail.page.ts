import { expect, type Page } from '@playwright/test';

export type RegistrationIdentity = {
  groupId: string;
  registrationId: string;
  registrationUuid: string;
  modificationCount: number;
};

const GROUP_ID = /\b[A-Z0-9]+(?:-[A-Z0-9]+)*-GR-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/;
const REGISTRATION_ID = /\b[A-Z0-9]+(?:-[A-Z0-9]+)*-RG-[A-Z0-9]+(?:-[A-Z0-9]+)*\b/;

/** Registration detail page: header carries the Group ID, the Registrant List carries the Registration ID. */
export class RegistrationDetailPage {
  constructor(private readonly page: Page) {}

  header() {
    return this.page.locator('sd-event-registration-detail-header');
  }

  registrantList() {
    // The All Registrations grid also has a Registration ID column; only this table has Search Registrant.
    return this.page
      .getByRole('table')
      .filter({ has: this.page.getByRole('textbox', { name: 'Search Registrant' }) })
      .filter({ has: this.page.getByRole('columnheader', { name: 'Registration ID', exact: true }) });
  }

  async expectComplete() {
    await expect(this.page).toHaveURL(/\/pages\/events\/registration-detail\/[0-9a-f-]+/i, { timeout: 30_000 });
    await expect(this.header()).toBeVisible({ timeout: 30_000 });
    await expect(this.page.getByText('Registration Status: Complete')).toBeVisible({ timeout: 45_000 });
  }

  async readIdentity(): Promise<RegistrationIdentity> {
    await this.expectComplete();

    const headerText = (await this.header().innerText()).replace(/\s+/g, ' ');
    const groupId = headerText.match(GROUP_ID)?.[0];
    if (!groupId) {
      throw new Error(`Group ID (-GR-) was not in the registration header: ${headerText}`);
    }

    const list = this.registrantList().first();
    await expect(list).toBeVisible({ timeout: 30_000 });
    await expect(list.getByRole('cell').filter({ hasText: /-RG-/ }).first()).toBeVisible({ timeout: 30_000 });
    const cells = await list.getByRole('cell').allInnerTexts();
    const registrationId = cells
      .map((cell) => cell.replace(/\s+/g, ''))
      .map((cell) => cell.match(REGISTRATION_ID)?.[0])
      .find(Boolean);
    const listText = cells.join(' | ');
    if (!registrationId) {
      throw new Error(`Registration ID (-RG-) was not in the Registrant List: ${listText}`);
    }

    const registrationUuid = this.page.url().match(/\/registration-detail\/([0-9a-f-]+)/i)?.[1];
    if (!registrationUuid) {
      throw new Error(`Registration UUID was not in the URL: ${this.page.url()}`);
    }

    const countMatch = headerText.match(/Modifications:\s*(\d+)/i);
    return {
      groupId,
      registrationId,
      registrationUuid,
      modificationCount: countMatch ? Number(countMatch[1]) : 0,
    };
  }
}
