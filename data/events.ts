import { addDays } from '../utils/date';

const stamp = () => new Date().toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);

export function buildEventSetupData() {
  const id = stamp();
  const now = new Date();
  const scheduleDate = addDays(now, 45);
  // Recording: registration end datepicker, one next-month click, then day 10.
  const registrationEndDate = new Date(now.getFullYear(), now.getMonth() + 1, 10);
  // Recording: session datepicker stays on the open month and clicks day 2.
  const sessionDate = new Date(now.getFullYear(), now.getMonth(), 2);
  // Dec 12 and Dec 13 are already registered for this participant. today+43 is the next free day.
  const classScheduleDate = addDays(now, 43);
  const classRegistrationStartDate = new Date(now.getFullYear(), now.getMonth() - 1, 31);
  const classRegistrationEndDate = addDays(now, 15);

  return {
    eventTypeName: process.env.EVENT_TYPE_NAME || 'Decouple Event Type',
    existingWorkflowName: process.env.EXISTING_WORKFLOW_NAME || 'Admin Decouple Registration',
    workflowName: process.env.EXISTING_WORKFLOW_NAME || 'Admin Decouple Registration',
    eventName: `Test event decouple ${id}`,
    sessionName: `Test session ${id}`,
    className: `Test class ${id}`,
    defaultPrice: '10',
    classCapacity: process.env.CLASS_CAPACITY || '100',
    classPrice: process.env.CLASS_PRICE || '20',
    registrantCount: '100',
    scheduleDate,
    sessionDate,
    registrationEndDate,
    classScheduleDate,
    classRegistrationStartDate,
    classRegistrationEndDate,
    courseName: process.env.COURSE_NAME || 'Test Event sanity 1 Credit',
    classTypeName: process.env.CLASS_TYPE_NAME || 'Class Type for Parallel Event Reg',
    participantMatch: process.env.PARTICIPANT_MATCH || 'aaaman@yopmail.com',
    financeOrgName: process.env.FINANCE_ORG_NAME || 'ServiceBus Organization',
  };
}

export type EventSetupData = ReturnType<typeof buildEventSetupData>;
