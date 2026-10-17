import { loadEnvFile } from 'node:process';

export const repositoryEnvFile = new URL('../../../.env', import.meta.url);

export function loadServerEnv(path: URL = repositoryEnvFile): void {
  try {
    loadEnvFile(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
}
