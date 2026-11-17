import { expect, type Locator, type Page } from '@playwright/test';
import { confirmValidationMessage, settleConfirmUser } from '../utils/confirm-user';
import { pause } from '../utils/pause';
import { RegistrationDetailPage, type RegistrationIdentity } from './registration-detail.page';

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/**
 * All Registrations search by Group ID → registration detail → Modify Registration wizard.
 * The original Register wizard stays in EventRegistrationPage.
 */
export class ModifyRegistrationPage {
  readonly detail: RegistrationDetailPage;

  constructor(private readonly page: Page) {
    this.detail = new RegistrationDetailPage(page);
  }

  /** My Area → Registrations → All Registrations from the side menu. */
  async goToAllRegistrations() {
    const myArea = this.page.locator('a, li, span').filter({ hasText: /^\s*My Area\s*$/ }).first();
    await expect(myArea).toBeVisible({ timeout: 30_000 });
    const allRegistrations = this.page.getByRole('link', { name: 'All Registrations', exact: true });

    if (!(await allRegistrations.isVisible().catch(() => false))) {
      await myArea.click();
      await pause(500);
    }
    if (!(await allRegistrations.isVisible().catch(() => false))) {
      const registrations = this.page
        .locator('a, li, span')
        .filter({ hasText: /^\s*Registrations\s*$/ })
        .first();
      await expect(registrations).toBeVisible({ timeout: 10_000 });
      await registrations.click();
      await pause(500);
    }
    await expect(allRegistrations).toBeVisible({ timeout: 10_000 });
    await allRegistrations.click();

    await expect(this.page.getByText(/^\s*Events\s*[\d,]*\s*$/).first()).toBeVisible({ timeout: 45_000 });
    await expect(this.page.getByText('Member Registrations').first()).toBeVisible();
    await expect(this.searchGroupId()).toBeVisible({ timeout: 30_000 });
    await expect(this.page.getByRole('textbox', { name: 'Search Registration ID' })).toBeVisible();
  }

  /** Search the Group ID column only, then open the row whose link is that full Group ID. */
  async openByGroupId(identity: RegistrationIdentity) {
    const search = this.searchGroupId();
    await search.click();
    await search.fill('');
    await expect
      .poll(async () => {
        if ((await search.inputValue()) !== identity.groupId) {
          await search.fill('');
          await search.pressSequentially(identity.groupId, { delay: 30 });
        }
        return (await search.inputValue()) === identity.groupId;
      }, { timeout: 20_000 })
      .toBeTruthy();
    await search.press('Enter');
    await this.page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);

    const groupLink = this.page.getByRole('link', {
      name: new RegExp(`^${escapeRegExp(identity.groupId)}(?:\\s|$)`),
    });
    await expect(groupLink.first()).toBeVisible({ timeout: 45_000 });
    const row = this.page.getByRole('row').filter({ has: groupLink });
    await expect(row.first()).toContainText(identity.groupId);
    console.log('[All Registrations] result row', (await row.first().innerText()).replace(/\s+/g, ' '));

