import { date, entity, int, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * The outcome of one case in one run. Case name, kind and expected value are snapshots taken at run time, so history
 * stays readable after a case is edited or deleted. Insert-only: written by the person running the suite.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.startedBy),
})
export class TestResult {
  @uuid() id!: string;
  @uuid() runId!: string;
  @uuid() suiteId!: string;
  @uuid() caseId!: string;
  @text({ min: 1, max: 120 }) caseName!: string;
  @set('scalar', 'rowcount', 'notblank', 'between') kind!: 'scalar' | 'rowcount' | 'notblank' | 'between';
  @set('pass', 'fail', 'error') status!: 'pass' | 'fail' | 'error';
  @text({ max: 200, optional: true }) expected?: string;
  @text({ max: 400, optional: true }) actual?: string;
  @text({ max: 1000, optional: true }) message?: string;
  @int() durationMs!: number;
  @text({ min: 1, max: 255 }) startedBy!: string;
  @date() createdAt!: Date;
}
