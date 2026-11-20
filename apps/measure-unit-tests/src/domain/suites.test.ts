import { FIXED_NOW, testStore } from '@x10/shared/test';

import { personas } from '../app.config';
import { defs } from '../model';
import { seed, SEED_CASES } from '../seed';
import { checkCase, createCase, deleteCase, emptyCaseInput, listCases, normalizeTags, setCaseEnabled, updateCase } from './cases';
import { canEditSuite, checkSuite, createSuite, deleteSuite, listSuites, updateSuite } from './suites';

async function setup() {
  const store = await testStore(defs, { personas, fn: seed, now: FIXED_NOW });
  const people = await store.repo('Person').list();
  return {
    store,
    owner: people.find((p) => p.sub === 'demo-admin')!,
    user: people.find((p) => p.sub === 'demo-user')!,
    suite: (await store.repo('TestSuite').list())[0],
  };
}

const measureCase = { ...emptyCaseInput(), name: 'Units sold', dax: 'EVALUATE ROW("v", [Units])', expected: '963' };

describe('suites', () => {
  it('validates name and description with the entity limits', () => {
    expect(checkSuite({ name: 'ab', description: '' }).name).toMatch(/at least 3/);
    expect(checkSuite({ name: 'x'.repeat(81), description: '' }).name).toMatch(/80/);
    expect(checkSuite({ name: 'Sales', description: 'x'.repeat(501) }).description).toMatch(/500/);
    expect(checkSuite({ name: 'Sales', description: '' })).toEqual({});
  });

  it('lists the seeded suite with stats', async () => {
    const { store } = await setup();
    const [s] = await listSuites(store);
    expect(s.suite.name).toBe('Sales sanity');
    expect(s.caseCount).toBe(8);
    expect(s.enabledCount).toBe(7);
    expect(s.lastRun?.passCount).toBe(5);
    expect(s.lastPassRate).toBeCloseTo(5 / 7);
  });

  it('anyone signed in creates a suite they own', async () => {
    const { store, user } = await setup();
    const s = await createSuite(store, user, { name: '  Inventory  ', description: '' }, FIXED_NOW);
    expect(s).toMatchObject({ name: 'Inventory', description: null, createdBy: 'demo-user', createdByName: 'Sam Taylor' });
    await expect(createSuite(store, user, { name: 'no', description: '' })).rejects.toThrow(/at least 3/);
  });

  it('only the creator or an admin edits or deletes a suite', async () => {
    const { store, owner, user, suite } = await setup();
    expect(canEditSuite(owner, suite)).toBe(true);
    expect(canEditSuite(user, suite)).toBe(false);
    expect(canEditSuite({ sub: 'someone-else', isAdmin: true }, suite)).toBe(true);
    await expect(updateSuite(store, user, suite.id, { name: 'Hijacked', description: '' })).rejects.toThrow(/owner or an admin/);
    await expect(deleteSuite(store, user, suite.id)).rejects.toThrow(/owner or an admin/);
    const mine = await createSuite(store, user, { name: 'Sam suite', description: '' });
    await expect(updateSuite(store, owner, mine.id, { name: 'Admin renamed', description: 'ok' })).resolves.toMatchObject({ name: 'Admin renamed' });
  });

  it('deleting a suite removes its cases and keeps run history', async () => {
    const { store, owner, suite } = await setup();
    const runsBefore = (await store.repo('TestRun').list()).length;
    await deleteSuite(store, owner, suite.id);
    expect(await store.repo('TestSuite').get(suite.id)).toBeNull();
    expect(await store.repo('TestCase').list({ where: { suiteId: suite.id } })).toHaveLength(0);
    expect((await store.repo('TestRun').list()).length).toBe(runsBefore);
  });
});

describe('cases', () => {
  it('checkCase covers name, DAX guard, expectation and tags', () => {
    expect(checkCase({ ...measureCase, name: 'ab' }).name).toBeTruthy();
    expect(checkCase({ ...measureCase, dax: 'SELECT 1' }).dax).toMatch(/EVALUATE or DEFINE/);
    expect(checkCase({ ...measureCase, expected: '' }).expected).toBeTruthy();
    expect(checkCase({ ...measureCase, tags: 'x'.repeat(201) }).tags).toBeTruthy();
    expect(checkCase({ ...measureCase, kind: 'notblank', expected: '' })).toEqual({});
    expect(checkCase({ ...measureCase, kind: 'rowcount', tolerance: 'garbage' })).toEqual({});
    expect(checkCase(measureCase)).toEqual({});
  });

  it('normalizes tags', () => {
    expect(normalizeTags(' sales,finance , sales,, ')).toBe('sales, finance');
    expect(normalizeTags(' , ')).toBeNull();
  });

  it('lists cases in order with their last result', async () => {
    const { store, suite } = await setup();
    const rows = await listCases(store, suite.id);
    expect(rows.map((r) => r.testCase.name)).toEqual(SEED_CASES.map((c) => c.name));
    expect(rows.find((r) => r.testCase.name.startsWith('Sales for 2025'))!.last?.status).toBe('fail');
    expect(rows.find((r) => r.testCase.name.startsWith('Revenue YTD'))!.last?.status).toBe('error');
    expect(rows.find((r) => !r.testCase.enabled)!.last).toBeNull();
  });

  it('the owner adds a case; ownerSub is the suite owner; other users cannot', async () => {
    const { store, owner, user, suite } = await setup();
    const c = await createCase(store, owner, suite.id, { ...measureCase, kind: 'notblank', expected: 'ignored', tolerance: '1%' }, FIXED_NOW);
    expect(c).toMatchObject({ ownerSub: 'demo-admin', suiteId: suite.id, expected: null, tolerance: null, enabled: true });
    await expect(createCase(store, user, suite.id, measureCase)).rejects.toThrow(/owner or an admin/);
    await expect(updateCase(store, user, c.id, measureCase)).rejects.toThrow(/owner or an admin/);
    await expect(setCaseEnabled(store, user, c.id, false)).rejects.toThrow(/owner or an admin/);
    await expect(deleteCase(store, user, c.id)).rejects.toThrow(/owner or an admin/);
  });

  it('an admin adding a case to another person’s suite keeps the suite owner as ownerSub', async () => {
    const { store, owner, user } = await setup();
    const sams = await createSuite(store, user, { name: 'Sam suite', description: '' });
    const c = await createCase(store, owner, sams.id, measureCase);
    expect(c.ownerSub).toBe('demo-user');
  });

  it('update, toggle and delete', async () => {
    const { store, owner, suite } = await setup();
    const c = await createCase(store, owner, suite.id, measureCase, FIXED_NOW);
    const later = new Date(FIXED_NOW.getTime() + 60_000);
    const u = await updateCase(store, owner, c.id, { ...measureCase, name: 'Units sold (all years)', tags: 'units' }, later);
    expect(u).toMatchObject({ name: 'Units sold (all years)', tags: 'units', updatedAt: later.toISOString() });
    expect((await setCaseEnabled(store, owner, c.id, false)).enabled).toBe(false);
    await deleteCase(store, owner, c.id);
    expect(await store.repo('TestCase').get(c.id)).toBeNull();
    await expect(updateCase(store, owner, c.id, measureCase)).rejects.toThrow(/no longer exists/);
  });
});
