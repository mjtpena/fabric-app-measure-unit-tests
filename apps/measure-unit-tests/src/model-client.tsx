/**
 * One place that decides which ModelClient the app uses: the Rayfin connector in Fabric mode, the offline mock in
 * demo mode. Components call useModelClient() and never know which one they have.
 */
import { createContext, useContext, useMemo, type ReactNode } from 'react';

import { connectorModelClient, type ConnectorLike, type ModelClient } from '@x10/shared/connectors';
import { useApp } from '@x10/shared/runtime';

import { MOCK_LATENCY_MS, MODEL_LABEL } from './config';
import { createMockModelClient } from './mock-model';
import type { Schema } from './model';

const Ctx = createContext<ModelClient | null>(null);

function mockLatency(): number {
  const v = Number(import.meta.env.VITE_X10_MODEL_LATENCY ?? MOCK_LATENCY_MS);
  return Number.isFinite(v) && v >= 0 ? v : MOCK_LATENCY_MS;
}

export function ModelClientProvider({ children, client }: { children: ReactNode; client?: ModelClient }) {
  const app = useApp<Schema>();
  const value = useMemo<ModelClient>(() => {
    if (client) return client;
    if (app.mode === 'fabric') {
      const connector = (app.client?.connectors as { model?: ConnectorLike } | undefined)?.model;
      if (!connector) {
        return {
          label: MODEL_LABEL,
          executeQuery: async () => ({
            status: 'error',
            error: { category: 'api', message: 'The semantic model connector "model" is not configured in this build.' },
          }),
        };
      }
      return connectorModelClient(connector, MODEL_LABEL);
    }
    return createMockModelClient(mockLatency());
  }, [app.mode, app.client, client]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useModelClient(): ModelClient {
  const c = useContext(Ctx);
  if (!c) throw new Error('useModelClient must be used inside <ModelClientProvider>.');
  return c;
}
