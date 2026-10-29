'use client';

import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { ScreenSkeleton } from '@/components/frame/frame-skeleton';
import { FOLD, SHELLS, shellOf, type DeviceId, type Finish, type FoldPose, type ShellId } from '@/lib/devices';
import { springEasing } from '@/lib/spring';
import { DeviceShell } from './device-shell';

/** Shells morph between devices on this spring (CSS `linear()`, no runtime). */
export const DEVICE_SPRING = springEasing({ stiffness: 170, damping: 20 });
/** Screen contents crossfade while the shell morphs. */
export const SCREEN_FADE_MS = 320;
/** Reduced motion: the device fades out, swaps and fades back in. */
export const REDUCED_FADE_MS = 360;
/** Share of the stage the device may fill. */
const FIT = 0.94;

const STAGE_STYLE = {
  '--device-ease': DEVICE_SPRING.easing,
  '--device-duration': `${DEVICE_SPRING.duration}ms`,
  '--screen-fade': `${SCREEN_FADE_MS}ms`,
  '--reduced-fade': `${REDUCED_FADE_MS}ms`,
  '--fold-ease': FOLD.easing,
  '--fold-duration': `${FOLD.durationMs}ms`,
} as CSSProperties;

const DEVICE_NAMES: Record<DeviceId, string> = {
  laptop: 'a laptop',
  phone: 'a phone',
  foldable: 'a foldable phone',
  tablet: 'a tablet',
};

export interface StageFrame {
  readonly device: DeviceId;
  readonly src: string;
}

interface Fold {
  readonly from: FoldPose;
  readonly to: FoldPose;
  readonly running: boolean;
}

/**
 * The foldable's fold, after react-mockframe's iPhone Duo scene: two 3D leaves hinged in the
 * middle; the left leaf's back is the closed device. A live iframe cannot sit on two leaves at
 * once, so the leaves show the static skeleton while they turn.
 */
function FoldScene({ fold, finish }: { fold: Fold; finish: Finish }) {
  const pose = fold.running ? fold.to : fold.from;
  const half = (FOLD.inner.sw + FOLD.inner.bx) / 2;
  const style = {
    left: FOLD.hinge[pose] - half,
    width: half * 2,
    height: FOLD.inner.sh + FOLD.inner.by,
    perspective: FOLD.perspective,
  };
  return (
    <div className="fold-scene" style={style} aria-hidden="true">
      <div className="fold-leaf fold-leaf--right">
        <div className="fold-face fold-face--right">
          <DeviceShell shell="foldable-open" finish={finish}>
            <ScreenSkeleton kind="tablet" />
          </DeviceShell>
        </div>
      </div>
      <div className="fold-leaf fold-leaf--left" style={{ transform: `rotateY(${FOLD.leftAngle[pose]}deg)` }}>
        <div className="fold-face fold-face--front">
          <DeviceShell shell="foldable-open" finish={finish}>
            <ScreenSkeleton kind="tablet" />
          </DeviceShell>
        </div>
        <div className="fold-face fold-face--back">
          <DeviceShell shell="foldable-closed" finish={finish}>
            <ScreenSkeleton kind="mobile" />
          </DeviceShell>
        </div>
      </div>
    </div>
  );
}

/**
 * The hero device: one parametric shell (devices.ts) that morphs between laptop, phone,
 * foldable and tablet on a spring, scaled to fit the stage. Each device has its own iframe at
 * its natural viewport, scaled to cover the screen and crossfaded; the foldable's iframe is
 * resized when it folds, so its page (and Cloudlet's `position="auto"`) reflows for real.
 */