    await groupLink.first().click();
    await expect(this.detail.header()).toContainText(identity.groupId, { timeout: 45_000 });
    const opened = await this.detail.readIdentity();
    expect(opened.groupId).toBe(identity.groupId);
    expect(opened.registrationId).toBe(identity.registrationId);
    expect(opened.registrationUuid).toBe(identity.registrationUuid);
    return opened;
  }

  async beginModification() {
    const modify = this.page.getByRole('button', { name: /Modify this Registration/i });
    await expect(modify).toBeVisible({ timeout: 20_000 });
    await expect(modify).toBeEnabled();
    await modify.click();
    await expect(this.page.getByText('Modify Registration for Group')).toBeVisible();
    await this.page.getByRole('button', { name: 'Proceed' }).click();
    await expect(this.page.getByRole('heading', { name: 'Modify Registration' })).toBeVisible({
      timeout: 30_000,
    });
    await expect(this.page.locator('#stickyheader').getByText('Modify Registration')).toBeVisible();
  }

  async overviewNext() {
    // Proceed opens Overview. The lower Next is under the participant cart, so it never leaves this step.
    // Header Next can open Choose Participants or skip straight to Confirm/Update User.
    if (await this.onConfirmStep()) return;
    if (await this.selectedParticipant().isVisible({ timeout: 3_000 }).catch(() => false)) return;

    const peopleSearch = this.page.getByRole('textbox', { name: 'Search All People' });
    for (let attempt = 0; attempt < 3 && (await this.onOverviewStep()); attempt++) {
      console.log(`[Modify] leaving Overview ${attempt + 1}`);
      await this.clickHeaderNext();
      await this.page
        .getByText('Basic Details', { exact: true })
        .waitFor({ state: 'hidden', timeout: 10_000 })
        .catch(() => undefined);
    }

    if (await this.onConfirmStep()) return;
    if (await this.onSessionsStep()) return;
    if (await peopleSearch.isVisible().catch(() => false)) return;
    if (await this.selectedParticipant().isVisible().catch(() => false)) return;
    await expect(this.selectedParticipant().or(peopleSearch).first()).toBeVisible({ timeout: 30_000 });
  }

  /** The selected-count button only opens the cart. Leave the existing person selected. */
  async keepExistingParticipant() {
    if (await this.onConfirmStep() || (await this.onSessionsStep())) return;
    const peopleSearch = this.page.getByRole('textbox', { name: 'Search All People' });
    await expect(this.selectedParticipant().or(peopleSearch).first()).toBeVisible({ timeout: 30_000 });
    // Header Next. The lower Next stays under the cart on this step too.
    await this.clickHeaderNext();
    const sessions = this.page.getByRole('textbox', { name: /Search sessions/i });
    const confirm = this.page.getByText('Basic Information', { exact: true });
    const landed = await Promise.race([
      sessions.waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'sessions' as const).catch(() => 'choose' as const),
      confirm.waitFor({ state: 'visible', timeout: 12_000 }).then(() => 'confirm' as const).catch(() => 'choose' as const),
    ]);
    if (landed === 'sessions' || landed === 'confirm') return;
    if (await peopleSearch.isVisible().catch(() => false)) {
      await this.clickHeaderNext();
    }
  }

  /** Next on an unfinished user-info form sends the browser Home, so wait for the email first. */
  async confirmUserNext(participantMatch: string) {
    // Header Next from Choose Participants can pass Confirm and open Select Sessions.
    const sessions = this.page.getByRole('textbox', { name: /Search sessions/i });
    const email = this.page.locator('sd-email-type-renderer').getByText(/@/).first();
    const arrived = await Promise.race([
      sessions.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'sessions' as const).catch(() => 'pending' as const),
      email.waitFor({ state: 'visible', timeout: 15_000 }).then(() => 'email' as const).catch(() => 'pending' as const),
    ]);
    if (arrived === 'sessions' || (await this.onSessionsStep())) return;

    await this.page.waitForURL(/\/signup\/user-info/i, { timeout: 30_000 });
    const person = new RegExp(escapeRegExp(participantMatch), 'i');
    for (let attempt = 0; attempt < 3; attempt++) {
      if (await this.onSessionsStep()) return;
      await expect(this.page.getByText(person).first()).toBeVisible({ timeout: 30_000 });
      await this.page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);
      if (await this.onSessionsStep()) return;
      await settleConfirmUser(this.page, participantMatch);
      await this.clickHeaderNext();
      const advanced = await this.sessionsStep()
        .first()
        .waitFor({ state: 'visible', timeout: 20_000 })
        .then(() => true)
        .catch(() => false);
      if (advanced) return;
      if (/\/pages\/home/i.test(this.page.url())) {
        console.log('[Modify] Confirm/Update User Next went Home, returning to the form');
        await this.page.goBack({ waitUntil: 'domcontentloaded' });
        await pause(2_000);
        if (attempt === 2) {
          const validation = await confirmValidationMessage(this.page);
          throw new Error(
            `Confirm/Update User Information Next returned the browser to Home. Participant profile was not edited. Validation: ${validation}`,
          );
        }
        continue;
      }
      // Some workflows insert Approvals Needed before sessions. Leave it untouched.
      const stillConfirm = await this.page.getByText('Basic Information', { exact: true }).isVisible().catch(() => false);
      if (!stillConfirm) {
        await this.clickHeaderNext();
        const afterApproval = await this.sessionsStep()
          .first()
          .waitFor({ state: 'visible', timeout: 20_000 })
          .then(() => true)
          .catch(() => false);
        if (afterApproval) return;
      }
    }
    await expect(this.sessionsStep().first()).toBeVisible({ timeout: 15_000 });
  }

  async modifySession(sessionName: string) {
    await expect(this.sessionsStep()).toBeVisible();
    await this.page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);

    const row = this.page.getByRole('row', { name: new RegExp(escapeRegExp(sessionName), 'i') }).first();
    await expect(row).toBeVisible({ timeout: 45_000 });
    const priceCell = row.getByRole('cell', { name: /check_icon\s*\$/i }).first();
    await expect(priceCell).toBeVisible({ timeout: 45_000 });
    await this.collapseCartIfOpen();
    const checked = row.getByRole('cell', { name: /^check_icon\s*\$/i }).getByRole('img', { name: 'check_icon', exact: true });
    const unchecked = row.getByRole('cell', { name: /^uncheck_icon\s*\$/i });
    await expect(checked).toBeVisible({ timeout: 20_000 });
    await checked.scrollIntoViewIfNeeded();
    // Dispatch on the icon itself so the bottom cart panel can never take the click.
    await checked.evaluate((el: HTMLElement) => el.click());
    if (!(await unchecked.isVisible({ timeout: 8_000 }).catch(() => false))) {
      await checked.evaluate((el: HTMLElement) => el.click());
    }
    await expect(unchecked).toBeVisible({ timeout: 20_000 });

    // The app marks the change on the participant column: "Aaman aa Modified".
    const sessionsTable = this.page.getByRole('table').filter({ has: row });
    await expect(sessionsTable.getByText('Modified', { exact: true }).first()).toBeVisible({ timeout: 20_000 });
    console.log('[Modify] session marked Modified', sessionName);
  }

  /** Next through Classes and Supporting Documents without touching either. */
  async keepClassesAndDocuments() {
    // The modify wizard has no "Step N - Select Classes" heading. This notice is the classes step.
    await this.advanceTo(
      this.page
        .getByText(/Participants cannot register for classes happening at the same date and time/i)
        .or(this.page.getByRole('textbox', { name: /Search classes/i })),
    );
    await this.page.getByText('Loading...', { exact: true }).waitFor({ state: 'hidden', timeout: 60_000 }).catch(() => undefined);
    await pause(2_000);

    const classesNote = this.page.getByText(
      /Participants cannot register for classes happening at the same date and time/i,
    );
    await this.clickHeaderNext();
    const leftClasses = await classesNote.waitFor({ state: 'hidden', timeout: 20_000 }).then(() => true).catch(() => false);
    if (!leftClasses && !/\/pages\/home/i.test(this.page.url())) {
      await this.clickHeaderNext();
    }
    if (/\/pages\/home/i.test(this.page.url())) {
      throw new Error('The Modify Registration wizard returned to Home after Classes.');
    }
    const onReview = await this.reviewStep()
      .first()
      .waitFor({ state: 'visible', timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    if (!onReview) {
      await this.clickHeaderNext();
    }
    await expect(this.reviewStep()).toBeVisible({ timeout: 45_000 });
  }

  async reviewAndSubmit() {
    await expect(this.page.locator('sd-event-signup-review-itemlist')).toContainText('Modified');
    await expect(
      this.page.locator('sd-registration-billing-container').getByText('Organization', { exact: true }),
    ).toBeVisible();

    // The financial impact panel loads after the review renders and re-renders the form,
    // clearing billing and certification. Wait for it before filling either.
    await expect(this.page.getByText('What will happen when this registration is modified?')).toBeVisible({
      timeout: 30_000,
    });
    await expect(this.page.locator('.shimmer')).toHaveCount(0, { timeout: 90_000 });
    await this.page.waitForLoadState('networkidle', { timeout: 15_000 }).catch(() => undefined);

    await this.selectBillingContactIfNeeded();
    await this.acceptCertification();
    await pause(1_500);
    if (await this.billingSelect().isVisible().catch(() => false)) {
      await this.selectBillingContactIfNeeded();
    }
    await this.acceptCertification();

    const register = this.page.getByRole('button', { name: /^Register$/ }).last();
    await expect(register).toBeEnabled({ timeout: 30_000 });
    await register.click();

    const submitting = this.page.getByText(/Submitting your Registration/i);
    await submitting.waitFor({ state: 'visible', timeout: 15_000 }).catch(() => undefined);
    await submitting.waitFor({ state: 'hidden', timeout: 180_000 }).catch(() => undefined);
    await this.page.waitForURL(/\/pages\/events\/registration-detail\/[0-9a-f-]+/i, { timeout: 120_000 });
    console.log('[Modify] redirected to', this.page.url());
    await this.detail.expectComplete();
  }

  async expectModified(before: RegistrationIdentity, eventName: string, participantMatch: string) {
    const after = await this.detail.readIdentity();
    expect(after.groupId).toBe(before.groupId);
    expect(after.registrationId).toBe(before.registrationId);
    expect(after.registrationUuid).toBe(before.registrationUuid);
    expect(after.modificationCount).toBe(before.modificationCount + 1);
    await expect(this.detail.header()).toContainText(`Modifications: ${after.modificationCount}`);
    await expect(this.page.getByText('Registration Status: Complete')).toBeVisible();
    if (eventName) {
      await expect(this.page.getByText(eventName, { exact: true }).first()).toBeVisible();
    }
    await expect(this.page.getByText(new RegExp(escapeRegExp(participantMatch), 'i')).first()).toBeVisible();
    console.log('[Modify complete]', JSON.stringify(after));
    return after;
  }

  private searchGroupId() {
    return this.page.getByRole('textbox', { name: 'Search Group ID', exact: true });
  }

  private async onSessionsStep() {
    return this.page.getByRole('textbox', { name: /Search sessions/i }).isVisible().catch(() => false);
  }

  private sessionsStep() {
    return this.page
      .getByRole('heading', { name: /Select Sessions/i })
      .or(this.page.getByRole('textbox', { name: /Search sessions/i }));
  }

  private reviewStep() {
    return this.page
      .getByRole('heading', { name: /Submit Registration/i })
      .or(this.page.locator('sd-event-signup-review-itemlist'));
  }

  /** The bottom cart only lists activity; collapsing it does not change the selected participant. */
  private async collapseCartIfOpen() {
    const expanded = this.page.getByRole('button', { name: 'Collapse all' });
    if (!(await expanded.isVisible().catch(() => false))) return;
    await this.page.getByRole('button', { name: /Participant\(s\) Selected\s*\|/i }).click();
    await expect(expanded).toBeHidden({ timeout: 10_000 });
  }

  private selectedParticipant() {
    return this.page.getByRole('button', { name: /View Selected Participant\(s\):\s*1\b/i });
  }

  /** Overview is the only step with Basic Details. The cart label is also on later steps. */
  private async onOverviewStep() {
    if (await this.onConfirmStep()) return false;
    return this.page.getByText('Basic Details', { exact: true }).isVisible().catch(() => false);
  }

  /** Confirm/Update User. The cart label "1 Participant(s) Selected" is also on earlier steps. */
  private async onConfirmStep() {
    if (/\/signup\/user-info/i.test(this.page.url())) return true;
    const basic = await this.page.getByText('Basic Information', { exact: true }).isVisible().catch(() => false);
    const peopleSearch = await this.page.getByRole('textbox', { name: 'Search All People' }).isVisible().catch(() => false);
    return basic && !peopleSearch;
  }

  private async advanceTo(marker: Locator) {
    await this.clickNext();
    if (!(await marker.first().isVisible({ timeout: 10_000 }).catch(() => false))) {
      if (/\/pages\/home/i.test(this.page.url())) {
        throw new Error('The Modify Registration wizard returned to Home after Next.');
      }
      await this.clickNext();
    }
    await expect(marker.first()).toBeVisible({ timeout: 45_000 });
  }

  private billingSelect() {
    return this.page
      .locator('sd-registration-billing-container sd-multi-select-dropdown a')
      .filter({ hasText: /^\s*Select\s*$/ })
      .first();
  }

  /** Billing contact is only required when the dropdown still shows Select. */
  private async selectBillingContactIfNeeded() {
    const trigger = this.billingSelect();
    if (!(await this.visibleWithin(trigger, 5_000))) {
      console.log('[Modify] billing contact already selected');
      return;
    }

    // The contact list loads after the dropdown opens. Until it does, the overlay holds only the
    // "Select All" row, which is not a contact. Wait for a real option, and reopen if none arrives.
    const contacts = this.billingContactOptions();
    const maxRounds = 4;
    for (let round = 1; round <= maxRounds; round += 1) {
      await trigger.scrollIntoViewIfNeeded();
      await this.closeBillingOverlay();
      await trigger.click({ force: true });

      if (!(await this.visibleWithin(contacts, 15_000))) {
        console.log(`[Modify] billing contact list empty, pause and reopen ${round}/${maxRounds}`);
        await this.closeBillingOverlay();
        await pause(2_000);
        continue;
      }

      const preferred = this.page.getByRole('checkbox', { name: /Craig ServiceBus Craig|Aaman/i });
      const box = (await this.visibleWithin(preferred, 2_000)) ? preferred.first() : contacts.last();
      await expect(box).toBeVisible({ timeout: 10_000 });
      if (!(await box.isChecked().catch(() => false))) {
        await box.check({ force: true });
      }
      await expect(box).toBeChecked({ timeout: 5_000 });
      await this.closeBillingOverlay();

      if (await trigger.waitFor({ state: 'hidden', timeout: 10_000 }).then(() => true).catch(() => false)) {
        console.log('[Modify] billing contact selected');
        return;
      }
      console.log(`[Modify] billing contact still shows Select, retrying ${round}/${maxRounds}`);
      await pause(1_000);
    }
    throw new Error('The billing contact list never offered a contact, or the selection did not apply.');
  }

  /** Contact checkboxes in the open dropdown, excluding the "Select All" row. */
  private billingContactOptions() {
    return this.page.locator(
      'xpath=//div[contains(@class,"cdk-overlay-pane")]//input[@type="checkbox"]' +
        '[not(ancestor::div[contains(@class,"all-select")])][not(@disabled)]',
    );
  }

  private async closeBillingOverlay() {
    const pane = this.page.locator('.cdk-overlay-pane').first();
    if (!(await pane.isVisible().catch(() => false))) return;
    await this.page.locator('.cdk-overlay-backdrop').last().click({ force: true }).catch(async () => {
      await this.page.keyboard.press('Escape');
    });
    await pane.waitFor({ state: 'hidden', timeout: 5_000 }).catch(() => undefined);
  }

  private async visibleWithin(locator: Locator, timeout: number) {
    return locator
      .first()
      .waitFor({ state: 'visible', timeout })
      .then(() => true)
      .catch(() => false);
  }

  private async acceptCertification() {
    const agree = this.page.locator('.footer-message input.alignCheckbox[type="checkbox"]');
    await expect(this.page.getByText(/By clicking Register,\s*I/i)).toBeVisible({ timeout: 15_000 });
    await expect(agree).toHaveCount(1);
    if (!(await agree.isChecked())) {
      await agree.scrollIntoViewIfNeeded();
      await agree.check({ force: true }).catch(async () => {
        await agree.evaluate((el: HTMLInputElement) => el.click());
      });
    }
    await expect(agree).toBeChecked({ timeout: 8_000 });
  }

  private async clickNext() {
    const submitNext = this.page.locator('button[type="submit"]').filter({ hasText: /^\s*Next\s*$/ }).last();
    const next = (await submitNext.count())
      ? submitNext
      : this.page.getByRole('button', { name: /^Next$/ }).first();
    await expect(next).toBeVisible({ timeout: 15_000 });
    await expect(next).toBeEnabled({ timeout: 30_000 });
    await next.click({ force: true });
  }

  /** Header Next. The lower Next sits under the participant cart on the classes step. */
  private async clickHeaderNext() {
    const next = this.page.locator('button[type="submit"]').filter({ hasText: /^\s*Next\s*$/ }).first();
    await next.scrollIntoViewIfNeeded();
    await expect(next).toBeEnabled({ timeout: 15_000 });
    await pause(1_000);
    await next.click().catch(async () => {
      await next.evaluate((el: HTMLElement) => el.click());
    });
  }
}
