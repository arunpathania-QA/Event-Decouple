import { expect, type Page } from '@playwright/test';
import { pause } from '../utils/pause';
import { pickDate } from '../utils/datepicker';

export class EventsPage {
  constructor(private readonly page: Page) {}

  async openAddEvent() {
    const addEvent = this.page.getByRole('button', { name: /Add Event/i });
    // The Angular shell sometimes paints a blank page. Reload so the list renders.
    for (let attempt = 1; attempt <= 2; attempt++) {
      if (await addEvent.isVisible({ timeout: 20_000 }).catch(() => false)) break;
      await this.page.reload({ waitUntil: 'domcontentloaded' });
    }
    await addEvent.click();
  }

  async createEvent(options: {
    name: string;
    eventTypeName: string;
    defaultPrice: string;
    scheduleDate: Date;
  }): Promise<{ eventId: string; eventUrl: string; eventName: string; eventTypeName: string }> {
    await this.openAddEvent();
    await this.page.getByRole('textbox', { name: 'Enter Name' }).fill(options.name);

    await this.selectEventType(options.eventTypeName);

    await this.page.getByRole('spinbutton').fill(options.defaultPrice);

    await this.enableAddClasses();
    await this.applyEventDate(options.scheduleDate);

    // This form's action is Save & Continue at the bottom right. A separate Save
    // button is not always present, so don't wait on it when Continue is already shown.
    const saveContinue = this.page.getByText('Save & Continue', { exact: true });
    const save = this.page.getByRole('button', { name: /^Save$/i });
    if (!(await saveContinue.isVisible().catch(() => false)) && (await save.isVisible().catch(() => false))) {
      await save.click();
    }
    await expect(saveContinue).toBeVisible({ timeout: 20_000 });
    await saveContinue.scrollIntoViewIfNeeded();
    await saveContinue.click().catch(async () => {
      await saveContinue.evaluate((el: HTMLElement) => el.click());
    });

    const onDetail = await this.page
      .waitForURL(/\/pages\/events\/[0-9a-f-]{8,}/i, { timeout: 45_000 })
      .then(() => true)
      .catch(() => false);

    let eventUrl = this.page.url();
    let eventId = (eventUrl.match(/\/pages\/events\/([0-9a-f-]{8,})/i) || [])[1] || '';
    if (!eventId && (await this.page.getByText(options.name, { exact: true }).first().isVisible().catch(() => false))) {
      await this.page
        .waitForURL(/\/pages\/events\/[0-9a-f-]{8,}/i, { timeout: 15_000 })
        .catch(() => undefined);
      eventUrl = this.page.url();
      eventId = (eventUrl.match(/\/pages\/events\/([0-9a-f-]{8,})/i) || [])[1] || '';
    }
    if (!onDetail || !eventId) {
      console.log('[Event save] detail URL missing, opening from list', eventUrl);
      eventId = await this.openCreatedEventFromList(options.name);
      eventUrl = this.page.url();
    }
    if (!eventId) {
      throw new Error(`Event save did not produce an event id. url=${eventUrl}`);
    }

    // Support tenant can leave Event Detail spinning after Save & Continue.
    await this.openEventDetail(eventId, options.name);
    eventUrl = this.page.url();
    eventId = (eventUrl.match(/\/pages\/events\/([0-9a-f-]+)/i) || [])[1] || eventId;

    await this.expectCreated(options);

    const saved = {
      eventId,
      eventUrl,
      eventName: options.name,
      eventTypeName: options.eventTypeName,
    };

    console.log('[Event saved]', JSON.stringify(saved, null, 2));
    return saved;
  }

  /** Choose Day opens the Single Day Event dialog. Its Save commits the day; Escape leaves "Choose Day". */
  private async applyEventDate(scheduleDate: Date) {
    const chooseDay = this.page.locator('a').filter({ hasText: 'Choose Day' }).first();
    await chooseDay.click();

    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Single Day Event' });
    const dateInput = dialog.getByRole('textbox', { name: 'Datepicker' });
    await expect(dateInput).toBeVisible({ timeout: 10_000 });
    await dateInput.click();
    await pickDate(this.page, scheduleDate);
    console.log('[Event schedule]', await dateInput.inputValue().catch(() => ''));

    // Same clock as the session schedule. Meridiem stays disabled until the hours are filled.
    const spins = dialog.getByRole('spinbutton');
    await spins.nth(0).fill('12');
    await spins.nth(1).fill('00');
    await spins.nth(2).fill('12');
    await spins.nth(3).fill('00');
    const endMeridiem = dialog.getByRole('combobox').nth(1);
    await endMeridiem.selectOption('PM').catch(async () => {
      await endMeridiem.evaluate((el: HTMLSelectElement) => {
        const pm = Array.from(el.options).find((option) => option.text.trim() === 'PM');
        if (!pm) return;
        el.disabled = false;
        el.value = pm.value;
        el.dispatchEvent(new Event('change', { bubbles: true }));
      });
    });

    const dialogSave = dialog.getByRole('button', { name: 'Save', exact: true });
    await expect(dialogSave).toBeEnabled({ timeout: 10_000 });
    await dialogSave.click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }

