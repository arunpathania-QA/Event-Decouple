import { expect, type Page } from '@playwright/test';
import { addDays, formatUsDate } from '../utils/date';
import { pause } from '../utils/pause';
import { pickDate } from '../utils/datepicker';

export class EventDetailsPage {
  constructor(private readonly page: Page) {}

  /**
   * Class detail "Edit" is often a styled control (icon + label), not role=button "Edit".
   * A11y tree may expose "Edit Register" as one text blob ? match Edit, exclude Register.
   */
  private classEditControl() {
    return this.page
      .locator('button, a, [role="button"], .btn')
      .filter({ hasText: /^Edit$/i })
      .or(
        this.page
          .locator('button, a, [role="button"], .btn')
          .filter({ hasText: /Edit/i })
          .filter({ hasNotText: /Register|Save|Cancel|Previous/i }),
      )
      .or(this.page.getByText('Edit', { exact: true }))
      .or(this.page.locator('text=Edit'))
      .first();
  }

  /** Enter class edit mode ? perf UI uses a styled Edit control; try several click strategies. */
  private async enterClassEditMode(className?: string) {
    const loading = this.page.getByText('Loading...', { exact: true });
    const save = this.page
      .getByText('Save', { exact: true })
      .or(this.page.getByRole('button', { name: /^Save$/i }))
      .first();

    const candidates = [
      this.page.locator('button.btn-primary, a.btn-primary, .btn.btn-primary').filter({ hasText: /Edit/i }).first(),
      this.page.locator('xpath=//button[contains(.,"Edit") and not(contains(.,"Register"))]').first(),
      this.page.locator('xpath=//a[contains(.,"Edit") and not(contains(.,"Register"))]').first(),
      this.page.getByText('Edit', { exact: true }).first(),
      this.classEditControl(),
    ];

    for (let round = 1; round <= 3; round++) {
      if (await loading.isVisible().catch(() => false)) {
        await this.waitForClassDetailReady(className);
      }

      await expect(this.classEditControl()).toBeVisible({ timeout: 45_000 });

      for (const candidate of candidates) {
        if (!(await candidate.isVisible().catch(() => false))) {
          continue;
        }
        const box = await candidate.boundingBox();
        if (box) {
          await this.page.mouse.click(box.x + Math.min(24, box.width / 2), box.y + box.height / 2);
        } else {
          await candidate.evaluate((el: HTMLElement) => el.click());
        }
        if (await save.isVisible({ timeout: 5_000 }).catch(() => false)) {
          return;
        }
      }

      // Last resort: open Registration & Pricing (edit fields sometimes live there).
      const pricingTab = this.page.getByRole('link', { name: /Registration & Pricing/i });
      if (await pricingTab.isVisible().catch(() => false)) {
        await pricingTab.click();
        await pause(1_000);
        for (const candidate of candidates) {
          if (!(await candidate.isVisible().catch(() => false))) continue;
          await candidate.evaluate((el: HTMLElement) => el.click());
          if (await save.isVisible({ timeout: 5_000 }).catch(() => false)) {
            return;
          }
        }
      }

      if (className && round < 3) {
        await this.openClassFromClassesList(className);
        await this.waitForClassDetailReady(className);
      }
    }

    await expect(save).toBeVisible({ timeout: 15_000 });
  }

  /** Perf/support tenants often leave Class Detail on Loading ? wait, reload, then recover via Classes list. */
  private async waitForClassDetailReady(className?: string) {
    const loading = this.page.getByText('Loading...', { exact: true });
    const ready = this.page
      .getByText(/This class requires registration|Registration Not Setup|Pricing & Registration Details/i)
      .or(
        this.page
          .locator('button, a, [role="button"], .btn')
          .filter({ hasText: /^Edit$/i }),
      )
      .first();

    for (let attempt = 1; attempt <= 4; attempt++) {
      await this.page
        .waitForResponse(
          (r) =>
            /\/(api|pages).*class/i.test(r.url()) &&
            r.request().method() === 'GET' &&
            r.status() < 500,
          { timeout: 45_000 },
        )
        .catch(() => undefined);

      await loading.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
      // Require Loading gone AND ready content ? avoid racing a brief spinner flash.
      if (
        !(await loading.isVisible().catch(() => false)) &&
        (await ready.isVisible({ timeout: 10_000 }).catch(() => false))
      ) {
        await pause(500);
        if (
          !(await loading.isVisible().catch(() => false)) &&
          (await ready.isVisible().catch(() => false))
        ) {
          return;
        }
      }

      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await pause(2_000);
    }

    if (className) {
      await this.openClassFromClassesList(className);
      await loading.waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
      await expect(ready).toBeVisible({ timeout: 60_000 });
      await expect(loading).toBeHidden({ timeout: 5_000 }).catch(() => undefined);
    } else {
      await expect(ready).toBeVisible({ timeout: 30_000 });
    }
  }

