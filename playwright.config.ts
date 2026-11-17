import { defineConfig, devices } from '@playwright/test';
import { loadEnvironment, requireBaseUrl } from './utils/load-env';

loadEnvironment();

/**
 * See https://playwright.dev/docs/test-configuration.
 */
export default defineConfig({
  testDir: './tests',
  /* Run tests in files in parallel */
  fullyParallel: true,
  /* Fail the build on CI if you accidentally left test.only in the source code. */
  forbidOnly: !!process.env.CI,
  /* The serial registration lifecycle shares one registration, so a retry would repeat it. */
  retries: 0,
  /* Keep workers low so dependent UI workflows stay stable. */
  workers: process.env.CI ? 1 : 1,
  /* Reporter to use. See https://playwright.dev/docs/test-reporters */
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['./reporters/qa-html-reporter.ts'],
  ],
  /* Shared settings for all the projects below. See https://playwright.dev/docs/api/class-testoptions. */
  use: {
    /* BASE_URL comes from the selected environment. loadEnvironment() fails when it is missing. */
    baseURL: requireBaseUrl(),
    actionTimeout: 15_000,
    navigationTimeout: 45_000,

    /* Collect evidence for debugging and QA report attachments. */
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },

  /* Configure projects for major browsers */
  projects: [
    {
      name: 'chromium',
      testIgnore: [/create-event-setup\.spec\.ts/, /modify-event-registration\.spec\.ts/],
      use: { ...devices['Desktop Chrome'] },
    },
    /* Register, modify, and cancel one registration in a single serial browser session. */
    {
      name: 'registration',
      testMatch: /create-event-setup\.spec\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },

    // {
    //   name: 'firefox',
    //   use: { ...devices['Desktop Firefox'] },
    // },

    // {
    //   name: 'webkit',
    //   use: { ...devices['Desktop Safari'] },
    // },

    /* Test against mobile viewports. */
    // {
    //   name: 'Mobile Chrome',
    //   use: { ...devices['Pixel 5'] },
    // },
    // {
    //   name: 'Mobile Safari',
    //   use: { ...devices['iPhone 12'] },
    // },

    /* Test against branded browsers. */
    // {
    //   name: 'Microsoft Edge',
    //   use: { ...devices['Desktop Edge'], channel: 'msedge' },
    // },
    // {
    //   name: 'Google Chrome',
    //   use: { ...devices['Desktop Chrome'], channel: 'chrome' },
    // },
  ],

  /* Run your local dev server before starting the tests */
  // webServer: {
  //   command: 'npm run start',
  //   url: 'http://localhost:3000',
  //   reuseExistingServer: !process.env.CI,
  // },
});
