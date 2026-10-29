import type { CSSProperties, ReactNode, Ref } from 'react';
import {
  BUTTON_IDS,
  FINISHES,
  SHELLS,
  bodySize,
  ringShadow,
  type ButtonId,
  type Finish,
  type Rect,
  type ShellId,
} from '@/lib/devices';
import { cn } from '@/lib/utils';

const px = (value: number) => `${value}px`;
const corners = (radius: readonly number[]) => radius.map(px).join(' ');

/** Where a button sits on shells that lack it: its first appearance, so it fades out in place. */
const BUTTON_HOME = Object.fromEntries(
  BUTTON_IDS.map((id) => [id, Object.values(SHELLS).find((shell) => shell.buttons[id])?.buttons[id]]),
) as Record<ButtonId, Rect>;

/**
 * Finish parts that only some shells show (laptop base, foldable spine and strips) keep their
 * values on every shell, so they fade out instead of vanishing mid-morph.
 */
function partsStyle(finish: Finish) {
  const laptop = FINISHES.laptop[finish].parts ?? {};
  const fold = FINISHES['foldable-closed'][finish].parts ?? {};
  return {
    '--base': laptop['base'],
    '--scoop': laptop['scoop'],
    '--scoop-top': laptop['scoopTop'],
    '--foot': laptop['foot'],
    '--spine': fold['spine'],
    '--strip-l': fold['stripLeft'],
    '--strip-r': fold['stripRight'],
    '--strip-b': fold['stripBottom'],
    '--hinge-slot': fold['hingeSlot'],
    '--hinge-hi': fold['hingeHighlight'],
  };
}

/** The whole device as CSS variables in the source's px; transitions interpolate between shells. */
export function shellStyle(shell: ShellId, finish: Finish): CSSProperties {
  const geometry = SHELLS[shell];
  const palette = FINISHES[shell][finish];
  const body = bodySize(geometry);
  const { cutout } = geometry;
  return {
    width: geometry.footprint.width,
    height: geometry.footprint.height,
    '--body-x': px(geometry.body.x),
    '--body-y': px(geometry.body.y),
    '--body-w': px(body.width),
    '--body-h': px(body.height),
    '--bezel': geometry.bezel.map(px).join(' '),
    '--screen-w': px(geometry.screen.width),
    '--screen-h': px(geometry.screen.height),
    '--body-radius': corners(geometry.bodyRadius),
    '--screen-radius': corners(geometry.screenRadius),
    '--rings': ringShadow(shell, finish),
    '--bezel-color': palette.bezel,
    '--button-bg': palette.button,
    '--cutout-x': px(cutout.x),
    '--cutout-y': px(cutout.y),
    '--cutout-w': px(cutout.width),
    '--cutout-h': px(cutout.height),
    '--cutout-radius': corners(cutout.radius),
    '--lens-x': px(cutout.lens.x),
    '--lens-y': px(cutout.lens.y),
    '--lens-size': px(cutout.lens.size),
    ...partsStyle(finish),
  } as CSSProperties;
}

/**
 * One device in its natural px: body with edge rings, screen, cutout, side buttons and the
 * shape's extras (laptop base/feet, phone earpiece, foldable spine/strips/hinge). The same
 * markup draws every shell, so changing `shell` morphs it under the stage's transitions.
 */
export function DeviceShell({
  shell,
  finish,
  children,
  screenRef,
  className,
}: {
  shell: ShellId;
  finish: Finish;
  children?: ReactNode;
  screenRef?: Ref<HTMLDivElement>;
  className?: string;
}) {
  const geometry = SHELLS[shell];
  return (
    <div className={cn('dv', className)} style={shellStyle(shell, finish)} data-extras={geometry.extras.join(' ')}>
      <span className="dv-spine" aria-hidden="true" />
      <div className="dv-body">
        <span className="dv-strip dv-strip--l" aria-hidden="true" />
        <span className="dv-strip dv-strip--r" aria-hidden="true" />
        <span className="dv-strip dv-strip--b" aria-hidden="true" />
        <span className="dv-earpiece" aria-hidden="true" />
        <span className="dv-hinge dv-hinge--top" aria-hidden="true" />
        <span className="dv-hinge dv-hinge--bottom" aria-hidden="true" />
        <div ref={screenRef} className="dv-screen">
          {children}
        </div>
        <span className="dv-cutout" aria-hidden="true">
          <span className="dv-lens" />
        </span>
        {BUTTON_IDS.map((id) => {
          const own = geometry.buttons[id];
          const rect = own ?? BUTTON_HOME[id];
          return (
            <span
              key={id}
              className="dv-button"
              data-on={own ? '' : undefined}
              aria-hidden="true"
              style={{ left: rect.x, top: rect.y, width: rect.width, height: rect.height }}
            />
          );
        })}
      </div>
      <span className="dv-base" aria-hidden="true" />
      <span className="dv-feet" aria-hidden="true" />
    </div>
  );
}