  /** Open class from Accreditation Classes list when direct detail URL hangs. */
  private async openClassFromClassesList(className: string) {
    await this.page.goto('/pages/classes', { waitUntil: 'domcontentloaded' });
    const search = this.page
      .getByRole('textbox', { name: /search/i })
      .or(this.page.locator('input[placeholder*="Search" i]'))
      .first();
    if (await search.isVisible({ timeout: 15_000 }).catch(() => false)) {
      await search.fill(className);
      await search.press('Enter').catch(() => undefined);
      await pause(2_000);
    }

    const link = this.page
      .getByRole('link', { name: className, exact: true })
      .or(this.page.getByRole('link', { name: className }))
      .first();
    await expect(link).toBeVisible({ timeout: 30_000 });
    const href = await link.getAttribute('href');
    if (href) {
      await this.page.goto(href, { waitUntil: 'domcontentloaded' });
    } else {
      await link.click({ force: true });
    }
    await expect(this.page).toHaveURL(/\/pages\/classes\//i, { timeout: 30_000 });
  }

  async openEdit() {
    const edit = this.page
      .getByRole('button', { name: /^Edit$/i })
      .or(this.page.getByRole('link', { name: 'Edit' }))
      .or(this.page.getByText('Edit', { exact: true }))
      .first();
    await expect(edit).toBeVisible({ timeout: 20_000 });
    await edit.click({ force: true }).catch(async () => {
      await edit.evaluate((el: HTMLElement) => el.click());
    });
    await expect(
      this.page.getByText('Save', { exact: true }).or(this.page.getByRole('button', { name: /^Save$/i })).first(),
    ).toBeVisible({ timeout: 20_000 });
  }

  async saveEdit() {
    const save = this.page.getByText('Save', { exact: true }).first();
    await expect(save).toBeVisible({ timeout: 15_000 });
    await save.evaluate((el: HTMLElement) => el.click());
  }

  /**
   * Recording after Save & Continue:
   * Registration Not Setup -> Edit -> small toggle -> end date next month day 10 ->
   * registrant count -> Capacity is based on ALL -> Save -> Register.
   */
  async configureRegistration(options: {
    registrantCount: string;
    registrationEndDate: Date;
  }) {
    await expect(this.page.getByText('Registration Not Setup')).toBeVisible({ timeout: 20_000 });
    await this.page.getByText('Edit', { exact: true }).click();

    await this.page.locator('small').first().click();

    const endDate = this.page.locator('input[name="endDate"]');
    await endDate.click();
    await pickDate(this.page, options.registrationEndDate);

    const count = this.page.getByRole('spinbutton', { name: '0' }).nth(1);
    await count.click();
    await count.fill(options.registrantCount);
    await expect(this.page.getByText('Capacity is based on ALL')).toBeVisible();
    await this.page.getByText('Save', { exact: true }).click();
    const notSetup = this.page.getByText('Registration Not Setup');
    const cleared = await notSetup.waitFor({ state: 'hidden', timeout: 20_000 }).then(() => true).catch(() => false);
    if (!cleared && (await this.page.getByText('Save', { exact: true }).isVisible().catch(() => false))) {
      await this.page.getByText('Save', { exact: true }).click();
      await notSetup.waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => undefined);
    }
    await expect(this.page.getByText('Register')).toBeVisible({ timeout: 20_000 });
  }

