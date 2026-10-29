import type { Metadata } from 'next';
import { PuppetCheck } from '@/components/puppet-check/puppet-check';

export const metadata: Metadata = {
  title: 'Cloudlet — puppet check',
  robots: { index: false, follow: false },
};

/** Applies `theme` and `show` from the URL before the first paint. Dependency-free ES5. */
const CHECK_INIT_SCRIPT = `(function(){try{var q=new URLSearchParams(location.search);var r=document.documentElement;var d=q.get('theme')==='dark';r.classList.toggle('dark',d);r.style.colorScheme=d?'dark':'light';r.setAttribute('data-show',q.get('show')||'both');r.setAttribute('data-puppet-check','')}catch(e){}})()`;

/** Service route: the real Toaster next to a puppet, for the accuracy check. Not linked. */
export default function PuppetCheckPage() {
  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: CHECK_INIT_SCRIPT }} />
      <PuppetCheck />
    </>
  );
}
