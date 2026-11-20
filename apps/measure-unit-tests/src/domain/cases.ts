/** Test cases: validation, list with last result, create, edit, enable/disable, delete. */
import { PermissionError, RuleError, type DataStore } from '@x10/shared/data';
import type { Person } from '@x10/shared/identity';
import { checkText, commaList } from '@x10/shared/lib';

import { limits, type CaseKind, type Schema, type TestCase, type TestResult } from '../model';
import { checkExpectation } from './compare';
import { checkRawDax } from './dax';
import { lastResultByCase } from './runs';
import { canEditSuite, getSuite } from './suites';

export interface CaseInput {
  name: string;
  kind: CaseKind;
  dax: string;
  expected: string;
  tolerance: string;
  tags: string;
  enabled: boolean;
}

export type CaseErrors = Partial<Record<'name' | 'dax' | 'expected' | 'tolerance' | 'tags', string>>;

export function checkCase(input: CaseInput): CaseErrors {
  const out: CaseErrors = {};
  const name = checkText(input.name, { ...limits.caseName, label: 'Name' });
  if (name) out.name = name;
  const dax = checkRawDax(input.dax);
  if (dax) out.dax = dax;
  Object.assign(out, checkExpectation(input.kind, input.expected, usesTolerance(input.kind) ? input.tolerance : ''));
  const tags = checkText(input.tags, { max: limits.tags.max, optional: true, label: 'Tags' });
  if (tags) out.tags = tags;
  return out;
}

export const usesExpected = (kind: CaseKind) => kind !== 'notblank';
export const usesTolerance = (kind: CaseKind) => kind === 'scalar';

/** Tidy tags: trimmed, de-duplicated, comma separated. */
export function normalizeTags(tags: string): string | null {
  const list = [...new Set(commaList(tags))];
  return list.length ? list.join(', ') : null;
}

function toRow(input: CaseInput) {
  const errs = checkCase(input);
  const first = Object.values(errs)[0];
  if (first) throw new RuleError(first);
  return {
    name: input.name.trim(),
    kind: input.kind,
    dax: input.dax.trim(),
    expected: usesExpected(input.kind) ? input.expected.trim() || null : null,
    tolerance: usesTolerance(input.kind) ? input.tolerance.trim() || null : null,
    tags: normalizeTags(input.tags),
    enabled: input.enabled,
  };
}

export interface CaseRow {
  testCase: TestCase;
  last: TestResult | null;
}

/** Cases of a suite in creation order, each with its most recent result. */
export async function listCases(store: DataStore<Schema>, suiteId: string): Promise<CaseRow[]> {
  const [cases, results] = await Promise.all([
    store.repo('TestCase').list({ where: { suiteId } }),
    store.repo('TestResult').list({ where: { suiteId } }),
  ]);
  const last = lastResultByCase(results);
  return cases
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.name.localeCompare(b.name))
    .map((c) => ({ testCase: c, last: last.get(c.id) ?? null }));
}

async function editableSuite(store: DataStore<Schema>, me: Person, suiteId: string) {
  const suite = await getSuite(store, suiteId);
  if (!canEditSuite(me, suite)) throw new PermissionError('Only the suite owner or an admin can change its cases.');
  return suite;
}

async function editableCase(store: DataStore<Schema>, me: Person, id: string) {
  const c = await store.repo('TestCase').get(id);
  if (!c) throw new RuleError('This case no longer exists.');
  await editableSuite(store, me, c.suiteId);
  return c;
}

export async function createCase(
  store: DataStore<Schema>,
  me: Person,
  suiteId: string,
  input: CaseInput,
  now = new Date(),
): Promise<TestCase> {
  const suite = await editableSuite(store, me, suiteId);
  const row = toRow(input);
  const at = now.toISOString();
  // ownerSub is the suite owner's sub, so the row policy lets the owner (not just the author) maintain the case.
  return store.repo('TestCase').create({ ...row, suiteId, ownerSub: suite.createdBy, createdAt: at, updatedAt: at });
}

export async function updateCase(store: DataStore<Schema>, me: Person, id: string, input: CaseInput, now = new Date()): Promise<TestCase> {
  await editableCase(store, me, id);
  return store.repo('TestCase').update(id, { ...toRow(input), updatedAt: now.toISOString() });
}

export async function setCaseEnabled(store: DataStore<Schema>, me: Person, id: string, enabled: boolean, now = new Date()): Promise<TestCase> {
  await editableCase(store, me, id);
  return store.repo('TestCase').update(id, { enabled, updatedAt: now.toISOString() });
}

export async function deleteCase(store: DataStore<Schema>, me: Person, id: string): Promise<void> {
  await editableCase(store, me, id);
  await store.repo('TestCase').remove(id);
}

/** Blank form values. */
export function emptyCaseInput(): CaseInput {
  return { name: '', kind: 'scalar', dax: '', expected: '', tolerance: '', tags: '', enabled: true };
}

export function caseToInput(c: TestCase): CaseInput {
  return {
    name: c.name,
    kind: c.kind,
    dax: c.dax,
    expected: c.expected ?? '',
    tolerance: c.tolerance ?? '',
    tags: c.tags ?? '',
    enabled: c.enabled,
  };
}