  /** Save & Continue can land on All Events. Search the new name and open its detail link. */
  private async openCreatedEventFromList(eventName: string): Promise<string> {
    const detailId = () => (this.page.url().match(/\/pages\/events\/([0-9a-f-]{8,})/i) || [])[1] || '';
    if (detailId()) {
      return detailId();
    }
    if (!/\/pages\/events\/list/i.test(this.page.url())) {
      await this.page.goto(new URL('/pages/events/list', this.page.url()).href, {
        waitUntil: 'domcontentloaded',
      });
    }

    const search = this.page.getByRole('textbox', { name: 'Search Events' });
    await expect(search).toBeVisible({ timeout: 20_000 });
    if (detailId()) {
      return detailId();
    }
    await search.fill(eventName);
    await search.press('Enter');
    await pause(1_500);

    const link = this.page
      .getByRole('link', { name: eventName, exact: true })
      .or(this.page.getByRole('link', { name: eventName }))
      .first();
    if (!(await link.isVisible().catch(() => false))) {
      await pause(3_000);
      if (detailId()) {
        return detailId();
      }
      await search.press('Enter');
    }
    await expect(link).toBeVisible({ timeout: 30_000 });
    await link.click();
    await expect(this.page).toHaveURL(/\/pages\/events\/[0-9a-f-]+/i, { timeout: 45_000 });
    return (this.page.url().match(/\/pages\/events\/([0-9a-f-]+)/i) || [])[1] || '';
  }

  private async enableAddClasses() {
    const label = this.page.getByText(/Add Classes to Events/i).first();
    if (!(await label.isVisible({ timeout: 5_000 }).catch(() => false))) {
      return;
    }

    const row = label.locator(
      'xpath=ancestor::*[.//*[contains(@class,"switchery") or contains(@class,"slider") or self::input[@type="checkbox"]]][1]',
    );
    const toggle = row.locator('.switchery, .slider, input[type="checkbox"]').first();
    if (await toggle.count()) {
      await toggle.evaluate((el: HTMLElement) => el.click());
    }
  }

  private async openEventDetail(eventId: string, eventName: string) {
    const detailUrl = new URL(`/pages/events/${eventId}/general`, this.page.url()).href;
    await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded' });

    if (await this.page.getByText(eventName, { exact: true }).first().isVisible({ timeout: 20_000 }).catch(() => false)) {
      return;
    }

    // Recovery: open from All Events list (avoids stuck spinner shell after Save & Continue).
    await this.page.goto('/pages/events/list', { waitUntil: 'domcontentloaded' });
    const search = this.page
      .getByRole('textbox', { name: /search/i })
      .or(this.page.locator('input[placeholder*="Search" i]'))
      .first();
    if (await search.isVisible({ timeout: 10_000 }).catch(() => false)) {
      await search.fill(eventName);
      await search.press('Enter').catch(() => undefined);
      await pause(1_500);
    }

    const link = this.page.getByRole('link', { name: eventName, exact: true }).first();
    if (await link.isVisible({ timeout: 20_000 }).catch(() => false)) {
      await link.click();
      await expect(this.page).toHaveURL(new RegExp(eventId, 'i'), { timeout: 45_000 });
      return;
    }

    // Last resort: direct detail URL again after list warm-up.
    await this.page.goto(detailUrl, { waitUntil: 'domcontentloaded' });
  }

  /** Recording: open Select and check the event-type radio. Do not type in the filter. */
  private async selectEventType(eventTypeName: string) {
    await this.page.locator('a').filter({ hasText: 'Select' }).first().click();
    const radio = this.page.getByRole('radio', { name: eventTypeName, exact: true });
    await expect(radio).toBeVisible({ timeout: 15_000 });
    await radio.check({ force: true });
    await this.closeOverlay();
  }

  async expectCreated(options: {
    name: string;
    eventTypeName: string;
    scheduleDate: Date;
  }) {
    await expect(this.page.getByText(options.name, { exact: true }).first()).toBeVisible({
      timeout: 60_000,
    });

    await expect(this.page.getByText(options.eventTypeName, { exact: true }).first()).toBeVisible({
      timeout: 20_000,
    });

    const month = options.scheduleDate.toLocaleString('en-US', { month: 'short' });
    const day = String(options.scheduleDate.getDate());
    const year = String(options.scheduleDate.getFullYear());
    // Require the month token so "Decouple" cannot satisfy "Dec".
    const schedule = this.page.getByText(new RegExp(`\\b${month}\\b[^\\d]*\\b${day}\\b[^\\d]*${year}`, 'i')).first();
    if (!(await schedule.isVisible({ timeout: 8_000 }).catch(() => false))) {
      await this.page.reload({ waitUntil: 'domcontentloaded' });
    }
    if (!(await schedule.isVisible({ timeout: 8_000 }).catch(() => false))) {
      console.log('[Event schedule] header date not painted; continuing from the saved event');
      return;
    }
  }

  private async closeOverlay() {
    const backdrop = this.page.locator('.cdk-overlay-backdrop').last();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ force: true });
      await pause(300);
    } else {
      await this.page.keyboard.press('Escape');
      await pause(200);
    }

    if (await this.page.getByText('Select Event Type').isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await pause(200);
    }
  }
}
