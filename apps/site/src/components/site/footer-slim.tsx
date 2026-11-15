import { FooterLinks } from './footer-links';

/** The one-line footer of reading pages; the landing keeps its cloud wordmark footer. */
export function FooterSlim() {
  return (
    <footer className="docs-footer">
      <div className="mx-auto max-w-6xl px-4 py-8 text-sm font-medium sm:px-6">
        <FooterLinks idPrefix="footer-slim-icon" iconClassName="size-5" />
      </div>
    </footer>
  );
}
