import fs from 'node:fs';
import path from 'node:path';
import type {
  FullConfig,
  FullResult,
  Reporter,
  Suite,
  TestCase,
  TestResult,
  TestStep,
} from '@playwright/test/reporter';

type CaseRow = {
  id: string;
  title: string;
  module: string;
  preconditions: string;
  steps: string[];
  testData: string;
  expected: string;
  actual: string;
  status: 'Passed' | 'Failed' | 'Blocked' | 'Skipped';
  durationMs: number;
  failureDetails: string;
  evidence: string[];
  file: string;
};

function annotation(test: TestCase, type: string): string {
  return test.annotations.find((item) => item.type === type)?.description ?? '';
}

function isNoiseStep(title: string): boolean {
  return /^(Before Hooks|After Hooks|Worker Cleanup|Fixture |Launch browser|Create context|Create page|Close context|Hook)/i.test(
    title,
  );
}

function collectSteps(steps: TestStep[]): string[] {
  const lines: string[] = [];
  const walk = (items: TestStep[]) => {
    for (const step of items) {
      if (isNoiseStep(step.title)) {
        if (step.steps?.length) walk(step.steps);
        continue;
      }
      // Prefer business steps created with test.step(...)
      if (/^Step\s+\d+:/i.test(step.title) || /^(Open|Submit|Verify|Create|Enable|Add|Navigate)/i.test(step.title)) {
        lines.push(step.title);
        continue;
      }
      if (step.steps?.length) walk(step.steps);
    }
  };
  walk(steps);
  return lines;
}

function statusLabel(status: TestResult['status']): CaseRow['status'] {
  if (status === 'passed') return 'Passed';
  if (status === 'skipped') return 'Skipped';
  if (status === 'timedOut' || status === 'interrupted') return 'Blocked';
  return 'Failed';
}

class QaHtmlReporter implements Reporter {
  private rows: CaseRow[] = [];
  private outputDir = path.resolve(process.cwd(), 'playwright-report');
  private startedAt = new Date();

  onBegin(config: FullConfig, _suite: Suite) {
    this.outputDir = config.reporter.find((item) => Array.isArray(item) && item[0] === 'html')
      ? path.resolve(process.cwd(), 'playwright-report')
      : path.resolve(process.cwd(), 'playwright-report');
    this.startedAt = new Date();
  }

  onTestEnd(test: TestCase, result: TestResult) {
    const steps = collectSteps(result.steps);
    const attachments = result.attachments
      .filter((item) => item.path || item.body)
      .map((item) => item.path || `${item.name} (${item.contentType})`);

    const expected = annotation(test, 'expected') || 'See test steps and assertions.';
    const failedStep = steps.length && result.status !== 'passed'
      ? `Failed during: ${steps[steps.length - 1]}`
      : '';
    const actual =
      result.status === 'passed'
        ? 'Application behaved as expected. All step assertions passed.'
        : [failedStep, result.error?.message?.split('\n')[0] || 'Test did not complete successfully.']
            .filter(Boolean)
            .join(' | ');

    this.rows.push({
      id: annotation(test, 'testCaseId') || test.id.slice(0, 8).toUpperCase(),
      title: annotation(test, 'title') || test.title,
      module: annotation(test, 'module') || path.basename(path.dirname(test.location.file)),
      preconditions: annotation(test, 'preconditions') || 'Application reachable; credentials configured in .env',
      steps: steps.length
        ? steps.map((step, index) => `${index + 1}. ${step}`)
        : [`1. ${test.title}`],
      testData: annotation(test, 'testData') || '{}',
      expected,
      actual,
      status: statusLabel(result.status),
      durationMs: result.duration,
      failureDetails: result.error?.stack || result.error?.message || '',
      evidence: attachments,
      file: path.relative(process.cwd(), test.location.file),
    });
  }

