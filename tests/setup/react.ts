import * as matchers from '@testing-library/jest-dom/matchers';
import { cleanup } from '@testing-library/react';
import { afterEach, beforeAll, beforeEach, expect, vi } from 'vitest';
import { loadRenderer } from '../../packages/toast/src/react/bindings.js';
import { motionControl } from '../support/motion-mock.js';

// jest-dom 7's /vitest entry still augments the pre-Vitest-5 Assertion generic.
// Register its public matchers without disabling dependency type checking.
expect.extend(matchers);

declare module 'vitest' {
  interface Matchers<R extends void | Promise<void> = void | Promise<void>, T = unknown>
    extends matchers.TestingLibraryMatchers<T, R> {}
}

afterEach(cleanup);

// Toaster loads its renderer chunk after mount; adapter tests start with it loaded, so the
// first render attaches synchronously. tests/react/lazy-renderer.test.tsx covers the cold path.
beforeAll(async () => { await loadRenderer(); });

// These adapter tests isolate focus/store/lease behavior from presentation time.
// jsdom has no layout; real geometry, delayed ack and physics are exercised by
// shell-motion unit tests and production browser checks, not this mock.
vi.mock('../../packages/toast/src/react/motion.js', async () => {
  const actual = await vi.importActual<typeof import('../../packages/toast/src/react/motion.js')>('../../packages/toast/src/react/motion.js');
  const { createShellMotionMock } = await import('../support/motion-mock.js');
  return { ...actual, createShellMotion: createShellMotionMock };
});
beforeEach(() => {
  motionControl.reset();
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(() => ({
    width: 352, height: 56, top: 0, left: 0, right: 352, bottom: 56, x: 0, y: 0, toJSON() {},
  }));
});
