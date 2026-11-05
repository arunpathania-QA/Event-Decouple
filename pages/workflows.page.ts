import { expect, type Page } from '@playwright/test';

export class WorkflowsPage {
  constructor(private readonly page: Page) {}

  /**
   * Search Workflows column on All Workflows.
   * Returns true when Workflow Name matches exactly (e.g. Admin Decouple Registration).
   */
  async hasWorkflowByName(workflowName: string): Promise<boolean> {
    const search = this.page.getByRole('textbox', { name: 'Search Workflows' });
    await expect(search).toBeVisible({ timeout: 20_000 });

    // Wait for grid to paint before searching.
    await this.page.locator('table tbody tr').first().waitFor({ state: 'visible', timeout: 20_000 }).catch(() => undefined);

    const exactLink = () => this.page.getByRole('link', { name: workflowName, exact: true });
    if (await exactLink().first().isVisible().catch(() => false)) {
      return true;
    }

    await search.fill('');
    await search.fill(workflowName);
    await search.press('Enter').catch(() => undefined);
    await this.page.waitForTimeout(2_000);

    if (await exactLink().first().isVisible().catch(() => false)) {
      return true;
    }

    const byText = this.page.getByText(workflowName, { exact: true });
    if (await byText.first().isVisible().catch(() => false)) {
      return true;
    }

    const rows = this.page.locator('table tbody tr');
    const rowCount = await rows.count();
    for (let i = 0; i < rowCount; i++) {
      const text = (await rows.nth(i).innerText().catch(() => '')).replace(/\s+/g, ' ').trim();
      if (text.includes(workflowName)) {
        return true;
      }
    }
    return false;
  }

  async addRegistrationWorkflow(name: string, eventTypeName: string) {
    const search = this.page.getByRole('textbox', { name: 'Search Workflows' });
    if (await search.isVisible().catch(() => false)) {
      await search.fill('');
      await this.page.waitForTimeout(400);
    }

    await this.openRegistrationWorkflowForm();

    const formRoot = this.page.locator('#inlineCourseDivId').first();
    const nameInput = formRoot.locator('input[type="text"]').first();
    await nameInput.waitFor({ state: 'visible', timeout: 20_000 });
    await nameInput.fill(name);

    // Object Category → Events
    await this.page.locator('a').filter({ hasText: 'Select' }).first().click();
    await this.page.locator('#inlineCourseDivId').getByText('Events').click();
    await this.page.getByRole('radio', { name: 'Events' }).check();
    await this.closeOverlay();

    // Object Type → exact event type (filter if search exists)
    await this.page.locator('a').filter({ hasText: 'Select' }).first().click();
    const typeOverlay = this.page.locator('.cdk-overlay-pane').last();
    const typeFilter = typeOverlay.getByRole('textbox').first();
    if (await typeFilter.isVisible().catch(() => false)) {
      await typeFilter.fill(eventTypeName);
      await this.page.waitForTimeout(400);
    }
    await this.page.getByRole('checkbox', { name: eventTypeName, exact: true }).click({ force: true });
    await this.closeOverlay();
    await expect(this.page.getByText(eventTypeName, { exact: true }).first()).toBeVisible({
      timeout: 10_000,
    });

    // Roles — click Select All label (custom checkbox), else pick Judge
    await this.page.locator('a').filter({ hasText: 'Select Role(s)' }).click();
    const rolePane = this.page.locator('.cdk-overlay-pane').last();
    await expect(rolePane).toBeVisible({ timeout: 10_000 });

    const selectAll = rolePane.getByText('Select All', { exact: true });
    if (await selectAll.isVisible().catch(() => false)) {
      await selectAll.click({ force: true });
    } else {
      await rolePane.getByText('Judge', { exact: true }).click({ force: true });
    }
    await this.page.waitForTimeout(400);
    await this.closeOverlay();
    await this.page.waitForTimeout(500);

    await this.page.getByRole('button', { name: 'Save' }).click();

    const toastError = this.page.locator('.toast-error, .toast-danger, .alert-danger, .toaster-error');
    try {
      await expect(nameInput).toBeHidden({ timeout: 45_000 });
    } catch {
      const toastText = (await toastError.first().innerText().catch(() => '')).trim();
      throw new Error(
        toastText
          ? `Workflow Save failed: ${toastText}`
          : `Workflow Save did not close the form for "${name}".`,
      );
    }

    await search.fill(name);
    await expect(this.page.getByRole('link', { name, exact: true })).toBeVisible({ timeout: 30_000 });
  }

  private addWorkflowControl() {
    return this.page.locator('a.btn-primary, button.btn-primary').filter({ hasText: /Add Workflow/i });
  }

  private async openRegistrationWorkflowForm() {
    const addWorkflow = this.addWorkflowControl();
    if (!(await addWorkflow.first().isVisible().catch(() => false))) {
      await this.revealAddWorkflowButton();
    }

    await this.page.keyboard.press('Escape').catch(() => undefined);
    await this.page.waitForTimeout(300);
    await expect(addWorkflow.first()).toBeVisible({ timeout: 10_000 });
    await addWorkflow.first().click({ force: true });

    const registrationItem = this.page.getByRole('menuitem', { name: 'Registration Workflow' });
    try {
      await expect(registrationItem).toBeVisible({ timeout: 5_000 });
    } catch {
      await this.page.keyboard.press('Escape').catch(() => undefined);
      await addWorkflow.first().click();
      await expect(registrationItem).toBeVisible({ timeout: 10_000 });
    }

    await registrationItem.click();
  }

  private async revealAddWorkflowButton() {
    const addWorkflow = this.addWorkflowControl();
    await this.page.locator('ul li [aria-hidden]').last().click({ force: true });
    await expect(addWorkflow.first()).toBeVisible({ timeout: 15_000 });
  }

  private async closeOverlay() {
    const backdrop = this.page.locator('.cdk-overlay-backdrop').last();
    if (await backdrop.isVisible().catch(() => false)) {
      await backdrop.click({ force: true });
      await this.page.waitForTimeout(250);
    } else {
      await this.page.keyboard.press('Escape').catch(() => undefined);
    }
    await this.page.waitForTimeout(200);
  }
}
