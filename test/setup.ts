import { beforeEach, afterEach, vi } from 'vitest';
beforeEach(() => vi.stubGlobal('fetch', vi.fn(() => { throw new Error('Network disabled in unit tests; install a fixture mock'); })));
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
