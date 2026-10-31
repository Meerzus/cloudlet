import { highlight } from 'fumadocs-core/highlight';
import type { ComponentProps, ReactNode } from 'react';
import { Tabs } from '@/components/site/tabs';
import { GET_STARTED, type GetStartedTab } from '@/lib/get-started';
import { commandFor, PACKAGE_MANAGERS, type PackageManager } from '@/lib/package-managers';
import { SHIKI_THEME } from '@/lib/shiki-theme';
import { CodeBlock } from './code-block';
import { PackageManagerCode } from './package-manager-code';

/**
 * Get started of the landing, on documentation pages: the commands and examples
 * come from `GET_STARTED`, which site-get-started.test.ts keeps equal to the package README
 * and the registry README, so the pages carry no copy of them. Highlighted on the server with the
 * same Shiki theme as the MDX fences and rendered in the same code block.
 */
async function Code({ code, lang, title }: { code: string; lang: 'sh' | 'tsx'; title: string }) {
  return highlight(code, {
    lang,
    themes: { light: SHIKI_THEME },
    defaultColor: 'light',
    components: { pre: (props: ComponentProps<'pre'>) => <CodeBlock {...props} title={title} /> },
  });
}

function tab(id: GetStartedTab['id']): GetStartedTab {
  const found = GET_STARTED.find((item) => item.id === id);
  if (!found) throw new Error(`Unknown Get started tab "${id}"`);
  return found;
}

/** One tab's install command and example, as on the landing. */
function Steps({ tab: { command, commandNote, file, code, codeNote } }: { tab: GetStartedTab }) {
  return (
    <>
      <p>{commandNote}</p>
      <InstallCommand command={command} />
      <p>{codeNote}</p>
      <Code code={code} lang="tsx" title={file} />
    </>
  );
}

/**
 * `<InstallCommand command="npm install …" />`: a command written once in npm form, shown in npm, pnpm,
 * yarn or bun by the reader's choice, which every command on the site shares.
 */
export async function InstallCommand({ command }: { command: string }) {
  const entries = await Promise.all(
    PACKAGE_MANAGERS.map(async (manager) => [manager, await Code({ code: commandFor(command, manager), lang: 'sh', title: 'Terminal' })] as const),
  );
  return <PackageManagerCode variants={Object.fromEntries(entries) as Record<PackageManager, ReactNode>} />;
}

/** `<GetStartedTabs />`: npm / shadcn tabs with the command and the example of each. */
export function GetStartedTabs() {
  return (
    <Tabs
      label="Install with"
      items={GET_STARTED.map((item) => ({ id: item.id, label: item.label, content: <Steps tab={item} /> }))}
      className="docs-tabs"
      panelClassName="docs-tabs-panel"
    />
  );
}

/** `<GetStartedCode tab="npm" />`: one tab's example on its own. */
export function GetStartedCode({ tab: id }: { tab: GetStartedTab['id'] }) {
  const { code, file } = tab(id);
  return <Code code={code} lang="tsx" title={file} />;
}
