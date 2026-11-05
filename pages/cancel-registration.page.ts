import { expect, type Page } from '@playwright/test';
import { ModifyRegistrationPage } from './modify-registration.page';
import { RegistrationDetailPage, type RegistrationIdentity } from './registration-detail.page';

/**
 * Cancellation wizard observed on the registration detail page:
 * modal "Registration Cancellation Information" → SELECT registrant checkbox
 * (img alt=checkbox) → expand the registrant row → reason popover
 * (.reason a.form-control → .sat-popover-container li.menuitem) →
 * Save for Cancellation → Proceed through REVIEW, DETAIL IMPACT REVIEW,
 * and NOTIFICATIONS → Cancel Registration → "Yes, Cancel Registration".
 */
export class CancelRegistrationPage {
  readonly detail: RegistrationDetailPage;
  private readonly registrations: ModifyRegistrationPage;

  constructor(private readonly page: Page) {
    this.detail = new RegistrationDetailPage(page);
    this.registrations = new ModifyRegistrationPage(page);
  }

  async openAllRegistrations() {
    await this.registrations.goToAllRegistrations();
  }

  async openByGroupId(identity: RegistrationIdentity) {
    return this.registrations.openByGroupId(identity);
  }

  cancellationModal() {
    return this.page.locator('.modal').filter({ hasText: 'Registration Cancellation Information' }).last();
  }

  async openCancellation(identity: RegistrationIdentity) {
    await this.hideChatWidget();
    const cancel = this.page.getByRole('button', { name: /Cancel this Registration/i });
    await expect(cancel).toBeVisible({ timeout: 20_000 });
    await expect(cancel).toBeEnabled();
    await cancel.click();

    const modal = this.cancellationModal();
    await expect(modal).toBeVisible({ timeout: 20_000 });
    await expect(modal).toContainText(identity.groupId);
    await expect(modal).toContainText(`Modifications: ${identity.modificationCount}`);
    await expect(modal.getByText(/SELECT: Select registrant\(s\)/i)).toBeVisible();
    await expect(modal.getByText(/REVIEW: Please review the overall financial impact/i)).toBeVisible();
    await expect(modal.getByText(/DETAIL IMPACT REVIEW:/i)).toBeVisible();
    await expect(modal.getByText(/NOTIFICATIONS: Please review who all will be notified/i)).toBeVisible();
    return modal;
  }

  /** Check the registrant, expand the fee row, and choose the first reason the popover actually lists. */
  async selectRegistrantAndReason() {
    const modal = this.cancellationModal();
    const selectStep = modal.locator('.row-review').filter({ hasText: /SELECT:/i }).first();
    await selectStep.click();
    await modal.locator('.loader').first().waitFor({ state: 'hidden', timeout: 30_000 }).catch(() => undefined);

    const registrant = modal.locator('.panel-body .panel.panel-default').first();
    await expect(registrant).toBeVisible({ timeout: 20_000 });
    const checkbox = registrant.locator('img[alt="checkbox"]');
    await expect(checkbox).toBeVisible();
    if ((await checkbox.getAttribute('src'))?.includes('White')) {
      await checkbox.click();
    }
    await expect(checkbox).toHaveAttribute('src', /Checkbox_Orange\.png/);

    const reasonTrigger = registrant.locator('.reason a.form-control');
    if (!(await reasonTrigger.isVisible().catch(() => false))) {
      await registrant.locator('.panel-heading').click();
    }
    await expect(registrant.getByText('Registration Cancellation Reason')).toBeVisible();
    await expect(reasonTrigger).toContainText('Select');

    await reasonTrigger.click();
    const options = this.page.locator('.sat-popover-container li.menuitem label');
    await expect(options.first()).toBeVisible({ timeout: 10_000 });
    const reasons = (await options.allInnerTexts()).map((text) => text.trim()).filter(Boolean);
    console.log('[Cancellation reasons]', reasons.join(' | ') || '(none)');
    const reason = reasons.find((name) => !/manage cancellation reasons/i.test(name));
    if (!reason) {
      throw new Error(`No cancellation reason option was displayed. Saw: ${reasons.join(', ') || '(none)'}`);
    }
    await options.filter({ hasText: reason }).first().click();
    await expect(reasonTrigger).toContainText(reason);
    return reason;
  }

