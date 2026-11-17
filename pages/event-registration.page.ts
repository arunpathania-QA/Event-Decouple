import { expect, type Page } from '@playwright/test';
import { confirmValidationMessage, settleConfirmUser } from '../utils/confirm-user';
import { pause } from '../utils/pause';

/**
 * Event detail → Register button → multi-step registration wizard.
 * Session Unit Price is selected before the class Unit Price.
 * Supporting Documents is Next only.
 */
export type CompletedRegistration = {
  url: string;
  eventName: string;
  sessionName: string;
  className: string;
  participantMatch: string;
};

export class EventRegistrationPage {
  /** Set when completeRegistration reaches Registration Status: Complete. */
  lastCompleted: CompletedRegistration | null = null;

  constructor(private readonly page: Page) {}

  async openRegisterFromEventDetail() {
    // Recording: getByText('Register').click() then Step 1 - Overview.
    // The header badge keeps Register disabled until class setup has propagated.
    const notSetup = this.page.getByText(/Registration Not Setup/i).first();
    const register = this.page.getByText('Register', { exact: true }).first();

    for (let attempt = 1; attempt <= 6; attempt++) {
      await expect(register).toBeVisible({ timeout: 20_000 });
      await pause(1_500);
      if (!(await notSetup.isVisible().catch(() => false))) {
        break;
      }
      console.log(`[Event Register not ready — reload ${attempt}/6]`, this.page.url());
      await this.page.reload({ waitUntil: 'domcontentloaded' });
      await pause(2_000);
    }
    await pause(1_000);
    if (await notSetup.isVisible().catch(() => false)) {
      throw new Error(
        'Event still shows "Registration Not Setup" after class setup. Confirm class require-registration, dates, capacity, and price were saved.',
      );
    }

    await register.click({ force: true });
    await expect(this.page.getByRole('heading', { name: 'Step 1 - Overview' })).toBeVisible({
      timeout: 30_000,
    });
  }

