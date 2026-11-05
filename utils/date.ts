export function addDays(from: Date, days: number): Date {
  const date = new Date(from);
  date.setHours(0, 0, 0, 0);
  date.setDate(date.getDate() + days);
  return date;
}

export function formatMonthYear(date: Date): string {
  return date.toLocaleString('en-US', { month: 'long', year: 'numeric' });
}

export function formatUsDate(date: Date): string {
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  const year = date.getFullYear();
  return `${month}/${day}/${year}`;
}
