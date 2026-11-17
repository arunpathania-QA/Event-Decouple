import { adminUser } from '../../data/users';
import { buildEventSetupData } from '../../data/events';
import { expect, test } from '../../fixtures/event.fixture';
import type { RegistrationIdentity } from '../../pages/registration-detail.page';
import { annotateCase, dateLabel } from '../../utils/report-meta';

type LifecycleRegistration = RegistrationIdentity & {
  eventName: string;
  sessionName: string;
  className: string;
  participantMatch: string;
};

/** In-memory handoff for the one shared browser session. Test 3 uses the identity captured after modification. */
let completedRegistration: LifecycleRegistration | null = null;
let modifiedRegistration: LifecycleRegistration | null = null;

/**
 * Single e2e (login is inside this spec):
 * 1. Login
 * 2. All Workflows -> Search Workflows = "Admin Decouple Registration"
 *    - If found  -> skip event type + workflow -> Add Event
 *    - If missing -> create event type -> add workflow -> Add Event
 * 3. Add Event (Event Type = Decouple Event Type, schedule = Today+45) -> Save
 * 4. Enable registration -> session -> class -> class setup (Edit capacity/date/price)
 * 5. Register button -> wizard Steps 1-7 -> Registration Status: Complete
 */
test.describe.serial('Event registration lifecycle', () => {
  test('Event Decouple Registration For Admin', async ({
    appPage,
    loginPage,
    homePage,
    navigation,
    eventTypesPage,
    workflowsPage,
    eventsPage,
    eventDetailsPage,
    eventRegistrationPage,
    registrationDetailPage,
  }) => {
    test.setTimeout(600_000);
    const data = buildEventSetupData();
    let workflowExists = false;
    let savedEvent: { eventId: string; eventUrl: string; eventName: string; eventTypeName: string } | null =
      null;

    annotateCase({
      id: 'TC-EVENT-E2E-001',
      title: 'Event Decouple Registration For Admin',
      module: 'Events / Event Registration Workflow',
      preconditions:
        'BASE_URL=https://automation.engagifii.com/. FINANCE_ORG_NAME=ServiceBus Organization. PARTICIPANT_MATCH for Step 2.',
      expected:
        'Event saved (schedule Today+45), registration enabled with session/class, Step 7 submits via app redirect, Registration Status: Complete.',
      testData: {
        username: adminUser.username,
        password: '(from .env)',
        baseUrl: process.env.BASE_URL || 'https://automation.engagifii.com/',
        eventTypeName: data.eventTypeName,
        existingWorkflowName: data.existingWorkflowName,
        workflowName: data.workflowName,
        eventName: data.eventName,
        scheduleDate: dateLabel(data.scheduleDate),
        sessionDate: dateLabel(data.sessionDate),
        classScheduleDate: dateLabel(data.classScheduleDate),
        registrationEndDate: dateLabel(data.registrationEndDate),
        defaultPrice: data.defaultPrice,
        registrantCount: data.registrantCount,
        sessionName: data.sessionName,
        className: data.className,
        classCapacity: data.classCapacity,
        classPrice: data.classPrice,
        courseName: data.courseName,
        classTypeName: data.classTypeName,
        participantMatch: data.participantMatch,
        financeOrgName: data.financeOrgName,
      },
    });

    await test.step('Step 1: Login (in this spec)', async () => {
      await loginPage.open();
      await loginPage.login(adminUser.username, adminUser.password);
      await homePage.open();
      await homePage.expectWelcome();
      await appPage
        .addStyleTag({
          content:
            '#hubspot-messages-iframe-container{display:none!important;pointer-events:none!important}',
        })
        .catch(() => undefined);
    });

    await test.step('Step 2: All Workflows -> Search Workflows for Admin Decouple Registration', async () => {
      await navigation.goToAllWorkflows();
      workflowExists = await workflowsPage.hasWorkflowByName(data.existingWorkflowName);

      if (workflowExists) {
        test.info().annotations.push({
          type: 'branch',
          description: `Workflow "${data.existingWorkflowName}" FOUND -> skip create event type + add workflow -> go to Add Event`,
        });
        return;
      }

      test.info().annotations.push({
        type: 'branch',
        description: `Workflow "${data.existingWorkflowName}" NOT FOUND -> create event type -> add workflow -> Add Event`,
      });

      await navigation.goToEventTypes();
      await eventTypesPage.ensureEventType(data.eventTypeName);
      await expect(appPage.getByText(data.eventTypeName, { exact: true }).first()).toBeVisible();

      await navigation.goToAllWorkflows();
      await workflowsPage.addRegistrationWorkflow(data.existingWorkflowName, data.eventTypeName);
      await expect(
        appPage.getByRole('link', { name: data.existingWorkflowName, exact: true }),
      ).toBeVisible();
    });

    await test.step('Step 3: Add Event (Today+45) -> Save -> capture event id/url', async () => {
      await navigation.goToAllEvents();
      savedEvent = await eventsPage.createEvent({
        name: data.eventName,
        eventTypeName: data.eventTypeName,
        defaultPrice: data.defaultPrice,
        scheduleDate: data.scheduleDate,
      });

      expect(savedEvent.eventId).toBeTruthy();
      expect(appPage.url()).toContain(savedEvent.eventId);

      test.info().annotations.push({
        type: 'saved-event',
        description: `Saved event id=${savedEvent.eventId} url=${savedEvent.eventUrl} name=${savedEvent.eventName} schedule=${dateLabel(data.scheduleDate)}`,
      });

      console.log('[Using saved event for registration]', savedEvent.eventUrl);
    });

    await test.step('Step 4: On saved event -> enable registration', async () => {
      expect(savedEvent?.eventUrl).toBeTruthy();
      if (!appPage.url().includes(savedEvent!.eventId)) {
        await appPage.goto(savedEvent!.eventUrl);
        await expect(appPage).toHaveURL(new RegExp(savedEvent!.eventId, 'i'));
      }

      await eventDetailsPage.configureRegistration({
        registrantCount: data.registrantCount,
        registrationEndDate: data.registrationEndDate,
      });
      await eventDetailsPage.expectRegistrationEnabled();
    });

    await test.step('Step 5: Event detail -> Sessions tab -> add session', async () => {
      // Recording: Sessions, day 2, AM cell set to PM, price 10, then Classes list.
      await eventDetailsPage.addSession(data.sessionName, data.defaultPrice, data.sessionDate);
      await expect(appPage.getByText(data.sessionName, { exact: true }).first()).toBeVisible();
    });

    await test.step('Step 6: Event detail -> Classes tab -> add class', async () => {
      await eventDetailsPage.addClass({
        courseName: data.courseName,
        classTypeName: data.classTypeName,
        className: data.className,
        scheduleDate: data.classScheduleDate,
      });
      await expect(appPage.getByRole('link', { name: data.className }).first()).toBeVisible();
    });

    await test.step('Step 7: Open class -> Edit -> registration previous-month day 31 12:00 AM to today+15 11:00 PM -> Save', async () => {
      await eventDetailsPage.setupClass({
        className: data.className,
        capacity: data.classCapacity,
        price: data.classPrice,
        scheduleDate: data.classScheduleDate,
        registrationStartDate: data.classRegistrationStartDate,
        registrationEndDate: data.classRegistrationEndDate,
      });
    });

    await test.step('Step 8: Register wizard Steps 1-7 -> app redirect -> Registration Detail Complete', async () => {
      if (savedEvent) {
        await appPage.goto(savedEvent.eventUrl);
        await expect(appPage).toHaveURL(new RegExp(savedEvent.eventId, 'i'));
      }

      const registrationUrl = await eventRegistrationPage.completeRegistration({
        participantMatch: data.participantMatch,
        financeOrgName: data.financeOrgName,
        eventName: data.eventName,
        eventUrl: savedEvent?.eventUrl,
        sessionName: data.sessionName,
        className: data.className,
      });

      const registrationId = registrationUrl.match(/\/registration-detail\/([0-9a-f-]+)/i)?.[1];
      expect(registrationId).toBeTruthy();

      test.info().annotations.push({
        type: 'registration',
        description: `Registration Complete id=${registrationId} url=${registrationUrl}`,
      });

      await expect(appPage.getByText('Registration Status: Complete')).toBeVisible();
      await expect(appPage).toHaveURL(/\/pages\/events\/registration-detail\//i);
      const identity = await registrationDetailPage.readIdentity();
      completedRegistration = {
        ...identity,
        eventName: data.eventName,
        sessionName: data.sessionName,
        className: data.className,
        participantMatch: data.participantMatch,
      };
      console.log('[Registration captured]', JSON.stringify(completedRegistration));
    });

    void workflowExists;
  });

  test('Modify Event Decouple Registration', async ({ appPage, modifyRegistrationPage }) => {
    test.setTimeout(480_000);
    test.skip(!completedRegistration, 'Test Case 1 did not capture a completed registration');
    const handoff = completedRegistration!;

    annotateCase({
      id: 'TC-EVENT-MOD-001',
      title: 'Modify Event Decouple Registration',
      module: 'Events / Modify Registration',
      preconditions: 'Test Case 1 left the completed registration detail page open in this browser session.',
      expected:
        'The same Group ID and Registration ID are modified once. Registration Status stays Complete and Modifications increases by 1.',
      testData: {
        groupId: handoff.groupId,
        registrationId: handoff.registrationId,
        registrationUuid: handoff.registrationUuid,
        originalModificationCount: String(handoff.modificationCount),
        eventName: handoff.eventName,
        sessionName: handoff.sessionName,
        participantMatch: handoff.participantMatch,
      },
    });

    await test.step('Stay on the completed registration and open it from All Registrations', async () => {
      await expect(appPage).toHaveURL(new RegExp(handoff.registrationUuid, 'i'));
      await modifyRegistrationPage.detail.expectComplete();
      await modifyRegistrationPage.goToAllRegistrations();
      const opened = await modifyRegistrationPage.openByGroupId(handoff);
      expect(opened.modificationCount).toBe(handoff.modificationCount);
    });

    await test.step('Start Modify Registration', async () => {
      await modifyRegistrationPage.beginModification();
    });

    await test.step('Keep the existing participant and confirm the user', async () => {
      await modifyRegistrationPage.overviewNext();
      await modifyRegistrationPage.keepExistingParticipant();
      await modifyRegistrationPage.confirmUserNext(handoff.participantMatch);
    });

    await test.step('Modify the session and leave Classes and Supporting Documents unchanged', async () => {
      await modifyRegistrationPage.modifySession(handoff.sessionName);
      await modifyRegistrationPage.keepClassesAndDocuments();
    });

    await test.step('Review, certify, select billing contact if required, and submit once', async () => {
      await modifyRegistrationPage.reviewAndSubmit();
    });

    await test.step('Same Group ID, Registration ID, and UUID; status Complete; one new modification', async () => {
      const after = await modifyRegistrationPage.expectModified(handoff, handoff.eventName, handoff.participantMatch);
      modifiedRegistration = { ...handoff, ...after };
      console.log('[Modification captured]', JSON.stringify(modifiedRegistration));
    });
  });

  test('Cancel Event Decouple Registration', async ({ appPage, cancelRegistrationPage }) => {
    test.setTimeout(360_000);
    test.skip(!modifiedRegistration, 'Test Case 2 did not capture the modified registration');
    const handoff = modifiedRegistration!;

    annotateCase({
      id: 'TC-EVENT-CAN-001',
      title: 'Cancel Event Decouple Registration',
      module: 'Events / Cancel Registration',
      preconditions: 'Test Case 2 left the modified registration detail page open in this browser session.',
      expected: 'The same registration is cancelled and the application displays Registration Cancelled.',
      testData: {
        groupId: handoff.groupId,
        registrationId: handoff.registrationId,
        registrationUuid: handoff.registrationUuid,
        modificationCount: String(handoff.modificationCount),
        participantMatch: handoff.participantMatch,
      },
    });

    await test.step('Open the modified registration from All Registrations', async () => {
      await expect(appPage).toHaveURL(new RegExp(handoff.registrationUuid, 'i'));
      await cancelRegistrationPage.detail.expectComplete();
      await cancelRegistrationPage.openAllRegistrations();
      const opened = await cancelRegistrationPage.openByGroupId(handoff);
      expect(opened.groupId).toBe(handoff.groupId);
      expect(opened.registrationId).toBe(handoff.registrationId);
      expect(opened.registrationUuid).toBe(handoff.registrationUuid);
      expect(opened.modificationCount).toBe(handoff.modificationCount);
      await expect(appPage).toHaveURL(new RegExp(`/registration-detail/${handoff.registrationUuid}`, 'i'));
    });

    await test.step('Select the registrant and a displayed cancellation reason', async () => {
      await cancelRegistrationPage.openCancellation(handoff);
      await cancelRegistrationPage.selectRegistrantAndReason();
      await cancelRegistrationPage.saveCancellationSelection();
    });

    await test.step('Review the financial impact', async () => {
      await cancelRegistrationPage.proceedToReview(handoff.participantMatch);
    });

    await test.step('Review the cancellation impact', async () => {
      await cancelRegistrationPage.proceedToDetailImpact();
    });

    await test.step('Review who will be notified', async () => {
      await cancelRegistrationPage.proceedToNotifications(handoff.participantMatch);
    });

    await test.step('Confirm cancellation', async () => {
      await cancelRegistrationPage.confirmCancellation();
      await cancelRegistrationPage.expectRegistrationCancelled(handoff);
    });
  });
});
