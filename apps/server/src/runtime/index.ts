import type { WorldResponse } from '@ember/contracts';

export interface PreviewRuntime {
  getWorld(): WorldResponse;
}

export function createPreviewRuntime(initial: WorldResponse): PreviewRuntime {
  let world = structuredClone(initial);
  return {
    getWorld: () => structuredClone(world),
  };
}