  async expectRegistrationEnabled() {
    await this.page.locator('sd-event-details-tabset').getByText('General', { exact: true }).click().catch(() => undefined);
    await expect(
      this.page.getByText(/This event requires Registration|requires Registration/i).first(),
    ).toBeVisible({ timeout: 20_000 });
  }

  async enableAddClassForEvent() {
    await this.page.locator('sd-event-details-tabset').getByText('General', { exact: true }).click();

    const edit = this.page
      .getByRole('link', { name: 'Edit' })
      .or(this.page.getByText('Edit', { exact: true }))
      .first();
    if (await edit.isVisible().catch(() => false)) {
      await edit.evaluate((el: HTMLElement) => el.click());
    }

    const labeledToggle = this.page
      .locator('text=/Add Class/i')
      .locator('xpath=ancestor::div[contains(@class,"col") or contains(@class,"form")][1]')
      .locator('.switchery')
      .first();
    if (await labeledToggle.count()) {
      await labeledToggle.evaluate((el: HTMLElement) => el.click());
    } else {
      await this.page
        .locator('.col-sm-12 > .single-tracking-tag-check > .checkbox-inline > .switchery')
        .first()
        .evaluate((el: HTMLElement) => el.click())
        .catch(async () => {
          await this.page.locator('.switchery').first().evaluate((el: HTMLElement) => el.click());
        });
    }

    await this.saveEdit();
    await expect(
      this.page.locator('sd-event-details-tabset').getByText('Classes', { exact: true }),
    ).toBeVisible({ timeout: 20_000 });
  }

  /**
   * Recording: Sessions -> Add Session -> name -> datepicker day 2 ->
   * the ": AM" cell combobox to PM -> overlay Save -> Session type -> price 10 -> Save.
   */
  async addSession(name: string, price = '10', sessionDate?: Date) {
    await this.page.getByText('Sessions').first().click();
    await expect(this.page.getByTitle('Sessions')).toBeVisible();
    const addSession = this.page.getByRole('button', { name: 'Add Session' });
    await addSession.scrollIntoViewIfNeeded();
    await addSession.evaluate((el: HTMLElement) => el.click());

    const nameBox = this.page.getByRole('textbox', { name: 'Enter Name' });
    await expect(nameBox).toBeVisible({ timeout: 15_000 });
    await nameBox.fill(name);

    const dateToggle = this.page.locator('.dropdown-toggle.hide-dropdown').first();
    await dateToggle.click().catch(async () => {
      await dateToggle.evaluate((el: HTMLElement) => el.click());
    });
    const overlay = this.page.locator('.cdk-overlay-pane').last();
    await overlay.getByRole('textbox', { name: 'Datepicker' }).click();
    const calendar = this.page.locator('.bs-datepicker').filter({ visible: true }).last();
    await expect(calendar).toBeVisible({ timeout: 10_000 });
    const sessionDay = sessionDate ?? new Date(new Date().getFullYear(), new Date().getMonth(), 2);
    await this.showCalendarMonth(calendar, sessionDay);
    await calendar
      .locator('td:not(.is-other-month) span')
      .getByText(String(sessionDay.getDate()), { exact: true })
      .first()
      .click();
    await this.page
      .getByRole('cell', { name: ': AM', exact: true })
      .first()
      .getByRole('combobox')
      .selectOption('PM');
    await overlay.getByRole('button', { name: 'Save' }).click();
    await expect(overlay.getByRole('button', { name: 'Save' })).toBeHidden({ timeout: 10_000 }).catch(
      () => undefined,
    );

    const sessionTypeSelect = this.page
      .locator('text=Session Type')
      .locator('..')
      .getByText('Select', { exact: true })
      .first();
    await sessionTypeSelect.scrollIntoViewIfNeeded().catch(() => undefined);
    const opened = await sessionTypeSelect.click({ timeout: 8_000 }).then(() => true).catch(() => false);
    if (!opened) {
      await sessionTypeSelect.evaluate((el: HTMLElement) => {
        ((el.closest('.dropdown') as HTMLElement | null) || el).click();
      });
    }
    const sessionOption = this.page.locator('.dropdown-menu').getByText('Session', { exact: true }).last();
    await expect(sessionOption).toBeVisible({ timeout: 10_000 });
    await sessionOption.click();
    const priceInput = this.page.locator('sd-event-activity-inline').getByRole('spinbutton').first();
    await priceInput.click();
    await priceInput.fill(price);
    const inlineSave = this.page.locator('sd-event-activity-inline').getByRole('button', { name: 'Save' });
    await inlineSave.click();
    const savedDialog = this.page.getByRole('alertdialog', { name: 'Yay! Event Session has been' });
    const savedRow = this.page.getByText(name, { exact: true }).first();
    const saved = await savedDialog
      .or(savedRow)
      .first()
      .waitFor({ state: 'visible', timeout: 40_000 })
      .then(() => true)
      .catch(() => false);
    if (!saved && (await inlineSave.isVisible().catch(() => false))) {
      await inlineSave.click();
    }
    await expect(savedRow).toBeVisible({ timeout: 90_000 });
    console.log('[Session schedule]', formatUsDate(sessionDay), 'day 2, AM cell set to PM');
  }

