import { test } from '@playwright/test';
import { formatUsDate } from './date';

export type StepMeta = {
  id: string;
  title: string;
  module: string;
  preconditions: string;
  expected: string;
  testData?: Record<string, string>;
};

/** Attach structured QA metadata used by the custom HTML reporter. */
export function annotateCase(meta: StepMeta) {
  const info = test.info();
  info.annotations.push({ type: 'testCaseId', description: meta.id });
  info.annotations.push({ type: 'title', description: meta.title });
  info.annotations.push({ type: 'module', description: meta.module });
  info.annotations.push({ type: 'preconditions', description: meta.preconditions });
  info.annotations.push({ type: 'expected', description: meta.expected });
  if (meta.testData) {
    const masked = Object.fromEntries(
      Object.entries(meta.testData).map(([key, value]) => [
        key,
        /password|secret|token/i.test(key) ? '********' : value,
      ]),
    );
    info.annotations.push({ type: 'testData', description: JSON.stringify(masked) });
  }
}

export function dateLabel(date: Date): string {
  return formatUsDate(date);
}
