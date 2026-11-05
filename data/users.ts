export function getAdminUser() {
  const username = process.env.LOGIN_USERNAME?.trim() ?? '';
  const password = process.env.LOGIN_PASSWORD?.trim() ?? '';

  if (!username || !password) {
    throw new Error('LOGIN_USERNAME and LOGIN_PASSWORD must be set in .env');
  }

  return { username, password };
}

/** @deprecated Prefer getAdminUser() so env is read after Playwright config loads. */
export const adminUser = {
  get username() {
    return getAdminUser().username;
  },
  get password() {
    return getAdminUser().password;
  },
};
