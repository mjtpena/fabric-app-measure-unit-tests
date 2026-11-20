import { AppMarker } from './AppMarker.js';
import { Person } from './Person.js';
import { TestCase } from './TestCase.js';
import { TestResult } from './TestResult.js';
import { TestRun } from './TestRun.js';
import { TestSuite } from './TestSuite.js';

export type AppSchema = {
  Person: Person;
  AppMarker: AppMarker;
  TestSuite: TestSuite;
  TestCase: TestCase;
  TestRun: TestRun;
  TestResult: TestResult;
};

export const schema = [Person, AppMarker, TestSuite, TestCase, TestRun, TestResult];