  async completeRegistration(options: {
    participantMatch: string;
    financeOrgName?: string;
    eventName?: string;
    eventUrl?: string;
    sessionName?: string;
    className?: string;
  }) {
    await this.openRegisterFromEventDetail();

    await this.clickNext();
    // The top Next on Overview can receive the click without leaving Step 1.
    const reachedParticipants = await this.page
      .getByRole('heading', { name: /Step \d+ - Choose Participants/i })
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (
      !reachedParticipants &&
      (await this.page.getByRole('heading', { name: 'Step 1 - Overview' }).isVisible().catch(() => false))
    ) {
      await this.page.getByRole('button', { name: /^Next$/ }).last().click({ force: true });
    }
    await this.expectStep(/Step \d+ - Choose Participants/i);
    await this.selectParticipant(options.participantMatch);
    await this.clickNext();
    await this.expectStep(/Step \d+ - Confirm\/Update User/i);
    const nextStep = /Step \d+ - (Select Sessions|Select Classes|Supporting Documents|Submit Registration)/i;
    for (let attempt = 0; attempt < 3; attempt++) {
      await settleConfirmUser(this.page, options.participantMatch);
      await this.clickNext();
      const advanced = await this.page
        .getByRole('heading', { name: nextStep })
        .first()
        .waitFor({ state: 'visible', timeout: 30_000 })
        .then(() => true)
        .catch(() => false);
      if (advanced) break;
      if (!/\/pages\/home/i.test(this.page.url())) continue;
      console.log('[Wizard] Confirm/Update User Next went Home, returning to the form');
      await this.page.goBack({ waitUntil: 'domcontentloaded' });
      await pause(2_000);
      if (attempt === 2) {
        const validation = await confirmValidationMessage(this.page);
        throw new Error(
          `Confirm/Update User Next sent the browser to Home. Participant profile was not edited. Validation: ${validation}`,
        );
      }
    }

    const heading = (name: RegExp) => this.page.getByRole('heading', { name });
    // Step 4 is still rendering right after Next. A one-shot isVisible() skips the session.
    await expect(
      heading(nextStep).first(),
    ).toBeVisible({ timeout: 45_000 });

    if (
      await heading(/Step \d+ - Select Sessions( and Activities)?/i)
        .isVisible()
        .catch(() => false)
    ) {
      console.log('[Wizard] selecting session Unit Price checkbox');
      await expect(heading(/Step \d+ - Select Sessions( and Activities)?/i)).toBeVisible({
        timeout: 45_000,
      });
      await this.selectAndVerifySessionOrClass('session');
      await pause(1_500);
      await this.page.getByRole('button', { name: 'Next' }).first().click({ force: true }).catch(async () => {
        await this.clickNext(true);
      });
      await pause(2_500);
      await expect(
        heading(/Step \d+ - (Select Classes|Supporting Documents|Submit Registration)/i),
      ).toBeVisible({ timeout: 45_000 });
    }

    if (await heading(/Step \d+ - Select Classes/i).isVisible().catch(() => false)) {
      console.log('[Wizard] selecting class Unit Price checkbox');
      await expect(heading(/Step \d+ - Select Classes/i)).toBeVisible({ timeout: 45_000 });
      await this.selectAndVerifySessionOrClass('class');
      await pause(1_500);
      await this.page.getByRole('button', { name: 'Next' }).first().click({ force: true }).catch(async () => {
        await this.clickNext(true);
      });
      await pause(2_500);
      await expect(heading(/Step \d+ - (Supporting Documents|Submit Registration)/i)).toBeVisible({
        timeout: 45_000,
      });
    }

    if (await heading(/Step \d+ - Supporting Documents/i).isVisible().catch(() => false)) {
      console.log('[Wizard] Supporting Documents — Next only');
      await pause(1_500);
      await this.page.getByRole('button', { name: 'Next' }).first().click({ force: true }).catch(async () => {
        await this.clickNext(true);
      });
      await pause(2_000);
      await expect(heading(/Step \d+ - Submit Registration/i)).toBeVisible({
        timeout: 45_000,
      });
    }

    const financeSearch = this.page.getByRole('textbox', { name: 'Search people or organizations' });
    const needsOrganization = await financeSearch
      .waitFor({ state: 'visible', timeout: 8_000 })
      .then(() => true)
      .catch(() => false);
    if (needsOrganization) {
      await this.selectFinanceOrganization(options.financeOrgName || 'ServiceBus Organization');
    } else {
      await expect(this.page.getByText(/^Organization$/).first()).toBeVisible({ timeout: 15_000 });
      console.log('[Finance] organization already selected');
    }
    await this.ensureBillingContactSelected();
    await this.dismissOpenOverlays();
    await this.acceptCertificationAgreement();

    await this.submitRegistration();

    await expect(this.page.getByText('Registration Status: Complete')).toBeVisible({
      timeout: 45_000,
    });

    const registrationUrl = this.page.url();
    const registrationId = registrationUrl.match(/\/registration-detail\/([0-9a-f-]+)/i)?.[1];
    console.log('[Registration id]', registrationId);
    console.log('[Registration complete]', registrationUrl);
    this.lastCompleted = {
      url: registrationUrl,
      eventName: options.eventName || '',
      sessionName: options.sessionName || '',
      className: options.className || '',
      participantMatch: options.participantMatch,
    };
    return registrationUrl;
  }

  private async selectParticipant(match: string) {
    const nameSearch = this.page.getByRole('textbox', { name: 'Search All People' });
    const emailSearch = this.page.getByRole('textbox', { name: 'Search Email' });
    await expect(nameSearch).toBeVisible({ timeout: 20_000 });

    await this.page
      .waitForResponse(
        (r) =>
          /person|people|participant|attendee|member/i.test(r.url()) &&
          r.request().method() !== 'OPTIONS' &&
          r.status() < 500,
        { timeout: 30_000 },
      )
      .catch(() => undefined);
    const escapedMatch = match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const listedPerson = this.page
      .locator('table')
      .getByRole('link', { name: new RegExp(escapedMatch, 'i') })
      .first();
    await expect
      .poll(
        async () => {
          const listed = await listedPerson.isVisible().catch(() => false);
          const links = await this.page.locator('table').getByRole('link').count();
          const empty = await this.page
            .getByRole('heading', { name: 'No attendees found' })
            .isVisible()
            .catch(() => false);
          return listed || links > 0 || empty;
        },
        { timeout: 30_000 },
      )
      .toBe(true)
      .catch(() => undefined);
    await pause(1_500);
    if (await this.checkFirstPersonRow(match)) {
      return;
    }

    const terms = [match, 'aaaman', 'Aaman', 'ParticipantAaman'].filter(
      (v, i, a) => !!v && a.indexOf(v) === i,
    );

    for (const term of terms) {
      const useEmail = /@/.test(term) || /^aaaman$/i.test(term);
      const box = useEmail && (await emailSearch.isVisible().catch(() => false)) ? emailSearch : nameSearch;

      await nameSearch.fill('');
      if (await emailSearch.isVisible().catch(() => false)) await emailSearch.fill('');
      await box.click();
      await pause(300);
      await box.pressSequentially(term, { delay: 40 });
      await box.press('Enter').catch(() => undefined);
      await pause(2_000);

      if (await this.checkFirstPersonRow(term)) {
        return;
      }
    }

    await nameSearch.fill('');
    if (await emailSearch.isVisible().catch(() => false)) await emailSearch.fill('');
    await nameSearch.press('Enter').catch(() => undefined);
    await pause(2_000);
    if (await this.checkFirstPersonRow(match)) {
      return;
    }

    await this.addPersonAndSelect(match);

    await expect(
      this.page.getByRole('button', { name: /View Selected Participant\(s\):\s*[1-9]/i }),
    ).toBeVisible({ timeout: 20_000 });
  }

