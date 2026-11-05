import { expect, type Locator, type Page } from '@playwright/test';
import { pause } from '../utils/pause';

const IDENTITY_HOST =
  /identity\.engagifii\.com|engagifii-support-identity\.azurewebsites\.net|engagifii-perf-identity|azurewebsites\.net\/Account\/Login/i;

export class LoginPage {
  readonly usernameInput: Locator;
  readonly passwordInput: Locator;
  readonly loginButton: Locator;
  readonly errorMessage: Locator;

  constructor(private readonly page: Page) {
    this.usernameInput = page.locator('#UserName');
    this.passwordInput = page.locator('#Password');
    this.loginButton = page.locator('#loginBtn');
    this.errorMessage = page
      .locator('.validation-summary-errors li, .field-validation-error, .text-danger li')
      .filter({
        hasText:
          /invalid username or password|does not exist|invalid password|incorrect password|field is required/i,
      })
      .first();
  }

  async open() {
    const configuredBase = process.env.BASE_URL || 'https://automation.engagifii.com/';
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        // Use absolute BASE_URL so we never accidentally hit the wrong tenant.
        await this.page.goto(configuredBase, { waitUntil: 'domcontentloaded', timeout: 90_000 });
        await this.usernameInput.waitFor({ state: 'visible', timeout: 60_000 });
        return;
      } catch (error) {
        if (attempt === 2) throw error;
        await pause(1_500);
      }
    }
  }

  async login(username: string, password: string) {
    if (!username || !password) {
      throw new Error('Username and password are required for login');
    }

    const configuredBase = process.env.BASE_URL || 'https://automation.engagifii.com/';
    const configuredHost = new URL(configuredBase).host;
    const success = new RegExp(`^https://${configuredHost.replace(/\./g, '\\.')}/(?!auth-callback)`, 'i');

    await this.fillAndSubmit(username, password);

    const outcome = await Promise.race([
      this.page
        .waitForURL(
          (url) => success.test(url.href) || /\/auth-callback/i.test(url.href),
          { timeout: 90_000 },
        )
        .then(() => 'navigated' as const),
      this.errorMessage.waitFor({ state: 'visible', timeout: 90_000 }).then(() => 'error' as const),
    ]);

    if (outcome === 'error') {
      const message = (await this.errorMessage.textContent())?.trim() || 'Login failed';
      // The first submit can post before the username is bound. Fill and submit once more.
      if (/field is required/i.test(message)) {
        await this.fillAndSubmit(username, password);
        await this.page.waitForURL(success, { timeout: 90_000 });
      } else {
        throw new Error(`${message} (user=${username})`);
      }
    }

    if (/\/auth-callback/i.test(this.page.url())) {
      await this.page.waitForURL(success, { timeout: 90_000 });
    }

    // Still on identity after first submit — one recovery attempt.
    if (IDENTITY_HOST.test(this.page.url())) {
      if (await this.errorMessage.isVisible().catch(() => false)) {
        const message = (await this.errorMessage.textContent())?.trim() || 'Login failed';
        throw new Error(`${message} (user=${username})`);
      }
      await this.fillAndSubmit(username, password);
      await this.page.waitForURL(success, { timeout: 90_000 });
    }

    await expect(this.page).toHaveURL(success, { timeout: 30_000 });
  }

  private async fillAndSubmit(username: string, password: string) {
    await this.usernameInput.waitFor({ state: 'visible', timeout: 30_000 });
    // The identity page can re-render after load and clear the fields, so fill until both stick.
    // Compare the password as a boolean so a failure never prints it.
    await expect
      .poll(
        async () => {
          if ((await this.usernameInput.inputValue()) !== username) await this.usernameInput.fill(username);
          if ((await this.passwordInput.inputValue()) !== password) await this.passwordInput.fill(password);
          await this.page.waitForTimeout(500);
          return (
            (await this.usernameInput.inputValue()) === username &&
            (await this.passwordInput.inputValue()) === password
          );
        },
        { message: 'Username and password fields did not keep their values', timeout: 20_000 },
      )
      .toBe(true);

    // Button click can post empty fields (client validation race).
    // Native form.submit() posts the filled values reliably.
    await this.page.locator('form').first().evaluate((form: HTMLFormElement) => form.submit());
  }
}
