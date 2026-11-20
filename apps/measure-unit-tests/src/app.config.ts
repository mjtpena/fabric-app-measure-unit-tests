/**
 * App configuration. No React imports here: tools/seed-fabric.mjs loads this file in Node to export seed rows.
 */
import { fabricSemanticModel } from '@microsoft/rayfin-connector-fabric-semanticmodel';
import { connectorsService } from '@microsoft/rayfin-connectors';
import type { Persona } from '@x10/shared/identity';
import type { AppConfig } from '@x10/shared/runtime';

import { connectorConfig, type ModelSchema } from '../rayfin/connectors/model/schema';
import { defs, type Schema } from './model';
import { seed } from './seed';

/** Connector map: the semantic model bound in rayfin.yml under the name `model`. */
export type AppConnectorsSchema = { model: ModelSchema };

export const personas: Persona[] = [
  { sub: 'demo-admin', name: 'Alex Rivera', email: 'alex@example.com', isAdmin: true, role: 'Admin, suite owner' },
  { sub: 'demo-user', name: 'Sam Taylor', email: 'sam@example.com', isAdmin: false, role: 'BI developer' },
];

export const config: AppConfig<Schema> = {
  appId: 'measure-unit-tests',
  title: 'Measure Unit Tests',
  tagline: 'Regression tests for your DAX measures.',
  defs,
  personas,
  seed,
  accent: 'indigo',
  // A chip with a probe on one pin: the test bench.
  logoPaths: ['M7 6h8a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H7a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1Z', 'M9 3v3', 'M13 3v3', 'M9 18v3', 'M13 18v3', 'M3 10h3', 'M3 14h3', 'M16 12h3', 'M21 12h.01'],
  nav: [
    { to: '/', label: 'Bench', end: true },
    { to: '/scope', label: 'Oscilloscope' },
    { to: '/shorts', label: 'Short circuit' },
    { to: '/about', label: 'About' },
  ],
  fabric: {
    extraServices: () => ({
      connectors: connectorsService<AppConnectorsSchema>({
        configs: { model: connectorConfig },
        runtime: { model: fabricSemanticModel() },
      }),
    }),
  },
};
