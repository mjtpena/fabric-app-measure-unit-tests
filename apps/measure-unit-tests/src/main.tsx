import { Activity, CircuitBoard, Info, Zap } from 'lucide-react';
import type { ReactNode } from 'react';

import { mountApp } from '@x10/shared/runtime';

import { App } from './App';
import { config } from './app.config';
import './index.css';

/** Phone tab-bar icons (kept out of app.config.ts, which the seed tools load in Node). */
const ICONS: Record<string, ReactNode> = {
  '/': <CircuitBoard />,
  '/scope': <Activity />,
  '/shorts': <Zap />,
  '/about': <Info />,
};

mountApp({ ...config, nav: config.nav.map((n) => ({ ...n, icon: ICONS[n.to] })) }, <App />);
