import { devices, test as base, type BrowserContext, type Page } from '@playwright/test';
import { CancelRegistrationPage } from '../pages/cancel-registration.page';
import { EventDetailsPage } from '../pages/event-details.page';
import { EventRegistrationPage } from '../pages/event-registration.page';
import { EventTypesPage } from '../pages/event-types.page';
import { EventsPage } from '../pages/events.page';
import { HomePage } from '../pages/home.page';
import { LoginPage } from '../pages/login.page';
import { ModifyRegistrationPage } from '../pages/modify-registration.page';
import { NavigationPage } from '../pages/navigation.page';
import { RegistrationDetailPage } from '../pages/registration-detail.page';
import { WorkflowsPage } from '../pages/workflows.page';
import { saveRegistrationHandoff } from '../utils/registration-handoff';

type WorkerFixtures = {
  sharedContext: BrowserContext;
  sharedPage: Page;
};

type AppFixtures = {
  /** The one page shared by the serial registration lifecycle. Do not request the built-in page fixture. */
  appPage: Page;
  loginPage: LoginPage;
  homePage: HomePage;
  navigation: NavigationPage;
  eventTypesPage: EventTypesPage;
  workflowsPage: WorkflowsPage;
  eventsPage: EventsPage;
  eventDetailsPage: EventDetailsPage;
  eventRegistrationPage: EventRegistrationPage;
  registrationDetailPage: RegistrationDetailPage;
  modifyRegistrationPage: ModifyRegistrationPage;
  cancelRegistrationPage: CancelRegistrationPage;
};

const chrome = devices['Desktop Chrome'];

export const test = base.extend<AppFixtures, WorkerFixtures>({
  sharedContext: [
    async ({ browser }, use) => {
      const context = await browser.newContext({
        userAgent: chrome.userAgent,
        viewport: chrome.viewport,
        deviceScaleFactor: chrome.deviceScaleFactor,
        isMobile: chrome.isMobile,
        hasTouch: chrome.hasTouch,
        baseURL: process.env.BASE_URL || 'https://automation.engagifii.com/',
      });
      await use(context);
      await context.close();
    },
    { scope: 'worker' },
  ],
  sharedPage: [
    async ({ sharedContext }, use) => {
      const page = await sharedContext.newPage();
      page.setDefaultTimeout(15_000);
      page.setDefaultNavigationTimeout(45_000);
      await use(page);
      await page.close();
    },
    { scope: 'worker' },
  ],
  appPage: async ({ sharedPage }, use) => {
    await use(sharedPage);
  },
  loginPage: async ({ appPage }, use) => {
    await use(new LoginPage(appPage));
  },
  homePage: async ({ appPage }, use) => {
    await use(new HomePage(appPage));
  },
  navigation: async ({ appPage }, use) => {
    await use(new NavigationPage(appPage));
  },
  eventTypesPage: async ({ appPage }, use) => {
    await use(new EventTypesPage(appPage));
  },
  workflowsPage: async ({ appPage }, use) => {
    await use(new WorkflowsPage(appPage));
  },
  eventsPage: async ({ appPage }, use) => {
    await use(new EventsPage(appPage));
  },
  eventDetailsPage: async ({ appPage }, use) => {
    await use(new EventDetailsPage(appPage));
  },
  registrationDetailPage: async ({ appPage }, use) => {
    await use(new RegistrationDetailPage(appPage));
  },
  modifyRegistrationPage: async ({ appPage }, use) => {
    await use(new ModifyRegistrationPage(appPage));
  },
  cancelRegistrationPage: async ({ appPage }, use) => {
    await use(new CancelRegistrationPage(appPage));
  },
  eventRegistrationPage: async ({ appPage }, use, testInfo) => {
    const registrationPage = new EventRegistrationPage(appPage);
    await use(registrationPage);

    const completed = registrationPage.lastCompleted;
    if (testInfo.status !== 'passed' || !completed) return;
    const identity = await new RegistrationDetailPage(appPage).readIdentity();
    const handoff = await saveRegistrationHandoff(appPage, identity, {
      eventName: completed.eventName,
      sessionName: completed.sessionName,
      className: completed.className,
      participantMatch: completed.participantMatch,
    });
    console.log(
      '[Registration handoff]',
      JSON.stringify({
        groupId: handoff.groupId,
        registrationId: handoff.registrationId,
        registrationUuid: handoff.registrationUuid,
        modificationCount: handoff.modificationCount,
      }),
    );
  },
});

export { expect } from '@playwright/test';