  /** Single-day is the schedule the registration wizard can select. On-demand is a different form. */
  private async ensureSingleDayClass(className: string) {
    const radio = this.page.getByRole('radio', { name: 'Single-day Class' });
    await expect(radio).toBeVisible({ timeout: 15_000 });
    if (await radio.isChecked().catch(() => false)) return;

    await this.page.getByText('Single-day Class', { exact: true }).click({ force: true });
    await this.confirmClassScheduleChange();
    if (!(await radio.isChecked().catch(() => false))) {
      await radio.evaluate((el: HTMLElement) => el.click());
      await this.confirmClassScheduleChange();
    }
    await expect(radio).toBeChecked({ timeout: 10_000 });

    const classNameBox = this.page.getByRole('textbox', { name: 'Enter Class Name' });
    if ((await classNameBox.inputValue().catch(() => '')) !== className) {
      await classNameBox.fill(className, { force: true });
    }
  }

  private async confirmClassScheduleChange() {
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Change Class Schedule' });
    const appeared = await dialog.waitFor({ state: 'visible', timeout: 2_000 }).then(() => true).catch(() => false);
    if (!appeared) return;
    await dialog.getByRole('button', { name: 'Continue' }).click();
    await expect(dialog).toBeHidden({ timeout: 10_000 });
  }

  /**
   * Pick the class day and end the class two minutes after its start.
   * A 1 AM?11 PM class blocks that whole day for this participant.
   */
  private async pickClassScheduleDate(classDay: Date) {
    const dateInput = this.page.getByRole('textbox', { name: 'Datepicker' }).last();
    await expect(dateInput).toBeVisible({ timeout: 15_000 });
    const wanted = formatUsDate(classDay);

    for (let attempt = 0; attempt < 3; attempt++) {
      if ((await dateInput.inputValue().catch(() => '')) === wanted) break;
      await this.confirmClassScheduleChange();
      await dateInput.scrollIntoViewIfNeeded();
      await dateInput.click({ timeout: 8_000 }).catch(async () => {
        await dateInput.click({ force: true });
      });
      await this.confirmClassScheduleChange();
      if (!(await this.page.locator('.bs-datepicker').filter({ visible: true }).count())) {
        await dateInput.scrollIntoViewIfNeeded();
        await dateInput.click({ force: true });
        await this.confirmClassScheduleChange();
      }
      await pickDate(this.page, classDay);
      await pause(300);
      if (await this.page.locator('.bs-datepicker').filter({ visible: true }).count()) {
        await this.page.keyboard.press('Escape');
      }
    }
    await expect(dateInput).toHaveValue(wanted, { timeout: 5_000 });

    const spins = this.page.getByRole('spinbutton');
    const startHour = Number((await spins.nth(0).inputValue().catch(() => '1')) || '1');
    const startMinute = Number((await spins.nth(1).inputValue().catch(() => '0')) || '0');
    let endHour = startHour;
    let endMinute = startMinute + 2;
    if (endMinute >= 60) {
      endMinute -= 60;
      endHour = startHour >= 11 ? 11 : startHour + 1;
    }
    const endHourBox = spins.nth(2);
    await endHourBox.fill(String(endHour));
    await spins.nth(3).fill(String(endMinute).padStart(2, '0'));
    await this.page.getByRole('combobox').nth(0).selectOption('AM').catch(() => undefined);
    await this.page.getByRole('combobox').nth(1).selectOption('AM').catch(() => undefined);
    await endHourBox.press('Tab');
    console.log(
      '[Class create date]',
      await dateInput.inputValue().catch(() => ''),
      `start ${startHour}:${String(startMinute).padStart(2, '0')} AM end ${endHour}:${String(endMinute).padStart(2, '0')} AM`,
    );
  }

