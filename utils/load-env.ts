import fs from 'node:fs';
import path from 'node:path';

const ENVIRONMENTS = ['support', 'qa', 'hotfix', 'prod'] as const;
type EnvironmentName = (typeof ENVIRONMENTS)[number];

const REQUIRED_KEYS = ['BASE_URL', 'LOGIN_USERNAME', 'LOGIN_PASSWORD'] as const;

const projectRoot = path.resolve(__dirname, '..');

function isEnvironmentName(value: string): value is EnvironmentName {
  return (ENVIRONMENTS as readonly string[]).includes(value);
}

/** Fill empty process variables from a file. Values already set by the shell or pipeline stay in place. */
function applyEnvFile(filePath: string) {
  if (!fs.existsSync(filePath)) return;
  for (const line of fs.readFileSync(filePath, 'utf8').split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim().replace(/^['"]|['"]$/g, '');
    if (!key || !value) continue;
    if (!process.env[key]?.trim()) process.env[key] = value;
  }
}

export function loadEnvironment(): EnvironmentName {
  const selected = (process.env.TEST_ENV?.trim() || 'support').toLowerCase();
  if (!isEnvironmentName(selected)) {
    throw new Error(`TEST_ENV must be one of: ${ENVIRONMENTS.join(', ')}.`);
  }
  process.env.TEST_ENV = selected;

  applyEnvFile(path.join(projectRoot, 'env', `${selected}.env`));
  if (selected === 'support') {
    applyEnvFile(path.join(projectRoot, '.env'));
  }

  const missing = REQUIRED_KEYS.filter((key) => !process.env[key]?.trim());
  if (missing.length > 0) {
    const where =
      selected === 'support'
        ? 'Set them in env/support.env, the root .env, or the process environment.'
        : `Set them in env/${selected}.env or the process environment. The root .env is not read for ${selected}.`;
    throw new Error(`Missing ${missing.join(', ')} for environment "${selected}". ${where}`);
  }
  return selected;
}

export function requireBaseUrl(): string {
  const baseUrl = process.env.BASE_URL?.trim();
  if (!baseUrl) throw new Error('BASE_URL is not set.');
  return baseUrl;
}
