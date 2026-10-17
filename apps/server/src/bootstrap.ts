import { loadServerEnv } from './env.js';

loadServerEnv();
await import('./index.js');