  /** Move a visible ngx-bootstrap calendar to the target month. Next/prev can sit outside the viewport. */
  private async showCalendarMonth(calendar: ReturnType<Page['locator']>, target: Date) {
    const months = [
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

      const shownMonth = months.findIndex((name) => name.toLowerCase() === monthName.toLowerCase());
      if (shownMonth < 0 || Number.isNaN(year)) {
        console.log('[Calendar] unparsed', shown);
        break;
      }
      const diff = (target.getFullYear() - year) * 12 + (target.getMonth() - shownMonth);
      if (diff === 0) return;
      const button = calendar.locator(diff > 0 ? 'button.next' : 'button.previous').first();
      await button.evaluate((el: HTMLElement) => el.click());
      await pause(80);
    }
  }

  async addClass(options: {
    courseName: string;
    classTypeName: string;
    className: string;
    scheduleDate?: Date;
  }) {
    await this.page.locator('sd-event-details-tabset').getByText('Classes', { exact: true }).click();
    await expect(this.page.locator('h3').filter({ hasText: 'Event Class List' })).toBeVisible({
      timeout: 15_000,
    });
    await expect(this.page.getByText(/Add Class/i).first()).toBeVisible({ timeout: 15_000 });

    await this.page.getByText(/Add Class/i).first().evaluate((el: HTMLElement) => el.click());
    await this.page.getByText('Add New Class').click();

    // Course. The list can open as "No data found" while courses are still loading.
    await this.selectOverlayOption(options.courseName, async () => {
      await this.page
        .locator('#courseName')
        .filter({ hasText: /^Select\s*$/ })
        .evaluate((el: HTMLElement) => el.click());
    });
    await expect(this.page.locator('#courseName').filter({ hasText: /^Select\s*$/ })).toHaveCount(0, {
      timeout: 10_000,
    });

    // Class Type — must resolve before Save is enabled
    await this.selectOverlayOption(options.classTypeName, async () => {
      await this.page
        .locator('#courseName')
        .filter({ hasText: /Select a Class Type/i })
        .evaluate((el: HTMLElement) => el.click());
    });
    await expect(this.page.getByText(/Select a Class Type/i)).toHaveCount(0, { timeout: 10_000 });

    await this.page.locator('.cdk-overlay-backdrop').click({ force: true }).catch(() => undefined);
    await this.closeOverlay();

    const classNameBox = this.page.getByRole('textbox', { name: 'Enter Class Name' });
    await classNameBox.fill(options.className, { force: true });

    // The form sometimes opens as On-demand. Its end-date click raises "Change Class Schedule"
    // and never sets the single-day date the registration wizard lists.
    await this.ensureSingleDayClass(options.className);
    await this.pickClassScheduleDate(options.scheduleDate ?? addDays(new Date(), 20));

    await this.page
      .addStyleTag({
        content: '#hubspot-messages-iframe-container{display:none!important;pointer-events:none!important}',
      })
      .catch(() => undefined);

    if (await this.page.locator('.bs-datepicker').filter({ visible: true }).count()) {
      await this.page.keyboard.press('Escape').catch(() => undefined);
    }
    const save = this.page.getByRole('button', { name: /^Save$/ }).last();
    await save.scrollIntoViewIfNeeded();
    await expect(save).toBeEnabled({ timeout: 15_000 });
    await this.page.getByRole('textbox', { name: 'Enter Class Name' }).press('Tab').catch(() => undefined);
    await save.click({ force: true });

    const created = this.page
      .getByRole('link', { name: options.className })
      .or(this.page.getByText(options.className, { exact: true }));
    const appeared = await created
      .waitFor({ state: 'visible', timeout: 20_000 })
      .then(() => true)
      .catch(() => false);
    if (!appeared && (await save.isEnabled().catch(() => false))) {
      await save.click({ force: true });
    }
    await expect(created).toBeVisible({ timeout: 90_000 });
  }

