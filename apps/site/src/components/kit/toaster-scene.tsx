import { ArrowRight } from 'lucide-react';
import { SceneLink } from '@/components/site/scene-transition';
import { TOASTER_PATH } from '@/lib/site';
import { InstallCommand } from './install-command';
import { ToasterCompare } from './toaster-compare';

/**
 * The Toaster's chapter, right under the hero on the same sky: a plain stack of toasts and the real
 * Toaster on two identical phones, the same input to both, then the way to the Toaster's own page
 * and its install command. About one screen, no pinning.
 */
export function ToasterScene() {
  return (
    <section id="toaster" aria-labelledby="kit-toaster-title" className="kit-toaster">
      <div className="kit-toaster-grid">
        <div className="kit-toaster-intro">
          <p className="kit-eyebrow">Toaster</p>
          <h2 id="kit-toaster-title" className="kit-toaster-title">
            Same toasts. <span>Softer landing.</span>
          </h2>
          <p className="kit-toaster-lede">
            Both phones get the same notifications at the same moment. The plain stack fades them in and shoves the rest
            aside; Toaster lets them drift in, stack softly and turn around halfway.
          </p>
        </div>
        <ToasterCompare />
        <div className="kit-toaster-outro">
          <SceneLink scene="toaster" href={TOASTER_PATH} className="kit-open">
            Open Toaster
            <ArrowRight className="kit-open-arrow" aria-hidden="true" />
          </SceneLink>
          <InstallCommand initial="toaster" switcher={false} />
        </div>
      </div>
    </section>
  );
}
