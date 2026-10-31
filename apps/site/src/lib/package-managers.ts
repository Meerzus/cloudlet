/**
 * The package managers the site shows install commands for. Every one of them installs from the npm
 * registry, so the commands are written once in npm form (README, GET_STARTED) and translated here.
 */
export const PACKAGE_MANAGERS = ['npm', 'pnpm', 'yarn', 'bun'] as const;
export type PackageManager = (typeof PACKAGE_MANAGERS)[number];

const INSTALL: Record<PackageManager, string> = { npm: 'npm install', pnpm: 'pnpm add', yarn: 'yarn add', bun: 'bun add' };
/** Running a package without installing it, as the shadcn documentation writes it for each manager. */
const EXECUTE: Record<PackageManager, string> = { npm: 'npx', pnpm: 'pnpm dlx', yarn: 'yarn dlx', bun: 'bunx --bun' };

/** `npm install …` and `npx …` in the given manager's words; anything else throws, so a new command form is noticed. */
export function commandFor(command: string, manager: PackageManager): string {
  const install = /^npm (?:install|i) (.+)$/u.exec(command);
  if (install) return `${INSTALL[manager]} ${install[1]}`;
  const execute = /^npx (.+)$/u.exec(command);
  if (execute) return `${EXECUTE[manager]} ${execute[1]}`;
  throw new Error(`No package manager translation for "${command}"`);
}

export function isPackageManager(value: unknown): value is PackageManager {
  return typeof value === 'string' && (PACKAGE_MANAGERS as readonly string[]).includes(value);
}
