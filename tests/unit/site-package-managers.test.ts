import { describe, expect, it } from 'vitest';
import { GET_STARTED } from '../../apps/site/src/lib/get-started';
import { commandFor, isPackageManager, PACKAGE_MANAGERS } from '../../apps/site/src/lib/package-managers';

describe('install commands in every package manager', () => {
  it('translates an npm install', () => {
    expect(PACKAGE_MANAGERS.map((manager) => commandFor('npm install @cloudlet/toast', manager))).toEqual([
      'npm install @cloudlet/toast',
      'pnpm add @cloudlet/toast',
      'yarn add @cloudlet/toast',
      'bun add @cloudlet/toast',
    ]);
  });

  it('translates npx the way the shadcn documentation does', () => {
    const command = 'npx shadcn@latest add https://cloudlet.dev/r/toaster.json';
    expect(PACKAGE_MANAGERS.map((manager) => commandFor(command, manager))).toEqual([
      command,
      'pnpm dlx shadcn@latest add https://cloudlet.dev/r/toaster.json',
      'yarn dlx shadcn@latest add https://cloudlet.dev/r/toaster.json',
      'bunx --bun shadcn@latest add https://cloudlet.dev/r/toaster.json',
    ]);
  });

  it('knows every Get started command and refuses forms it cannot translate', () => {
    for (const tab of GET_STARTED) for (const manager of PACKAGE_MANAGERS) expect(() => commandFor(tab.command, manager)).not.toThrow();
    expect(() => commandFor('npm run build', 'pnpm')).toThrow(/No package manager translation/u);
  });

  it('accepts only the four managers as a stored choice', () => {
    expect(isPackageManager('pnpm')).toBe(true);
    expect(isPackageManager('deno')).toBe(false);
    expect(isPackageManager(null)).toBe(false);
  });
});