  async saveCancellationSelection() {
    const modal = this.cancellationModal();
    const save = modal.getByRole('button', { name: 'Save for Cancellation', exact: true });
    await expect(save).toBeVisible();
    await expect(save).not.toHaveClass(/disabled-btn/, { timeout: 10_000 });
    await save.click();
    await expect(modal.locator('.reason a.form-control')).toBeHidden({ timeout: 15_000 });
    await expect(modal.getByRole('button', { name: 'Proceed', exact: true }).last()).toBeVisible();
    await expect(modal.getByText(/Cancellation Fee:/i).first()).toBeVisible();
  }

  async proceedToReview(participantMatch: string) {
    await this.clickProceed();
    const modal = this.cancellationModal();
    await expect(modal.getByText('Please review the overall financial impact of your selected cancellations')).toBeVisible({
      timeout: 20_000,
    });
    await expect(modal.getByText('Original Registration Amount')).toBeVisible();
    await expect(modal.getByText('Grand Total')).toBeVisible();
    await expect(modal.getByText(new RegExp(escapeRegExp(participantMatch), 'i')).first()).toBeVisible();
  }

  async proceedToDetailImpact() {
    await this.clickProceed();
    const modal = this.cancellationModal();
    await expect(modal.getByText('DETAIL IMPACT REVIEW:')).toBeVisible({ timeout: 20_000 });
    await expect(modal.getByText('What will happen when this registration is cancelled?')).toBeVisible();
    await expect(modal.getByText('Event Registration will be cancelled.')).toBeVisible();
  }

  async proceedToNotifications(participantMatch: string) {
    await this.clickProceed();
    const modal = this.cancellationModal();
    await expect(modal.getByText('NOTIFICATIONS: Please review who all will be notified')).toBeVisible({
      timeout: 20_000,
    });
    await expect(modal.getByText('Who will be notified?')).toBeVisible();
    await expect(modal.getByText(/Registrant whose registration is getting cancelled/i)).toBeVisible();
    await expect(modal.getByText(new RegExp(escapeRegExp(participantMatch), 'i')).first()).toBeVisible();
  }

  async confirmCancellation() {
    await this.clickProceed();
    const modal = this.cancellationModal();
    const cancelRegistration = modal.getByRole('button', { name: 'Cancel Registration', exact: true });
    await expect(cancelRegistration).toBeVisible({ timeout: 20_000 });
    await expect(cancelRegistration).not.toHaveClass(/disabled-btn/);
    await this.hideChatWidget();
    await cancelRegistration.click();

    const confirm = this.page
      .locator('.modal')
      .filter({ has: this.page.getByRole('button', { name: 'Yes, Cancel Registration' }) })
      .last();
    await expect(confirm).toContainText('Registration Cancellation');
    await expect(confirm).not.toContainText('Registration Cancellation Information');
    await expect(confirm.getByText(/Registration for \d+ registrant\(s\) will be cancelled/i)).toBeVisible();
    await expect(confirm.getByText('Are you sure you want to continue?')).toBeVisible();
    await this.hideChatWidget();
    await confirm.getByRole('button', { name: 'Yes, Cancel Registration' }).click();
  }

  async expectRegistrationCancelled(identity: RegistrationIdentity) {
    const dialog = this.page.getByRole('dialog').filter({ hasText: 'Registration Cancelled' }).last();
    const success = dialog.getByText('Registration Cancelled', { exact: true });
    await expect(success).toBeVisible({ timeout: 90_000 });
    const okay = dialog.getByRole('button', { name: 'Okay', exact: true });
    await expect(okay).toBeVisible();
    await this.hideChatWidget();
    await okay.click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });

    await expect(this.detail.header()).toContainText(identity.groupId, { timeout: 30_000 });
    const registrantList = this.page.locator('sd-registrant-list');
    await expect(registrantList.getByText('Registration Cancelled', { exact: true })).toBeVisible();
    await expect(registrantList).toContainText(identity.registrationId);
  }

  private async clickProceed() {
    const proceed = this.cancellationModal().getByRole('button', { name: 'Proceed', exact: true }).last();
    await expect(proceed).toBeVisible({ timeout: 20_000 });
    await this.hideChatWidget();
    await proceed.click();
  }

  /** The HubSpot chat widget covers the modal footer buttons on the right. */
  private async hideChatWidget() {
    await this.page
      .addStyleTag({
        content:
          '#hubspot-messages-iframe-container{display:none!important;pointer-events:none!important}',
      })
      .catch(() => undefined);
  }
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
