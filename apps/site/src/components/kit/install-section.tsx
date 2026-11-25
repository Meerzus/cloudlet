import { InstallLive } from './install-live';

/**
 * How the kit installs, back on the sky under the color picker's chapter: one shadcn command per
 * component through the `@cloudlet` namespace, the same item by its address for a CLI that does not
 * know the namespace, and the few lines that use it — which run right here.
 */
export function InstallSection() {
  return (
    <section id="install" aria-labelledby="kit-install-title" className="kit-install-section">
      <div className="ki-intro">
        <p className="kit-eyebrow">Install</p>
        <h2 id="kit-install-title" className="ki-title">
          One command. <span>Every line is yours.</span>
        </h2>
        <p className="ki-lede">
          Each component is a shadcn registry item: the CLI copies its source into your project, where you can read and
          change all of it. Try the lines below — they run on this page.
        </p>
      </div>
      <InstallLive />
    </section>
  );
}
