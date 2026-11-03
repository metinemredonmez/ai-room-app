// Loaded before anything else (first import in main.ts) so Sentry can hook Node's http module.
import { initMonitoring } from './common/monitoring.js';
import { loadConfig } from './config.js';

initMonitoring(loadConfig());