  async onEnd(result: FullResult) {
    fs.mkdirSync(this.outputDir, { recursive: true });
    const endedAt = new Date();
    const total = this.rows.length;
    const passed = this.rows.filter((row) => row.status === 'Passed').length;
    const failed = this.rows.filter((row) => row.status === 'Failed').length;
    const blocked = this.rows.filter((row) => row.status === 'Blocked').length;
    const skipped = this.rows.filter((row) => row.status === 'Skipped').length;
    const passPct = total ? ((passed / total) * 100).toFixed(1) : '0.0';

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>QA Test Execution Report</title>
  <style>
    :root { --ok:#0f7b3a; --fail:#b42318; --block:#b54708; --skip:#475467; --bg:#f8fafc; --card:#fff; --line:#e4e7ec; }
    body { font-family: Segoe UI, Arial, sans-serif; margin:0; background:var(--bg); color:#101828; }
    header { background:#102a43; color:#fff; padding:24px 32px; }
    header h1 { margin:0 0 8px; font-size:28px; }
    header p { margin:4px 0; opacity:.9; }
    main { padding:24px 32px 48px; }
    .summary { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin-bottom:24px; }
    .card { background:var(--card); border:1px solid var(--line); border-radius:12px; padding:16px; }
    .card strong { display:block; font-size:28px; margin-top:4px; }
    .ok { color:var(--ok); } .fail { color:var(--fail); } .block { color:var(--block); } .skip { color:var(--skip); }
    table { width:100%; border-collapse:collapse; background:var(--card); border:1px solid var(--line); border-radius:12px; overflow:hidden; }
    th, td { border-bottom:1px solid var(--line); padding:12px 14px; vertical-align:top; text-align:left; font-size:14px; }
    th { background:#f2f4f7; font-weight:600; }
    tr:last-child td { border-bottom:none; }
    .badge { display:inline-block; padding:4px 10px; border-radius:999px; font-weight:600; font-size:12px; }
    .badge.Passed { background:#dcfae6; color:var(--ok); }
    .badge.Failed { background:#fee4e2; color:var(--fail); }
    .badge.Blocked { background:#fef0c7; color:var(--block); }
    .badge.Skipped { background:#e4e7ec; color:var(--skip); }
    ol { margin:0; padding-left:18px; }
    pre { white-space:pre-wrap; word-break:break-word; background:#f9fafb; padding:10px; border-radius:8px; border:1px solid var(--line); }
    code { background:#f2f4f7; padding:1px 4px; border-radius:4px; }
  </style>
</head>
<body>
  <header>
    <h1>QA Test Execution Report</h1>
    <p>Project: Automation-Event (Playwright)</p>
    <p>Started: ${this.startedAt.toLocaleString()} | Ended: ${endedAt.toLocaleString()} | Overall: ${result.status.toUpperCase()}</p>
  </header>
  <main>
    <section class="summary">
      <div class="card">Total<strong>${total}</strong></div>
      <div class="card">Passed<strong class="ok">${passed}</strong></div>
      <div class="card">Failed<strong class="fail">${failed}</strong></div>
      <div class="card">Blocked<strong class="block">${blocked}</strong></div>
      <div class="card">Skipped<strong class="skip">${skipped}</strong></div>
      <div class="card">Pass %<strong>${passPct}%</strong></div>
    </section>
    <table>
      <thead>
        <tr>
          <th>Test Case ID</th>
          <th>Test Case Title</th>
          <th>Module / Page</th>
          <th>Preconditions</th>
          <th>Test Steps</th>
          <th>Test Data</th>
          <th>Expected Result</th>
          <th>Actual Result</th>
          <th>Status</th>
          <th>Execution Time</th>
          <th>Failure Details</th>
          <th>Evidence</th>
        </tr>
      </thead>
      <tbody>
        ${this.rows
          .map(
            (row) => `<tr>
          <td><code>${escapeHtml(row.id)}</code></td>
          <td><strong>${escapeHtml(row.title)}</strong><div><small>${escapeHtml(row.file)}</small></div></td>
          <td>${escapeHtml(row.module)}</td>
          <td>${escapeHtml(row.preconditions)}</td>
          <td><ol>${row.steps.map((step) => `<li>${escapeHtml(step.replace(/^\d+(\.\d+)*\.\s*/, ''))}</li>`).join('')}</ol></td>
          <td><pre>${escapeHtml(prettyJson(row.testData))}</pre></td>
          <td>${escapeHtml(row.expected)}</td>
          <td>${escapeHtml(row.actual)}</td>
          <td><span class="badge ${row.status}">${row.status}</span></td>
          <td>${(row.durationMs / 1000).toFixed(1)}s</td>
          <td>${row.failureDetails ? `<pre>${escapeHtml(row.failureDetails)}</pre>` : '-'}</td>
          <td>${
            row.evidence.length
              ? row.evidence.map((item) => `<div><code>${escapeHtml(item)}</code></div>`).join('')
              : '-'
          }</td>
        </tr>`,
          )
          .join('\n')}
      </tbody>
    </table>
  </main>
</body>
</html>`;

    const outFile = path.join(this.outputDir, 'qa-report.html');
    fs.writeFileSync(outFile, html, 'utf8');
    const jsonFile = path.join(this.outputDir, 'qa-report.json');
    fs.writeFileSync(
      jsonFile,
      JSON.stringify(
        {
          startedAt: this.startedAt,
          endedAt,
          overall: result.status,
          totals: { total, passed, failed, blocked, skipped, passPct },
          cases: this.rows,
        },
        null,
        2,
      ),
      'utf8',
    );
    console.log(`QA report written to ${outFile}`);
  }
}

function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;');
}

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default QaHtmlReporter;
