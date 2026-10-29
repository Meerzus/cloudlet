import type { ComponentProps } from 'react';

/** A link off the site (GitHub, license, outside docs): opens in a new tab so the reader keeps their place. */
export function ExternalLink(props: ComponentProps<'a'>) {
  return <a target="_blank" rel="noreferrer" {...props} />;
}
