import type { Ref } from 'react';
import { puppetCounts, puppetDots, puppetLayers, type PuppetFace, type PuppetKind, type PuppetState } from '@/lib/puppet-model';
import { cn } from '@/lib/utils';

/** The package's 16 px stroke glyphs, drawn here, not imported. */
const GLYPHS: Record<Exclude<PuppetKind, 'loading'>, string> = {
  success: 'M4.5 8.5 7 11l4.5-5.5',
  error: 'm5.5 5.5 5 5m0-5-5 5',
  info: 'M8 7.5V11M8 5h.01',
  warning: 'M8 4.75V8.5M8 11.25h.01',
};
const CLOSE = 'm4.5 4.5 7 7m0-7-7 7';
const SEND = 'M8 13V3m0 0L3.5 7.5M8 3l4.5 4.5';

function Icon({ face }: { face: PuppetFace }) {
  return (
    <span className="pp-icon" data-kind={face.kind}>
      {face.kind !== 'loading' ? (
        <svg className="pp-glyph" viewBox="0 0 16 16">
          <path d={GLYPHS[face.kind]} />
        </svg>
      ) : face.ring ? null : (
        <svg className="pp-glyph pp-spinner" viewBox="0 0 16 16">
          <circle cx="8" cy="8" r="5.5" strokeDasharray="22 13" />
        </svg>
      )}
      {face.ring ? (
        <svg className="pp-ring" viewBox="0 0 32 32">
          <circle className="pp-ring-track" cx="16" cy="16" r="15" />
          <circle className="pp-ring-fill" cx="16" cy="16" r="15" pathLength="100" transform="rotate(-90 16 16)" strokeDasharray="0 100" />
        </svg>
      ) : null}
    </span>
  );
}

function Description({ text }: { text: string }) {
  const [before, after] = text.split('{progress}');
  return (
    <p className="pp-description">
      {before}
      {after !== undefined ? (
        <>
          <span data-pp-progress="">0%</span>
          {after}
        </>
      ) : null}
    </p>
  );
}

function Face({ layer }: { layer: ReturnType<typeof puppetLayers>[number] }) {
  const { face, mode, key } = layer;
  const island = mode === 'island';
  return (
    <div className="pp-face" data-mode={mode} data-layer={key} data-kind={face.kind}>
      <div className="pp-heading">
        <Icon face={face} />
        <p className="pp-title">{face.title}</p>
      </div>
      {island ? (
        <div className="pp-body">
          {face.description ? <Description text={face.description} /> : null}
          {face.field ? (
            <div className="pp-form">
              <span className="pp-field">
                <span className="pp-placeholder">{face.field.placeholder}</span>
                <span className="pp-typed" />
                <span className="pp-caret" />
                <span className="pp-field-ring" />
              </span>
              <span className="pp-send">
                <svg className="pp-glyph pp-send-arrow" viewBox="0 0 16 16">
                  <path d={SEND} />
                </svg>
                <svg className="pp-glyph pp-spinner pp-send-spinner" viewBox="0 0 16 16">
                  <circle cx="8" cy="8" r="5.5" strokeDasharray="22 13" />
                </svg>
              </span>
            </div>
          ) : null}
          {face.action || face.retry || face.cancel ? (
            <div className="pp-actions">
              {face.action ? (
                <span className="pp-action" data-primary="">
                  {face.action}
                  <span className="pp-highlight" data-control="action" />
                </span>
              ) : null}
              {face.retry ? (
                <span className="pp-action">
                  Retry
                  <span className="pp-highlight" data-control="retry" />
                </span>
              ) : null}
              {face.cancel ? (
                <span className="pp-action">
                  {face.cancel}
                  <span className="pp-highlight" data-control="cancel" />
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export interface PuppetProps {
  /** Every state the puppet will show; each distinct face and mode becomes one layer. */
  readonly states: readonly PuppetState[];
  /** Forces a theme; by default the puppet follows the page (`.dark`). */
  readonly theme?: 'light' | 'dark';
  readonly dir?: 'ltr' | 'rtl';
  readonly className?: string;
  readonly ref?: Ref<HTMLDivElement>;
}

/**
 * A decorative lookalike of the Cloudlet toaster, drawn with the package
 * tokens and glyphs but never its DOM. Static markup only: the puppeteer measures it
 * and writes every animated value; until then the stack stays hidden.
 */
export function Puppet({ states, theme, dir, className, ref }: PuppetProps) {
  const dots = puppetDots(states);
  return (
    <div ref={ref} className={cn('puppet', className)} data-theme={theme} dir={dir} aria-hidden="true">
      <div className="pp-stack">
        <div className="pp-tail" data-tail="2" />
        <div className="pp-tail" data-tail="1" />
        <svg className="pp-bg" focusable="false">
          <path />
        </svg>
        <div className="pp-content">
          {puppetLayers(states).map((layer) => (
            <Face key={layer.key} layer={layer} />
          ))}
          <span className="pp-close">
            <svg className="pp-glyph" viewBox="0 0 16 16">
              <path d={CLOSE} />
            </svg>
            <span className="pp-highlight" data-control="close" />
          </span>
          {dots > 1 ? (
            <div className="pp-indicator">
              {Array.from({ length: dots }, (_, index) => (
                <span key={index} className="pp-dot-box">
                  <span className="pp-dot" />
                </span>
              ))}
            </div>
          ) : null}
        </div>
        <span className="pp-badge">
          {puppetCounts(states).map((count) => (
            <span key={count} data-count={count}>
              {count}
            </span>
          ))}
        </span>
      </div>
    </div>
  );
}
