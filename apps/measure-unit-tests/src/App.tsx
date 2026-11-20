import { Navigate, Route, Routes } from 'react-router-dom';

import { AppShell } from '@x10/shared/runtime';

import { ModelClientProvider } from './model-client';
import { AboutPage } from './pages/AboutPage';
import { BenchPage } from './pages/BenchPage';
import { RunPage } from './pages/RunPage';
import { ScopeIndex, ScopePage } from './pages/ScopePage';
import { ShortCircuitPage } from './pages/ShortCircuitPage';
import { SuiteDetailPage } from './pages/SuiteDetailPage';
import { RunProvider } from './run-context';

export function App() {
  return (
    <ModelClientProvider>
      <RunProvider>
        <Routes>
          <Route path="/" element={<AppShell immersive><BenchPage /></AppShell>} />
          <Route path="/suites/:suiteId" element={<AppShell wide><SuiteDetailPage /></AppShell>} />
          <Route path="/suites/:suiteId/history" element={<AppShell wide><ScopePage /></AppShell>} />
          <Route path="/scope" element={<AppShell><ScopeIndex /></AppShell>} />
          <Route path="/runs/:runId" element={<AppShell wide><RunPage /></AppShell>} />
          <Route path="/shorts" element={<AppShell><ShortCircuitPage /></AppShell>} />
          <Route path="/about" element={<AppShell><AboutPage /></AppShell>} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </RunProvider>
    </ModelClientProvider>
  );
}
