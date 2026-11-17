import { ArrowUpRight } from 'lucide-react';
import type { ReactNode } from 'react';
import { ExternalLink } from '@/components/site/external-link';
import { repoUrl, TESTED } from '@/lib/kit-principles';
import { AccessProof, MotionProof, ThemeProof } from './principles-live';

function Principle({ id, eyebrow, title, children, proof }: { id: string; eyebrow: string; title: ReactNode; children: ReactNode; proof: ReactNode }) {
  return (
    <article className="kp-principle" aria-labelledby={`kp-${id}`}>
      <div className="kp-copy">
        <p className="kit-eyebrow">{eyebrow}</p>
        <h3 id={`kp-${id}`} className="kp-title">
          {title}
        </h3>
        <div className="kp-text">{children}</div>
      </div>
      <div className="kp-proof">{proof}</div>
    </article>
  );
}

function Tested() {
  return (
    <ul className="kp-tested">
      {TESTED.map((claim) => (
        <li key={claim.id}>
          <p className="kp-tested-title">{claim.title}</p>
          <p className="kp-tested-text">{claim.text}</p>
          <p className="kp-tested-proof">
            {claim.proof.map((proof) => (
              <ExternalLink key={proof.path} href={repoUrl(proof.path)} className="kp-repo">
                {proof.label}
                <ArrowUpRight aria-hidden="true" />
                <span className="sr-only"> on GitHub (opens in a new tab)</span>
              </ExternalLink>
            ))}
          </p>
        </li>
      ))}
    </ul>
  );
}

/**
 * Why the kit can be trusted, on the sky between the install and the last word: four principles,
 * each shown live on this page rather than claimed — a picker to catch halfway, the page's own
 * reduce-motion switch and the path Tab takes, themes on the shadcn tokens, and what the repository runs.
 */
export function PrinciplesSection() {
  return (
    <section id="principles" aria-labelledby="kit-principles-title" className="kit-principles">
      <div className="kp-intro">
        <p className="kit-eyebrow">Principles</p>
        <h2 id="kit-principles-title" className="kp-heading">
          Four promises. <span>Each one on this page.</span>
        </h2>
        <p className="kp-lede">Every component of the kit keeps the same four. Don’t take them on trust: try each one right here.</p>
      </div>
      <Principle id="motion" eyebrow="Motion" title={<>Catch it halfway.</>} proof={<MotionProof />}>
        <p>
          Every movement runs on a spring you can interrupt. Change your mind mid-way and it turns around from where it
          is, at the speed it had, instead of finishing first or jumping.
        </p>
      </Principle>
      <Principle id="access" eyebrow="Accessibility" title={<>Calm when asked. Reachable by keys.</>} proof={<AccessProof />}>
        <p>
          Reduced motion is a first-class layout, not a broken one: everything is still there, nothing moves. Every
          control answers the keyboard, and focus goes where you expect it, with a ring you can see.
        </p>
      </Principle>
      <Principle id="theme" eyebrow="Your theme, your code" title={<>Your tokens. Its look.</>} proof={<ThemeProof />}>
        <p>
          The Color picker and the Color palette read your shadcn tokens and your font, and their source is in your
          project, so anything else is yours to change. Pick a theme: only this block’s variables change.
        </p>
      </Principle>
      <Principle id="tested" eyebrow="Tested, not promised" title={<>Checked where it runs.</>} proof={<Tested />}>
        <p>
          Each line here is something the repository runs, in real browsers or with a real screen reader. Every
          link opens the file that does it.
        </p>
      </Principle>
    </section>
  );
}
