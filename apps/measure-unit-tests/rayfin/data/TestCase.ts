import { boolean, date, entity, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * One measure test. `ownerSub` is the owning suite's `createdBy`, denormalised so the row policy can protect cases
 * at the database level: only the suite owner can create, update or delete them, and a case cannot be moved to
 * another suite or handed to another owner.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
  exclude: ['ownerSub', 'suiteId', 'createdAt'],
})
@role('authenticated', 'delete', {
  policy: (claims, item) => claims.sub.eq(item.ownerSub),
})
export class TestCase {
  @uuid() id!: string;
  @uuid() suiteId!: string;
  @text({ min: 3, max: 120 }) name!: string;
  @set('scalar', 'rowcount', 'notblank', 'between') kind!: 'scalar' | 'rowcount' | 'notblank' | 'between';
  @text({ min: 1, max: 4000 }) dax!: string;
  @text({ max: 200, optional: true }) expected?: string;
  @text({ max: 40, optional: true }) tolerance?: string;
  @text({ max: 200, optional: true }) tags?: string;
  @boolean() enabled!: boolean;
  @text({ min: 1, max: 255 }) ownerSub!: string;
  @date() createdAt!: Date;
  @date() updatedAt!: Date;
}