  private async checkFirstPersonRow(match: string): Promise<boolean> {
    if (await this.page.getByRole('heading', { name: 'No attendees found' }).isVisible().catch(() => false)) {
      return false;
    }

    const escaped = match.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const link = this.page
      .locator('table')
      .getByRole('link', { name: new RegExp(escaped, 'i') })
      .first();
    const namedRow = this.page.getByRole('row', { name: new RegExp(escaped, 'i') }).filter({
      has: this.page.locator('td'),
    });
    const row = (await link.isVisible().catch(() => false))
      ? link.locator('xpath=ancestor::tr[1]')
      : namedRow.first();

    if (!(await row.isVisible().catch(() => false))) {
      return false;
    }

    // The people grid checkbox is a styled control. Click its cell; .check() does not toggle it.
    const selected = this.page.getByRole('button', { name: /View Selected Participant\(s\):\s*[1-9]/i });
    await row.locator('td').first().click({ force: true });
    if (await selected.isVisible({ timeout: 3_000 }).catch(() => false)) return true;

    const checkbox = row.getByRole('checkbox').first();
    if (await checkbox.count()) {
      await checkbox.evaluate((el: HTMLElement) => el.click());
    }
    return selected.isVisible({ timeout: 8_000 }).catch(() => false);
  }

  private async addPersonAndSelect(match: string) {
    const addPerson = this.page.getByText('Add Person', { exact: true });
    await expect(addPerson).toBeVisible({ timeout: 10_000 });
    await addPerson.click();

    const menuItem = this.page
      .getByRole('menuitem')
      .or(this.page.locator('.dropdown-menu a, .dropdown-menu button, .cdk-overlay-pane button, .cdk-overlay-pane a'))
      .filter({ hasText: /existing|person|people|member|add/i })
      .first();
    if (await menuItem.isVisible({ timeout: 5_000 }).catch(() => false)) {
      await menuItem.click();
    }

    const overlay = this.page.locator('.modal, .cdk-overlay-pane, .ui-dialog').last();
    const overlaySearch = overlay.getByRole('textbox').first();
    if (await overlaySearch.isVisible({ timeout: 8_000 }).catch(() => false)) {
      await overlaySearch.fill(match);
      await pause(1_000);
      const personOption = overlay
        .getByRole('row', { name: new RegExp(match, 'i') })
        .or(overlay.getByText(new RegExp(match, 'i')))
        .first();
      await personOption.click({ force: true });
      const addBtn = overlay.getByRole('button', { name: /add|select|save|ok/i }).first();
      if (await addBtn.isVisible().catch(() => false)) {
        await addBtn.click();
      }
    } else {
      throw new Error(
        `No eligible participants found for "${match}". Set PARTICIPANT_MATCH to a person who has the Admin Decouple Registration roles.`,
      );
    }
  }

