/**
 * App data types and runtime entity definitions. Keep these in step with rayfin/data/*.ts:
 * every field listed here must exist on the entity class with the matching decorator.
 * Dates are ISO strings in the app; optional fields are `| null`.
 */
import type { EntityDefs } from '@x10/shared/data';
import { AppMarkerDef, PersonDef, type AppMarker, type Person } from '@x10/shared/identity';

/** The same numbers as the @text / @int decorators on the entities. */
export const limits = {
  suiteName: { min: 3, max: 80 },
  suiteDescription: { max: 500 },
  caseName: { min: 3, max: 120 },
  dax: { min: 1, max: 4000 },
  expected: { max: 200 },
  tolerance: { max: 40 },
  tags: { max: 200 },
  actual: { max: 400 },
  message: { max: 1000 },
  personName: { max: 100 },
  /** Measure-mode inputs (they become part of the DAX). */
  measure: { min: 1, max: 200 },
  filter: { max: 1000 },
} as const;

export const CASE_KINDS = ['scalar', 'rowcount', 'notblank', 'between'] as const;
export type CaseKind = (typeof CASE_KINDS)[number];

export const RESULT_STATUSES = ['pass', 'fail', 'error'] as const;
export type ResultStatus = (typeof RESULT_STATUSES)[number];

export const RUN_STATUSES = ['running', 'done', 'cancelled'] as const;
export type RunStatus = (typeof RUN_STATUSES)[number];

export interface TestSuite {
  id: string;
  name: string;
  description: string | null;
  createdBy: string;
  createdByName: string;
  createdAt: string;
}

export interface TestCase {
  id: string;
  suiteId: string;
  name: string;
  kind: CaseKind;
  dax: string;
  expected: string | null;
  tolerance: string | null;
  /** Comma list. */
  tags: string | null;
  enabled: boolean;
  /** The owning suite's createdBy (denormalised for the row policy). */
  ownerSub: string;
  createdAt: string;
  updatedAt: string;
}

export interface TestRun {
  id: string;
  suiteId: string;
  startedAt: string;
  finishedAt: string | null;
  startedBy: string;
  startedByName: string;
  status: RunStatus;
  /** Cases queued for this run. */
  caseCount: number;
  /** Disabled cases skipped by a full-suite run. */
  disabledCount: number;
  passCount: number;
  failCount: number;
  errorCount: number;
}

export interface TestResult {
  id: string;
  runId: string;
  suiteId: string;
  caseId: string;
  caseName: string;
  kind: CaseKind;
  status: ResultStatus;
  expected: string | null;
  actual: string | null;
  message: string | null;
  durationMs: number;
  startedBy: string;
  createdAt: string;
}

export type Schema = {
  Person: Person;
  AppMarker: AppMarker;
  TestSuite: TestSuite;
  TestCase: TestCase;
  TestRun: TestRun;
  TestResult: TestResult;
};

export const defs: EntityDefs<Schema> = {
  Person: PersonDef,
  AppMarker: AppMarkerDef,
  TestSuite: {
    name: 'TestSuite',
    fields: { id: 'uuid', name: 'text', description: 'text', createdBy: 'text', createdByName: 'text', createdAt: 'date' },
  },
  TestCase: {
    name: 'TestCase',
    fields: {
      id: 'uuid',
      suiteId: 'uuid',
      name: 'text',
      kind: 'set',
      dax: 'text',
      expected: 'text',
      tolerance: 'text',
      tags: 'text',
      enabled: 'bool',
      ownerSub: 'text',
      createdAt: 'date',
      updatedAt: 'date',
    },
  },
  TestRun: {
    name: 'TestRun',
    fields: {
      id: 'uuid',
      suiteId: 'uuid',
      startedAt: 'date',
      finishedAt: 'date',
      startedBy: 'text',
      startedByName: 'text',
      status: 'set',
      caseCount: 'int',
      disabledCount: 'int',
      passCount: 'int',
      failCount: 'int',
      errorCount: 'int',
    },
  },
  TestResult: {
    name: 'TestResult',
    fields: {
      id: 'uuid',
      runId: 'uuid',
      suiteId: 'uuid',
      caseId: 'uuid',
      caseName: 'text',
      kind: 'set',
      status: 'set',
      expected: 'text',
      actual: 'text',
      message: 'text',
      durationMs: 'int',
      startedBy: 'text',
      createdAt: 'date',
    },
  },
};
