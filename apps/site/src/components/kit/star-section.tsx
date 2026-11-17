import { InstallCommand } from './install-command';
import { PRESS_STYLE, StarLink } from './star-link';

/**
 * The page's last word before the footer: Star on GitHub, large, with the count from the build
 * (shown from 100 stars, as in the header), and the install command once more.
 */
export function StarSection({ stars }: { stars?: number | undefined } = {}) {
  return (
    <section id="star" aria-labelledby="kit-star-title" className="kit-star" style={PRESS_STYLE}>
      <h2 id="kit-star-title" className="ks-title">
        Open source, <span>MIT licensed.</span>
      </h2>
      <p className="ks-lede">The whole kit is on GitHub. A star helps the next developer find it.</p>
      <StarLink stars={stars} />
      <InstallCommand align="center" className="ks-install" />
    </section>
  );
}