  /**
   * Recording (Sessions / Classes):
   * session: uncheck_icon.nth(1)
   * class: Unit Price icon (disabled_check | check_icon | uncheck_icon)
   * then cart "Added to this Session|Class"
   */
  private async selectAndVerifySessionOrClass(kind: 'session' | 'class') {
    const searchName = kind === 'session' ? /Search sessions/i : /Search classes/i;
    await this.page
      .getByRole('textbox', { name: searchName })
      .first()
      .waitFor({ state: 'visible', timeout: 45_000 })
      .catch(() => undefined);
    await this.page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
    // The class grid can sit on a spinner after "Loading..." is gone. Re-enter the step if the price cell never renders.
    if (kind === 'class') {
      const classGrid = this.page
        .getByRole('cell', { name: /^(uncheck_icon|check_icon|disabled_check)\s*\$/i })
        .or(this.page.getByText('Added', { exact: true }))
        .first();
      for (let loadAttempt = 1; loadAttempt <= 3; loadAttempt += 1) {
        await this.page.locator('.loader').first().waitFor({ state: 'hidden', timeout: 20_000 }).catch(() => undefined);
        if (await classGrid.isVisible().catch(() => false)) break;
        console.log(`[Wizard] class list still loading, re-enter step ${loadAttempt}/3`);
        await this.page.getByRole('link', { name: 'Previous' }).first().click();
        await expect(this.page.getByRole('heading', { name: /Step \d+ - Select Sessions/i })).toBeVisible({
          timeout: 20_000,
        });
        await this.page.getByRole('button', { name: 'Next' }).first().click({ force: true });
        await expect(this.page.getByRole('heading', { name: /Step \d+ - Select Classes/i })).toBeVisible({
          timeout: 20_000,
        });
        await this.page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);
      }
      await expect(classGrid).toBeVisible({ timeout: 30_000 });
    }
    await pause(kind === 'class' ? 1_000 : 2_000);

    if (
      await this.page
        .getByText(/Registration Not Setup/i)
        .first()
        .isVisible()
        .catch(() => false)
    ) {
      throw new Error(`${kind} shows "Registration Not Setup".`);
    }

    const added = this.page.getByText('Added', { exact: true }).first();
    await expect(added).toBeVisible({ timeout: 30_000 });

    const unchecks = this.page.getByRole('img', { name: 'uncheck_icon', exact: true });
    const priceUncheck = this.page
      .getByRole('cell', { name: /^uncheck_icon\s*\$/i })
      .getByRole('img', { name: 'uncheck_icon', exact: true })
      .first();

    await this.closeParticipantCartIfOpen();

    for (let attempt = 1; attempt <= 6; attempt++) {
      if (attempt > 1 && (await this.peekAddedInCart(kind))) {
        console.log(`[Wizard] ${kind} already in cart`);
        break;
      }

      console.log(`[Wizard] ${kind} select attempt ${attempt}/6`);
      await pause(1_000);

      if (kind === 'session') {
        await expect(unchecks.first()).toBeVisible({ timeout: 45_000 });
        const count = await unchecks.count();
        const target = count > 1 ? unchecks.nth(1) : unchecks.first();
        console.log(`[Wizard] session click uncheck_icon nth(${count > 1 ? 1 : 0}) count=${count}`);
        await target.scrollIntoViewIfNeeded().catch(() => undefined);
        await target.click({ force: true }).catch(async () => {
          await target.evaluate((el: HTMLElement) => {
            ((el.closest('td') as HTMLElement | null) || el).click();
          });
        });
      } else {
        const disabledPrice = this.page
          .getByRole('cell', { name: /^disabled_check\s*\$/i })
          .first();
        if (await disabledPrice.isVisible().catch(() => false)) {
          throw new Error(
            'Class price is disabled because this participant is already registered for the same date/time.',
          );
        }
        const classPriceCell = this.page
          .getByRole('cell', { name: /^(uncheck_icon|check_icon)\s*\$/i })
          .first();
        const classPriceIcon = classPriceCell
          .getByRole('img', { name: /^(uncheck_icon|check_icon)$/ })
          .first();
        const classUncheck = priceUncheck.or(unchecks.first());

        if (await classUncheck.isVisible().catch(() => false)) {
          console.log('[Wizard] class click uncheck_icon');
          await classUncheck.scrollIntoViewIfNeeded().catch(() => undefined);
          await classUncheck.click({ force: true }).catch(async () => {
            await classUncheck.evaluate((el: HTMLElement) => {
              ((el.closest('td') as HTMLElement | null) || el).click();
            });
          });
        } else {
          console.log('[Wizard] class click Unit Price check_icon');
          await expect(classPriceIcon.or(classPriceCell).first()).toBeVisible({ timeout: 45_000 });
          await pause(800);
          if (await classPriceIcon.isVisible().catch(() => false)) {
            await classPriceIcon.scrollIntoViewIfNeeded().catch(() => undefined);
            await classPriceIcon.click({ force: true }).catch(async () => {
              await classPriceIcon.evaluate((el: HTMLElement) => {
                ((el.closest('td') as HTMLElement | null) || el).click();
              });
            });
          } else {
            await classPriceCell.scrollIntoViewIfNeeded().catch(() => undefined);
            await classPriceCell.click({ force: true }).catch(async () => {
              await classPriceCell.evaluate((el: HTMLElement) => el.click());
            });
          }
        }
      }

      await pause(2_500);

      if (await this.peekAddedInCart(kind)) {
        console.log(`[Wizard] ${kind} confirmed in cart after attempt ${attempt}`);
        break;
      }
    }