  /**
   * After class is created: open class -> Edit -> require registration,
   * Registration End = tomorrow (<=1 day window), capacity/price -> Save.
   */
  async setupClass(options: {
    className: string;
    capacity?: string;
    price?: string;
    scheduleDate?: Date;
    registrationStartDate?: Date;
    registrationEndDate?: Date;
  }) {
    const capacity = options.capacity ?? '100';
    const price = options.price ?? '20';

    // Banner / table overlays can intercept normal clicks ? prefer href navigation, then force/evaluate.
    const classLink = this.page.getByRole('link', { name: options.className });
    await expect(classLink).toBeVisible({ timeout: 20_000 });
    const href = await classLink.getAttribute('href');
    if (href) {
      await this.page.goto(href, { waitUntil: 'domcontentloaded' });
    } else {
      await classLink.click({ force: true }).catch(async () => {
        await classLink.evaluate((el: HTMLElement) => el.click());
      });
    }
    await expect(this.page).toHaveURL(/\/pages\/classes\//i, { timeout: 30_000 });
    await this.waitForClassDetailReady(options.className);

    if (!(await this.classEditControl().isVisible().catch(() => false))) {
      await this.openClassFromClassesList(options.className);
      await this.waitForClassDetailReady(options.className);
    }
    await this.enterClassEditMode(options.className);
    await expect(this.page.getByText(options.className, { exact: true }).first()).toBeVisible();

    const classDay = options.scheduleDate ?? addDays(new Date(), 20);
    const startDate = options.registrationStartDate ?? new Date(new Date().getFullYear(), new Date().getMonth() - 1, 31);
    const endDate = options.registrationEndDate ?? addDays(new Date(), 15);

    // Recording: slider, capacity 100, previous-month day 31 at hour 12, end day at hour 11 PM, price 20.
    const slider = this.page.locator('.slider').first();
    await slider.click({ force: true });
    await slider.check({ force: true }).catch(() => undefined);

    const limit = this.page.getByRole('spinbutton').nth(4);
    await limit.click();
    await limit.fill(capacity);

    const dateFields = this.page.getByRole('textbox', { name: 'MM/DD/YYYY' });
    await dateFields.first().click();
    const startCalendar = this.page.locator('.bs-datepicker').filter({ visible: true }).last();
    await expect(startCalendar).toBeVisible({ timeout: 10_000 });
    await this.showCalendarMonth(startCalendar, startDate);
    await startCalendar
      .locator('td:not(.is-other-month) span')
      .filter({ hasText: new RegExp(`^${startDate.getDate()}$`) })
      .first()
      .click();

    const startHour = this.page.getByRole('textbox').nth(3);
    await startHour.click();
    await startHour.fill('12');

    await dateFields.nth(1).click();
    const endCalendar = this.page.locator('.bs-datepicker').filter({ visible: true }).last();
    await expect(endCalendar).toBeVisible({ timeout: 10_000 });
    await this.showCalendarMonth(endCalendar, endDate);
    await endCalendar
      .locator('td:not(.is-other-month) span')
      .filter({ hasText: new RegExp(`^${endDate.getDate()}$`) })
      .first()
      .click();

    const endHour = this.page.locator('input[type="text"]').nth(5);
    await endHour.click();
    await endHour.fill('11');
    await this.page.getByRole('combobox').nth(3).selectOption('PM');

    const priceInput = this.page.getByRole('spinbutton').nth(5);
    await priceInput.click();
    await priceInput.fill(price);
    console.log('[Class registration]', {
      start: await dateFields.first().inputValue().catch(() => ''),
      end: await dateFields.nth(1).inputValue().catch(() => ''),
      price,
    });

    await this.page
      .addStyleTag({
        content:
          '#hubspot-messages-iframe-container{display:none!important;pointer-events:none!important}',
      })
      .catch(() => undefined);

    const save = this.page.getByText('Save', { exact: true });
    await expect(save).toBeEnabled({ timeout: 30_000 });
    await save.click();
    await this.confirmClassSaveDialogs();

    await expect(this.page.getByText('Edit', { exact: true })).toBeVisible({ timeout: 45_000 });
    await expect(this.page.getByText(/This class requires registration/i)).toBeVisible();
    const occurs = await this.page
      .getByText(/Occurs once on/i)
      .first()
      .innerText()
      .catch(() => '');
    console.log('[Class schedule]', occurs.replace(/\s+/g, ' '));
    await expect(this.page.getByText(/Registration Not Setup/i)).toHaveCount(0, {
      timeout: 15_000,
    });
    await expect(this.page.getByText(capacity, { exact: true })).toBeVisible({ timeout: 15_000 });

    const fmt = (d: Date) =>
      `${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}/${d.getFullYear()}`;
    console.log('[Class setup saved]', options.className, {
      capacity,
      price,
      registrationStart: fmt(startDate),
      registrationEnd: fmt(endDate),
      registrationStartTime: '12:00 AM',
      registrationEndTime: '11:00 PM',
      classSchedule: fmt(classDay),
    });
  }

  private async ensureScheduleEndAfterStart() {
    const spins = this.page.getByRole('spinbutton');
    const startMeridiem = this.page.locator('select.form-control').nth(0);
    const endMeridiem = this.page.locator('select.form-control').nth(1);

    // 8:00 AM is already used for this participant on earlier class dates. Shift the window by the clock
    // so a rerun does not land on the same date and time.
    const startHour = 1 + (new Date().getSeconds() % 8);
    const endHour = startHour + 2;
    await spins.nth(0).fill(String(startHour));
    await spins.nth(1).fill('00');
    await spins.nth(2).fill(String(endHour));
    await spins.nth(3).fill('00');
    console.log('[Class schedule time]', `${startHour}:00 AM - ${endHour}:00 PM`);

    await startMeridiem.evaluate((el: HTMLSelectElement) => {
      el.selectedIndex = 1; // AM
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await endMeridiem.evaluate((el: HTMLSelectElement) => {
      el.selectedIndex = 1; // AM
      el.dispatchEvent(new Event('change', { bubbles: true }));
    });

    await expect(this.page.getByText(/End time should be after start time/i)).toHaveCount(0, {
      timeout: 10_000,
    });
  }

  /** Set Class Schedule meeting date. Tries several control shapes used on support. */
  private async setClassScheduleDate(classDay: Date) {
    const target = formatUsDate(classDay);

    const candidates = [
      this.page.getByRole('textbox', { name: 'MM/DD/YYYY' }).first(),
      this.page.getByRole('textbox', { name: 'Datepicker' }).first(),
      this.page.locator('input[placeholder*="MM/DD" i]').first(),
      this.page.locator('input[bsdatepicker], input[ngbdatepicker]').first(),
      this.page
        .getByText(/Class Schedule/i)
        .locator(
          'xpath=ancestor::*[.//input][1]//input[not(@type="checkbox") and not(@type="radio") and not(@type="number")]',
        )
        .first(),
      this.page.getByRole('spinbutton').nth(0).locator('xpath=preceding::input[1]'),
    ];

    for (const scheduleDate of candidates) {
      if (!(await scheduleDate.isVisible().catch(() => false))) continue;

      await scheduleDate.click({ force: true }).catch(() => undefined);
      await pause(200);

      const calendarVisible = await this.page
        .locator('.bs-datepicker')
        .last()
        .isVisible()
        .catch(() => false);
      if (calendarVisible) {
        await pickDate(this.page, classDay).catch(() => undefined);
      } else {
        await scheduleDate.fill(target).catch(async () => {
          await scheduleDate.evaluate((el: HTMLInputElement, value: string) => {
            const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
            proto?.set?.call(el, value);
            el.dispatchEvent(new Event('input', { bubbles: true }));
            el.dispatchEvent(new Event('change', { bubbles: true }));
            el.dispatchEvent(new Event('blur', { bubbles: true }));
          }, target);
        });
        await scheduleDate.press('Tab').catch(() => undefined);
      }

      await this.page.keyboard.press('Escape').catch(() => undefined);
      await pause(300);
      console.log('[Class schedule date]', target);
      return;
    }

    const forced = await this.page.evaluate((value: string) => {
      const inputs = Array.from(document.querySelectorAll('input')) as HTMLInputElement[];
      for (const el of inputs) {
        const ph = (el.getAttribute('placeholder') || '').toLowerCase();
        const aria = (el.getAttribute('aria-label') || '').toLowerCase();
        const name = (el.getAttribute('name') || '').toLowerCase();
        if (
          ph.includes('mm/dd') ||
          aria.includes('date') ||
          name.includes('date') ||
          /^\d{1,2}\/\d{1,2}\/\d{4}$/.test(el.value || '')
        ) {
          const proto = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
          proto?.set?.call(el, value);
          el.dispatchEvent(new Event('input', { bubbles: true }));
          el.dispatchEvent(new Event('change', { bubbles: true }));
          el.dispatchEvent(new Event('blur', { bubbles: true }));
          return true;
        }
      }
      return false;
    }, target);

    console.log(
      forced
        ? `[Class schedule date] forced via evaluate ${target}`
        : '[Class schedule date] skipped ? no date field',
    );
  }


  /**
   * Dismiss post-Save confirmations (can appear several seconds after Save):
   * - room: "Yes, Continue"
   * - registration dates outside class dates: dialog "Registration Dates" -> "Yes"
   * Do not use locator.or().first() — it can stick on the missing branch.
   */
  private async confirmClassSaveDialogs() {
    for (let i = 0; i < 5; i++) {
      const yesContinue = this.page.getByRole('button', { name: 'Yes, Continue' });
      const yes = this.page.getByRole('button', { name: 'Yes', exact: true });
      const timeout = i === 0 ? 30_000 : 8_000;

      const which = await Promise.race([
        yesContinue.waitFor({ state: 'visible', timeout }).then(() => 'continue' as const),
        yes.waitFor({ state: 'visible', timeout }).then(() => 'yes' as const),
      ]).catch(() => null);

      if (!which) break;

      if (which === 'continue') {
        await yesContinue.click();
      } else {
        await yes.click();
      }
      await pause(1_000);
    }
  }


  /**
   * Recording: open the Select list and check the radio by its accessible name.
   * Do not type in "Type to filter..." ? filtering "sanity" returns "No data found"
   * even though the course radio is in the unfiltered list.
   */
  private async selectOverlayOption(name: string, open: () => Promise<void>) {
    // The course label is split ("Test Event" + "sanity" + "1 Credit"). The radio's
    // accessible name is still the full string, which is what the recording checks.
    const radio = this.page.getByRole('radio', { name, exact: true });
    for (let attempt = 1; attempt <= 4; attempt++) {
      await open();
      const visible = await radio
        .waitFor({ state: 'visible', timeout: 8_000 })
        .then(() => true)
        .catch(() => false);
      if (!visible) {
        console.log(`[Overlay option] ${name} not visible, pause and reopen ${attempt}/4`);
        await this.closeOverlay();
        await pause(2_000);
        continue;
      }
      // Recording checks this radio. A row click on the split label "Test Event" selects the
      // other course, and some inputs ignore a forced click until the list item is clicked.
      try {
        await radio.check({ force: true, timeout: 4_000 });
      } catch {
        await this.page.getByRole('listitem').filter({ has: radio }).click();
      }
      console.log('[Overlay option]', name);
      await pause(400);
      await this.page.keyboard.press('Escape').catch(() => undefined);
      return;
    }
    await expect(radio).toBeVisible({ timeout: 5_000 });
  }

  private async closeOverlay() {
    for (let i = 0; i < 3; i++) {
      const backdrop = this.page.locator('.cdk-overlay-backdrop').last();
      if (!(await backdrop.isVisible().catch(() => false))) break;
      await backdrop.click({ force: true }).catch(() => undefined);
      await this.page.keyboard.press('Escape').catch(() => undefined);
      await pause(200);
    }
  }
}
