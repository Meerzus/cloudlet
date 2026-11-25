import { codeTokens } from '@/lib/code-tokens';
import { exampleSource } from '@/lib/example-source';
import { ExampleBlock } from './example-block';

/**
 * `<Example name="color-picker/panel" />` in a page: the live example block. The code shown is the
 * source of the file that renders, read and coloured here at build time, so the two cannot drift;
 * an unknown name fails the build.
 */
export async function Example({ name }: { name?: string }) {
  const { file, code } = exampleSource(name);
  return <ExampleBlock name={name ?? ''} file={file} code={await codeTokens(code)} />;
}
