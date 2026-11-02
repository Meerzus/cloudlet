import { CodeBlock } from '@/components/get-started/get-started';
import { PackageManagerCommand } from '@/components/site/package-manager';
import { PICKER_GET_STARTED as START } from '@/lib/picker-get-started';

/** Get started (COLOR_PICKER §8.5): the shadcn command in the reader's package manager and the smallest controlled example. */
export function PickerGetStarted() {
  return (
    <section id="get-started" aria-labelledby="get-started-title" className="cp-section">
      <div className="mx-auto max-w-6xl px-4 py-24 sm:px-6 sm:py-32">
        <h2 id="get-started-title" className="cp-section-title">get started</h2>
        <p className="cp-section-lede">One command with the shadcn CLI, then use it like an input.</p>
        <ol className="gs-steps mt-10">
          <li className="gs-step">
            <span className="gs-step-number" aria-hidden="true">1</span>
            <div className="min-w-0">
              <h3>Add it</h3>
              <p>{START.commandNote}</p>
              <PackageManagerCommand command={START.command} className="mt-4" />
            </div>
          </li>
          <li className="gs-step">
            <span className="gs-step-number" aria-hidden="true">2</span>
            <div className="min-w-0">
              <h3>Use it</h3>
              <p>{START.codeNote}</p>
              <CodeBlock file={START.file} code={START.code} />
            </div>
          </li>
        </ol>
      </div>
    </section>
  );
}
