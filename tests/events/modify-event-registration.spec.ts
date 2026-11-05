import { expect, test } from '../../fixtures/event.fixture';
import { ModifyRegistrationPage } from '../../pages/modify-registration.page';
import { annotateCase } from '../../utils/report-meta';
import {
  readRegistrationHandoff,
  STORAGE_STATE_PATH,
  type RegistrationHandoff,
} from '../../utils/registration-handoff';

/**
 * Runs in the "modify-registration" project after the "registration" project
 * (create-event-setup.spec.ts) completes a registration and writes the handoff.
 * No login UI, event setup, or new registration happens here.
 */
test.use({ storageState: STORAGE_STATE_PATH });

test.describe('Modify existing event registration', () => {
  test('Modify Event Decouple Registration', async ({ page, homePage }) => {
    test.setTimeout(480_000);
    const handoff: RegistrationHandoff = readRegistrationHandoff();
    const modifyPage = new ModifyRegistrationPage(page);

    annotateCase({
      id: 'TC-EVENT-MOD-001',
      title: 'Modify Event Decouple Registration',
      module: 'Events / Modify Registration',
      preconditions:
        'TC-EVENT-E2E-001 completed a registration and saved its Group ID, Registration ID, UUID, modification count, and signed-in state.',
      expected:
        'The same Group ID and Registration ID are modified once. Session row shows Modified. Registration Status stays Complete and Modifications increases by 1.',
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
    test.info().annotations.push({
      type: 'registration',
      description: `Before modify groupId=${handoff.groupId} registrationId=${handoff.registrationId} uuid=${handoff.registrationUuid} modifications=${handoff.modificationCount}`,
    });

    await test.step('Reuse the signed-in session from the registration test', async () => {
      await page.addInitScript(
        ({ origin, entries }) => {
          if (window.location.origin !== origin) return;
          for (const [key, value] of Object.entries(entries)) {
            if (window.sessionStorage.getItem(key) === null) window.sessionStorage.setItem(key, value);
          }
        },
        { origin: handoff.origin, entries: handoff.sessionStorage },
      );
      await homePage.open();
      await expect(page).not.toHaveURL(/identity|Account\/Login/i, { timeout: 30_000 });
      await homePage.expectWelcome();
    });

    let opened = handoff as RegistrationHandoff;
    await test.step('My Area > Registrations > All Registrations, search Group ID, open the exact result', async () => {
      await modifyPage.goToAllRegistrations();
      const identity = await modifyPage.openByGroupId(handoff);
      expect(identity.modificationCount).toBe(handoff.modificationCount);
      opened = { ...handoff, ...identity };
    });

    await test.step('Start Modify Registration', async () => {
      await modifyPage.beginModification();
    });

    await test.step('Keep the existing participant and confirm the user', async () => {
      await modifyPage.overviewNext();
      await modifyPage.keepExistingParticipant();
      await modifyPage.confirmUserNext(handoff.participantMatch);
    });

    await test.step('Modify the session and leave Classes and Supporting Documents unchanged', async () => {
      await modifyPage.modifySession(handoff.sessionName);
      await modifyPage.keepClassesAndDocuments();
    });

    await test.step('Review, certify, select billing contact if required, and submit once', async () => {
      await modifyPage.reviewAndSubmit();
      await page.screenshot({ path: test.info().outputPath('modified-registration-detail.png'), fullPage: true });
      await test.info().attach('modified-registration-detail', {
        path: test.info().outputPath('modified-registration-detail.png'),
        contentType: 'image/png',
      });
    });

    await test.step('Same Group ID, Registration ID, and UUID; status Complete; one new modification', async () => {
      const after = await modifyPage.expectModified(opened, handoff.eventName, handoff.participantMatch);
      test.info().annotations.push({
        type: 'result',
        description: `Modified groupId=${after.groupId} registrationId=${after.registrationId} uuid=${after.registrationUuid} modifications=${handoff.modificationCount} -> ${after.modificationCount}`,
      });
    });
  });
});
