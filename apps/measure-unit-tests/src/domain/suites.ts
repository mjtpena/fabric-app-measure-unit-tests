/** Suites: list with stats, create, edit, delete. Only the creator or an admin edits a suite. */
import { PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { checkText } from '@x10/shared/lib';

import { limits, type Schema, type TestRun, type TestSuite } from '../model';
import { latestRun, passRate } from './runs';

export function isAdmin(me: Pick<Person, 'isAdmin'>): boolean {
  return me.isAdmin === true;
}

/** The suite's creator or an admin may edit the suite and its cases. */
export function canEditSuite(me: Pick<Person, 'sub' | 'isAdmin'>, suite: Pick<TestSuite, 'createdBy'>): boolean {
  return me.sub === suite.createdBy || isAdmin(me);
}

export interface SuiteInput {
  name: string;
  description: string;
}

export function checkSuite(input: SuiteInput): { name?: string; description?: string } {
  const out: { name?: string; description?: string } = {};
  const n = checkText(input.name, { ...limits.suiteName, label: 'Name' });
  if (n) out.name = n;
  const d = checkText(input.description, { max: limits.suiteDescription.max, optional: true, label: 'Description' });
  if (d) out.description = d;
  return out;
}

function assertValid(input: SuiteInput) {
  const errs = checkSuite(input);
  const first = errs.name ?? errs.description;
  if (first) throw new RuleError(first);
}

export interface SuiteSummary {
  suite: TestSuite;
  caseCount: number;
  enabledCount: number;
  lastRun: TestRun | null;
  /** Pass rate of the last finished run with results (0..1), or null. */
  lastPassRate: number | null;
}

export async function listSuites(store: DataStore<Schema>): Promise<SuiteSummary[]> {
  const [suites, cases, runs] = await Promise.all([
    store.repo('TestSuite').list({ orderBy: { field: 'name', dir: 'asc' } }),
    store.repo('TestCase').list(),
    store.repo('TestRun').list(),
  ]);
  return suites.map((suite) => {
    const mine = cases.filter((c) => c.suiteId === suite.id);
    const last = latestRun(runs.filter((r) => r.suiteId === suite.id));
    return {
      suite,
      caseCount: mine.length,
      enabledCount: mine.filter((c) => c.enabled).length,
      lastRun: last,
      lastPassRate: last ? passRate(last) : null,
    };
  });
}

export async function getSuite(store: DataStore<Schema>, id: string): Promise<TestSuite> {
  const s = await store.repo('TestSuite').get(id);
  if (!s) throw Object.assign(new Error('This suite was not found. It may have been deleted.'), { category: 'not_found' });
  return s;
}

export async function createSuite(store: DataStore<Schema>, me: Person, input: SuiteInput, now = new Date()): Promise<TestSuite> {
  assertValid(input);
  return store.repo('TestSuite').create({
    name: input.name.trim(),
    description: input.description.trim() || null,
    createdBy: me.sub,
    createdByName: me.displayName.slice(0, limits.personName.max),
    createdAt: now.toISOString(),
  });
}

export async function updateSuite(store: DataStore<Schema>, me: Person, id: string, input: SuiteInput): Promise<TestSuite> {
  const suite = await getSuite(store, id);
  if (!canEditSuite(me, suite)) throw new PermissionError('Only the suite owner or an admin can edit this suite.');
  assertValid(input);
  return store.repo('TestSuite').update(id, { name: input.name.trim(), description: input.description.trim() || null });
}

/** Delete a suite and its cases. Run history stays (runs and results are insert-only history). */
export async function deleteSuite(store: DataStore<Schema>, me: Person, id: string): Promise<void> {
  const suite = await getSuite(store, id);
  if (!canEditSuite(me, suite)) throw new PermissionError('Only the suite owner or an admin can delete this suite.');
  const cases = await store.repo('TestCase').list({ where: { suiteId: id } });
  for (const c of cases) await store.repo('TestCase').remove(c.id);
  await store.repo('TestSuite').remove(id);
}
