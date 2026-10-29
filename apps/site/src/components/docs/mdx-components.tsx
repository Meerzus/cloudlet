import { Link as LinkIcon } from 'lucide-react';
import type { MDXComponents } from 'mdx/types';
import Link from 'next/link';
import { Children, Fragment, isValidElement, type ComponentProps, type ReactNode } from 'react';
import { ExternalLink } from '@/components/site/external-link';
import { DOCS_UI } from '@/lib/docs-ui-strings';
import { Callout } from './callout';
import { CodeBlock, type CodeBlockProps } from './code-block';
import { DemoBlock, type DemoItem } from './demo-block';
import { GetStartedCode, GetStartedTabs } from './get-started-code';
import { Table } from './table';
import { StyleEditor } from './style-editor/style-editor';

type LinkProps = ComponentProps<typeof Link>;
type HeadingTag = 'h2' | 'h3' | 'h4';

/** Headings get their `id` from remark-heading; this adds the hover anchor. */
function heading(Tag: HeadingTag) {
  return function Heading({ id, children, ...rest }: ComponentProps<HeadingTag>) {
    return (
      <Tag id={id} {...rest}>
        {children}
        {id ? (
          <a href={`#${id}`} className="docs-heading-anchor" aria-label={DOCS_UI.linkToSection}>
            <LinkIcon aria-hidden="true" />
          </a>
        ) : null}
      </Tag>
    );
  };
}

/** Site links go through `next/link`; anything else is an ordinary link that opens in a new tab. */
function DocsLink({ href = '', children, ...rest }: ComponentProps<'a'>) {
  if (href.startsWith('/') || href.startsWith('#')) {
    return (
      <Link {...(rest as Omit<LinkProps, 'href'>)} href={href}>
        {children}
      </Link>
    );
  }
  return (
    <ExternalLink href={href} {...rest}>
      {children}
    </ExternalLink>
  );
}

/** The children of a JSX block, with fragments (how MDX hands over flow content) opened. */
function flatten(children: ReactNode): ReactNode[] {
  return Children.toArray(children).flatMap((child) =>
    isValidElement<{ children?: ReactNode }>(child) && child.type === Fragment ? flatten(child.props.children) : [child],
  );
}

/**
 * `<Demos>` … `</Demos>` around several ```tsx demo="…" fences: one demo block with a
 * button per fence. Anything else inside is an authoring mistake and fails the build.
 */
function Demos({ children }: { children: ReactNode }) {
  const items: DemoItem[] = [];
  let note = false;
  for (const child of flatten(children)) {
    if (typeof child === 'string' && child.trim() === '') continue;
    const fence = isValidElement<CodeBlockProps>(child) && child.type === CodeBlock ? child.props : undefined;
    if (fence?.['data-demo'] === undefined) throw new Error('<Demos> may only contain ```tsx demo="<id>" fences');
    items.push({ id: fence['data-demo'], code: fence.children, className: fence.className });
    if (fence['data-demo-note'] !== undefined) note = true;
  }
  if (items.length < 2) throw new Error('<Demos> needs at least two demo fences; a single one stands on its own');
  return <DemoBlock items={items} note={note} />;
}

/** The components every MDX page renders with. */
export function getMDXComponents(): MDXComponents {
  return {
    h2: heading('h2'),
    h3: heading('h3'),
    h4: heading('h4'),
    a: DocsLink,
    pre: CodeBlock,
    table: Table,
    Callout,
    Demos,
    GetStartedTabs,
    GetStartedCode,
    StyleEditor,
  };
}