export function DeviceStage({
  device,
  pose,
  finish,
  frames,
  reduced,
  onFrame,
}: {
  device: DeviceId;
  pose: FoldPose;
  finish: Finish;
  frames: readonly StageFrame[];
  reduced: boolean;
  onFrame: (device: DeviceId, element: HTMLIFrameElement | null) => void;
}) {
  const stage = useRef<HTMLDivElement>(null);
  const rig = useRef<HTMLDivElement>(null);
  const screen = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState<{ width: number; height: number } | null>(null);
  const [resizing, setResizing] = useState(false);
  const [fold, setFold] = useState<Fold | null>(null);
  // A frame fades in once its document has loaded; until then the screen shows its own background.
  const [loaded, setLoaded] = useState<readonly DeviceId[]>([]);

  const shell: ShellId = shellOf(device, pose);
  const previous = useRef(shell);

  // A pose change of the foldable starts the fold in the same render (state derived from props),
  // so the shell's new geometry never paints or starts a morph before the scene covers it.
  const [tracked, setTracked] = useState({ device, pose });
  if (tracked.device !== device || tracked.pose !== pose) {
    setTracked({ device, pose });
    if (!reduced && tracked.device === 'foldable' && device === 'foldable') {
      setFold({ from: tracked.pose, to: pose, running: false });
    }
  }

  // Fit the device into the stage; window resizes snap instead of springing.
  useLayoutEffect(() => {
    const element = stage.current;
    if (!element) return;
    let frame = 0;
    const measure = () => {
      setSize({ width: element.clientWidth, height: element.clientHeight });
      setResizing(true);
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setResizing(false));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(element);
    return () => {
      observer.disconnect();
      cancelAnimationFrame(frame);
    };
  }, []);

  // Reduced motion: every swap (device or fold) fades through instead of morphing.
  useLayoutEffect(() => {
    const before = previous.current;
    previous.current = shell;
    if (before === shell || !reduced) return;
    rig.current?.animate([{ opacity: 1 }, { opacity: 0 }, { opacity: 1 }], {
      duration: REDUCED_FADE_MS,
      easing: 'ease-in-out',
    });
  }, [shell, reduced]);

  // Paint the fold's start, then switch to its end so the transitions run; then hand back to the live shell.
  useEffect(() => {
    if (!fold) return;
    if (!fold.running) {
      let second = 0;
      const first = requestAnimationFrame(() => {
        second = requestAnimationFrame(() => setFold((current) => current && { ...current, running: true }));
      });
      return () => {
        cancelAnimationFrame(first);
        cancelAnimationFrame(second);
      };
    }
    const done = setTimeout(() => setFold(null), FOLD.durationMs + 60);
    return () => clearTimeout(done);
  }, [fold]);

  // Each iframe covers the screen at its natural viewport; follows every frame of the morph.
  useLayoutEffect(() => {
    const element = screen.current;
    if (!element) return;
    const fit = () => {
      const { clientWidth: width, clientHeight: height } = element;
      for (const iframe of element.querySelectorAll<HTMLIFrameElement>('iframe[data-device]')) {
        const natural = { width: Number(iframe.width) || 1, height: Number(iframe.height) || 1 };
        const scale = Math.max(width / natural.width, height / natural.height);
        const x = (width - natural.width * scale) / 2;
        const y = (height - natural.height * scale) / 2;
        iframe.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
      }
    };
    fit();
    const observer = new ResizeObserver(fit);
    observer.observe(element);
    return () => observer.disconnect();
  }, [frames, pose]);

  // The rig is the device's footprint scaled to fit; during a fold it follows the fold's timing.
  const footprintShell: ShellId = fold ? `foldable-${fold.running ? fold.to : fold.from}` : shell;
  const footprint = SHELLS[footprintShell].footprint;
  const scale = size ? Math.min((size.width * FIT) / footprint.width, (size.height * FIT) / footprint.height) : 0;

  return (
    <div
      ref={stage}
      className="device-stage"
      style={STAGE_STYLE}
      data-reduced={reduced ? '' : undefined}
      data-animate={!fold && !resizing ? '' : undefined}
      data-folding={fold ? '' : undefined}
    >
      <div
        ref={rig}
        className="device-rig"
        style={{
          width: footprint.width,
          height: footprint.height,
          transform: `translate(-50%, -50%) scale(${scale})`,
          visibility: size ? undefined : 'hidden',
        }}
      >
        <DeviceShell shell={shell} finish={finish} screenRef={screen} className="dv-live">
          {frames.map((frame) => {
            const active = frame.device === device;
            const viewport = SHELLS[shellOf(frame.device, pose)].viewport;
            return (
              <iframe
                key={frame.device}
                ref={(element) => onFrame(frame.device, element)}
                src={frame.src}
                title={`Live Cloudlet demo on ${DEVICE_NAMES[frame.device]}`}
                data-device={frame.device}
                data-visible={active && loaded.includes(frame.device) ? '' : undefined}
                onLoad={() => setLoaded((current) => (current.includes(frame.device) ? current : [...current, frame.device]))}
                width={viewport.width}
                height={viewport.height}
                className="device-frame"
                tabIndex={active ? 0 : -1}
                aria-hidden={active ? undefined : true}
                inert={!active}
              />
            );
          })}
        </DeviceShell>
        {fold && <FoldScene fold={fold} finish={finish} />}
      </div>
    </div>
  );
}
