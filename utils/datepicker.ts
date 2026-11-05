import type { Locator, Page } from '@playwright/test';
import { pause } from './pause';

const MONTHS = [
  'January',
  'February',
  'March',
  'April',
  'May',
  'June',
  'July',
  'August',
  'September',
  'October',
  'November',
  'December',
];

/** Select a calendar day in the open ngx-bootstrap datepicker. */
export async function pickDate(page: Page, target: Date) {
  const calendar = page.locator('.bs-datepicker').filter({ visible: true }).last();
  await calendar.waitFor({ state: 'visible', timeout: 10_000 });
  await showCalendarMonth(calendar, target);

  const day = String(target.getDate());
  await calendar
    .locator('td span:not(.is-other-month)')
    .filter({ hasText: new RegExp(`^${day}$`) })
    .first()
    .evaluate((el: HTMLElement) => el.click());
}

/** button.next can report a click without changing the month, so walk until the header matches. */
async function showCalendarMonth(calendar: Locator, target: Date) {
  for (let i = 0; i < 18; i++) {
    const shown = await calendar.evaluate((el) => {
      const buttons = Array.from(el.querySelectorAll('button.current')).map((b) => (b.textContent || '').trim());
      const head = ((el.querySelector('.bs-datepicker-head') as HTMLElement | null)?.innerText || '').replace(
        /\s+/g,
        ' ',
      );
      return { buttons, head: head.trim() };
    });

    let monthName = '';
    let year = NaN;
    for (const text of shown.buttons) {
      if (/^\d{4}$/.test(text)) year = Number(text);
      else if (/[A-Za-z]/.test(text)) monthName = text;
    }
    if (!monthName || Number.isNaN(year)) {
      const match = shown.head.match(/([A-Za-z]+)\s+(\d{4})/);
      if (match) {
        monthName = match[1];
        year = Number(match[2]);
      }
    }

    const shownMonth = MONTHS.findIndex((name) => name.toLowerCase() === monthName.toLowerCase());
    if (shownMonth < 0 || Number.isNaN(year)) {
      break;
    }
    const diff = (target.getFullYear() - year) * 12 + (target.getMonth() - shownMonth);
    if (diff === 0) return;

    const button = calendar.locator(diff > 0 ? 'button.next' : 'button.previous').first();
    await button.evaluate((el: HTMLElement) => el.click());
    await pause(80);
  }

  throw new Error(
    `Calendar did not reach ${MONTHS[target.getMonth()]} ${target.getFullYear()}`,
  );
}
