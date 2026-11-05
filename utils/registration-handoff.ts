import fs from 'node:fs';
import path from 'node:path';
import type { Page } from '@playwright/test';
import type { RegistrationIdentity } from '../pages/registration-detail.page';

export const AUTH_DIR = path.resolve(__dirname, '..', 'playwright', '.auth');
export const STORAGE_STATE_PATH = path.join(AUTH_DIR, 'admin-storage.json');
export const HANDOFF_PATH = path.join(AUTH_DIR, 'registration-handoff.json');

export type RegistrationHandoff = RegistrationIdentity & {
  eventName: string;
  sessionName: string;
  className: string;
  participantMatch: string;
  origin: string;
  /** The app keeps its OIDC user in sessionStorage, which storageState does not save. */
  sessionStorage: Record<string, string>;
  savedAt: string;
};

export async function saveRegistrationHandoff(
  page: Page,
  identity: RegistrationIdentity,
  details: Pick<RegistrationHandoff, 'eventName' | 'sessionName' | 'className' | 'participantMatch'>,
) {
  fs.mkdirSync(AUTH_DIR, { recursive: true });
  await page.context().storageState({ path: STORAGE_STATE_PATH });
  const sessionStorage = await page.evaluate(() => {
    const out: Record<string, string> = {};
    for (let i = 0; i < window.sessionStorage.length; i++) {
      const key = window.sessionStorage.key(i);
      if (key) out[key] = window.sessionStorage.getItem(key) || '';
    }
    return out;
  });
  const handoff: RegistrationHandoff = {
    ...identity,
    ...details,
    origin: new URL(page.url()).origin,
    sessionStorage,
    savedAt: new Date().toISOString(),
  };
  fs.writeFileSync(HANDOFF_PATH, JSON.stringify(handoff, null, 2));
  return handoff;
}

export function readRegistrationHandoff(): RegistrationHandoff {
  if (!fs.existsSync(HANDOFF_PATH) || !fs.existsSync(STORAGE_STATE_PATH)) {
    throw new Error(
      `No completed registration handoff at ${HANDOFF_PATH}. Run the "registration" project (create-event-setup.spec.ts) first.`,
    );
  }
  return JSON.parse(fs.readFileSync(HANDOFF_PATH, 'utf8')) as RegistrationHandoff;
}

export function clearRegistrationHandoff() {
  fs.rmSync(HANDOFF_PATH, { force: true });
}