    await expect(added).toBeVisible({ timeout: 15_000 });
  }

  private cartButton() {
    return this.page
      .getByRole('button', { name: /1 Participant\(s\) Selected/i })
      .or(this.page.getByRole('button', { name: /Participant\(s\) Selected/i }))
      .first();
  }

  private addedInCartText(kind: 'session' | 'class') {
    return this.page
      .getByText(kind === 'session' ? /Added to this Session\s*\|\s*\$/i : /Added to this Class\s*\|\s*\$/i)
      .or(this.page.getByText(kind === 'session' ? /Added to this Session/i : /Added to this Class/i))
      .first();
  }

  private async closeParticipantCartIfOpen() {
    const panel = this.page.locator('sd-modify-registration-activity');
    if (await panel.isVisible().catch(() => false)) {
      await this.cartButton().click({ force: true }).catch(() => undefined);
      await pause(1_000);
    }
  }

  private async peekAddedInCart(kind: 'session' | 'class'): Promise<boolean> {
    const cartBtn = this.cartButton();
    if (!(await cartBtn.isVisible().catch(() => false))) return false;
    await cartBtn.click({ force: true });
    await pause(1_500);
    const ok = await this.addedInCartText(kind).isVisible().catch(() => false);
    await cartBtn.click({ force: true }).catch(() => undefined);
    await pause(800);
    return ok;
  }

  /** Step 7: Organizations tab, then the org link. Recording used ServiceBus Organization. */
  private async selectFinanceOrganization(orgName: string) {
    const search = this.page.getByRole('textbox', { name: 'Search people or organizations' });
    await expect(search).toBeVisible({ timeout: 15_000 });
    await search.scrollIntoViewIfNeeded();
    await pause(1_500);

    const orgTab = this.page.getByText(/Organizations\s*\(\s*\d+\s*Records?\s*\)/i).first();
    let resultsVisible = false;
    for (let attempt = 1; attempt <= 3; attempt++) {
      await search.click();
      await pause(400);
      await search.fill('');
      await pause(700);
      // Keystrokes, not a single fill: the typeahead stays on "Start typing..." after fill().
      await search.pressSequentially(orgName, { delay: 90 });
      await pause(2_500);
      resultsVisible = await orgTab.isVisible().catch(() => false);
      if (resultsVisible) break;
      console.log(`[Finance] organization results not visible, retry ${attempt}`);
      await pause(1_500);
    }

    await expect(orgTab).toBeVisible({ timeout: 20_000 });
    await pause(800);
    await orgTab.click();
    await pause(1_500);

    const escaped = orgName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const orgLink = this.page.locator('a').filter({ hasText: new RegExp(escaped, 'i') }).first();
    await expect(orgLink).toBeVisible({ timeout: 20_000 });
    await pause(500);
    await orgLink.click();
    await pause(1_500);

    await expect(
      this.page.getByText('Finance contact details will display after a person or organization is selected.'),
    ).toBeHidden({ timeout: 20_000 });
  }

  private async dismissOpenOverlays() {
    const filterOpen = this.page.getByPlaceholder(/Type to Filter/i);
    if (await filterOpen.isVisible().catch(() => false)) {
      await this.page.keyboard.press('Escape');
      await pause(400);
    }
    await this.page.keyboard.press('Escape').catch(() => undefined);
  }

  /** Certification row is Angular-styled. Click the host so ngModel updates and Register enables. */
  private async acceptCertificationAgreement() {
    await this.page.getByRole('button', { name: 'Register' }).last().scrollIntoViewIfNeeded().catch(() => undefined);
    const certifyText = this.page.getByText(/By clicking Register,\s*I/i);
    if (!(await certifyText.isVisible({ timeout: 8_000 }).catch(() => false))) {
      return;
    }

    const host = certifyText.locator('xpath=ancestor::*[.//input[@type="checkbox"]][1]');
    const agree = host.locator('input[type="checkbox"]').first();
    if (await agree.isChecked().catch(() => false)) {
      return;
    }

    await host.click({ force: true });
    await pause(400);
    if (!(await agree.isChecked().catch(() => false))) {
      await agree.evaluate((el: HTMLInputElement) => el.click());
      await pause(400);
    }
    await expect.poll(async () => agree.isChecked().catch(() => false), { timeout: 8_000 }).toBeTruthy();
  }

  private async ensureBillingContactSelected() {
    const billingLabel = this.page.getByText('Billing Contact:', { exact: true }).first();
    if (!(await billingLabel.isVisible({ timeout: 3_000 }).catch(() => false))) {
      return;
    }

    const filter = this.page.getByPlaceholder(/Type to Filter/i);
    const selectTrigger = this.page
      .locator('sd-multi-select-dropdown a, a.form-control')
      .filter({ hasText: /^\s*Select\s*$/ })
      .first();
    if (!(await filter.isVisible().catch(() => false))) {
      if (await selectTrigger.isVisible().catch(() => false)) {
        await selectTrigger.click({ force: true });
      } else {
        const trigger = billingLabel.locator('xpath=following::*[1]');
        await trigger.click({ force: true }).catch(async () => {
          await billingLabel.click({ force: true });
        });
      }
      await pause(500);
    }

    if (await filter.isVisible().catch(() => false)) {
      await filter.fill('Aaman');
      await pause(800);
    }

    const personRow = this.page
      .locator('li, tr, .dropdown-item, .cdk-overlay-pane div')
      .filter({ hasText: /Aaman/i })
      .filter({ has: this.page.locator('input[type="checkbox"]') })
      .first();
    const anyRow = this.page
      .locator('.cdk-overlay-pane, .dropdown-menu')
      .locator('li, tr, .dropdown-item, div')
      .filter({ has: this.page.locator('input[type="checkbox"]:not([disabled])') })
      .first();
    const row = (await personRow.isVisible({ timeout: 5_000 }).catch(() => false)) ? personRow : anyRow;
    if (await row.isVisible({ timeout: 5_000 }).catch(() => false)) {
      const box = row.locator('input[type="checkbox"]').first();
      if (!(await box.isChecked().catch(() => false))) {
        await box.check({ force: true }).catch(async () => row.click({ force: true }));
      }
    }

    await this.dismissOpenOverlays();
  }

  private async submitRegistration() {
    const registerSubmit = this.page.getByRole('button', { name: 'Register' }).last();
    await expect(registerSubmit).toBeEnabled({ timeout: 45_000 });

    const detail = /\/pages\/events\/registration-detail\//i;
    const submitting = this.page.getByText(/Submitting your Registration/i);

    await registerSubmit.click();
    await submitting.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    // approval-status keeps this dialog up until the server finishes, then redirects.
    await submitting.waitFor({ state: 'hidden', timeout: 180_000 }).catch(() => undefined);
    await expect(this.page).toHaveURL(detail, { timeout: 60_000 });
  }

  private async expectStep(name: RegExp | string) {
    // Heading only. The step list also contains "Confirm/Update User Information",
    // and matching that text clicks Next before the step is open.
    await expect(this.page.getByRole('heading', { name })).toBeVisible({ timeout: 30_000 });
  }

  private async clickNext(force = false) {
    const next = this.page
      .getByRole('button', { name: /^Next$/ })
      .filter({ hasNotText: /Previous/i })
      .or(this.page.locator('button.btn-primary:not([disabled])').filter({ hasText: /^Next$/ }))
      .first();
    await expect(next).toBeVisible({ timeout: 15_000 });
    await expect(next).toBeEnabled({ timeout: 30_000 });
    if (force) {
      await next.evaluate((el: HTMLElement) => el.click());
    } else {
      await next.click({ force: true });
    }
  }
}
