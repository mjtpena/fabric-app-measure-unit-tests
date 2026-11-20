import { date, entity, role, text, uuid } from '@microsoft/rayfin-core';

/**
 * A named group of measure tests. Everyone signed in reads suites and can create their own.
 * Only the creator can update or delete a suite at the database level; `createdBy` cannot be changed.
 * Admin overrides are checked in src/domain (there is no admin claim for row policies).
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.createdBy),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.createdBy),
  exclude: ['createdBy', 'createdAt'],
})
@role('authenticated', 'delete', {
  policy: (claims, item) => claims.sub.eq(item.createdBy),
})
export class TestSuite {
  @uuid() id!: string;
  @text({ min: 3, max: 80 }) name!: string;
  @text({ max: 500, optional: true }) description?: string;
  @text({ min: 1, max: 255 }) createdBy!: string;
  @text({ min: 1, max: 100 }) createdByName!: string;
  @date() createdAt!: Date;
}
