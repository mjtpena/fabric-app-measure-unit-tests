import { date, entity, int, role, set, text, uuid } from '@microsoft/rayfin-core';

/**
 * One execution of a suite (or of selected cases). Anyone signed in can start a run; only the person who started it
 * can update it (the counts and finish time), and the starter, suite and start time cannot be changed.
 * Runs are history: nobody deletes them through the API.
 */
@entity()
@role('authenticated', 'read')
@role('authenticated', 'create', {
  policy: (claims, item) => claims.sub.eq(item.startedBy),
})
@role('authenticated', 'update', {
  policy: (claims, item) => claims.sub.eq(item.startedBy),
  exclude: ['startedBy', 'suiteId', 'startedAt'],
})
export class TestRun {
  @uuid() id!: string;
  @uuid() suiteId!: string;
  @date() startedAt!: Date;
  @date({ optional: true }) finishedAt?: Date;
  @text({ min: 1, max: 255 }) startedBy!: string;
  @text({ min: 1, max: 100 }) startedByName!: string;
  @set('running', 'done', 'cancelled') status!: 'running' | 'done' | 'cancelled';
  @int() caseCount!: number;
  @int() disabledCount!: number;
  @int() passCount!: number;
  @int() failCount!: number;
  @int() errorCount!: number;
}
