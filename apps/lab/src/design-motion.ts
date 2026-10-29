import type { CloudletMotionConstants, CloudletMotionOverrides } from '@cloudlet/toast';

/**
 * The motion values as the tuning panel's baseline. The package
 * keeps the same numbers in `react/motion.ts` (`MOTION`); tests/unit/lab-motion-defaults.test.ts
 * fails when the two drift apart. Change both together.
 */
export const designMotion: CloudletMotionConstants = {
  enter: { duration: 200, bounce: 0.25, scale: 0.25, offset: 1, fade: 160 },
  exit: { duration: 300, bounce: 0 },
  shapeOpen: { stiffness: 900, damping: 60, mass: 2 },
  shapeClose: { stiffness: 900, damping: 45, mass: 1 },
  slide: { stiffness: 1200, damping: 60, mass: 1 },
  badge: { duration: 200, bounce: 0, scale: 0.6 },
  tails: 150,
  chromeDelay: 100, chromeIn: 200, chromeOut: 70, chromeOffset: 4,
  headerOut: 200, headerIn: 260, blur: 6,
  bodyOut: 120, bodyIn: 200, bodyOffset: 4, bodyQuiet: 600,
  countSwap: 160,
  progress: 1000,
  hover: 200, hoverLift: 2,
  reduced: 80,
};

type Group = keyof CloudletMotionConstants;
export interface MotionField {
  /** `enter.duration` or `blur`. */
  readonly path: string;
  readonly label: string;
  readonly unit: 'ms' | 'px' | '';
  readonly step: number;
  readonly min: number;
}
export interface MotionSection { readonly title: string; readonly note: string; readonly fields: readonly MotionField[] }

const ms = (path: string, label: string): MotionField => ({ path, label, unit: 'ms', step: 10, min: 0 });
const px = (path: string, label: string): MotionField => ({ path, label, unit: 'px', step: 1, min: 0 });
const spring = (group: Group): MotionField[] => [
  { path: `${group}.stiffness`, label: 'stiffness', unit: '', step: 10, min: 1 },
  { path: `${group}.damping`, label: 'damping', unit: '', step: 1, min: 0 },
  { path: `${group}.mass`, label: 'mass', unit: '', step: 0.1, min: 0.1 },
];
const timed = (group: Group): MotionField[] => [
  ms(`${group}.duration`, 'duration'),
  { path: `${group}.bounce`, label: 'bounce', unit: '', step: 0.05, min: 0 },
];

/** Panel layout: the motion values, grouped by transition. */
export const motionSections: readonly MotionSection[] = [
  { title: 'Shape: open', note: 'Pill → Island: width, height, radius', fields: spring('shapeOpen') },
  { title: 'Shape: close and resize', note: 'Island → pill, height for a new slide', fields: spring('shapeClose') },
  { title: 'Slide', note: 'Between notifications and a released swipe', fields: spring('slide') },
  { title: 'Enter', note: 'A new pill and a tail rising', fields: [...timed('enter'), { path: 'enter.scale', label: 'scale from', unit: '', step: 0.01, min: 0 }, px('enter.offset', 'offset from the edge'), ms('enter.fade', 'opacity')] },
  { title: 'Exit', note: 'The last notification, dismiss of the top one', fields: timed('exit') },
  { title: 'Blur swap', note: 'Title and icon; badge number and indicator', fields: [ms('headerOut', 'outgoing'), ms('headerIn', 'incoming'), px('blur', 'blur'), ms('countSwap', 'number / indicator')] },
  { title: 'Body crossfade', note: 'Description and buttons on update', fields: [ms('bodyOut', 'outgoing'), ms('bodyIn', 'incoming'), px('bodyOffset', 'incoming rise'), ms('bodyQuiet', 'stream: no crossfade more often than')] },
  { title: 'Island chrome', note: '“Close”, body, indicator during the morph; tails', fields: [ms('chromeDelay', 'delay'), ms('chromeIn', 'in'), ms('chromeOut', 'out'), px('chromeOffset', 'rise'), ms('tails', 'tails')] },
  { title: 'Badge', note: 'In and out', fields: [...timed('badge'), { path: 'badge.scale', label: 'hidden scale', unit: '', step: 0.05, min: 0 }] },
  { title: 'Other', note: 'Progress, stack hover, reduced motion', fields: [ms('progress', 'progress'), ms('hover', 'hover'), px('hoverLift', 'hover: +px'), ms('reduced', 'reduced fade')] },
];

export function readField(values: CloudletMotionConstants, path: string): number {
  const [group, field] = path.split('.') as [string, string | undefined];
  const entry = (values as unknown as Record<string, unknown>)[group];
  return field ? (entry as Record<string, number>)[field]! : entry as number;
}

/** Overrides → complete values (the panel shows and copies complete values). */
export function applyOverrides(overrides: CloudletMotionOverrides): CloudletMotionConstants {
  const result = structuredClone(designMotion) as unknown as Record<string, unknown>;
  for (const [group, value] of Object.entries(overrides)) {
    if (!(group in result)) continue;
    if (typeof value === 'number') result[group] = value;
    else if (value && typeof value === 'object') Object.assign(result[group] as object, value);
  }
  return result as unknown as CloudletMotionConstants;
}

/** Only the fields that differ from the baseline, in the overrides shape. */
export function diffFromDesign(values: CloudletMotionConstants): CloudletMotionOverrides {
  const result: Record<string, unknown> = {};
  for (const [group, base] of Object.entries(designMotion) as [string, unknown][]) {
    const value = (values as unknown as Record<string, unknown>)[group];
    if (typeof base === 'number') { if (value !== base) result[group] = value; continue; }
    const changed = Object.fromEntries(Object.entries(base as Record<string, number>)
      .filter(([field, number]) => (value as Record<string, number>)[field] !== number)
      .map(([field]) => [field, (value as Record<string, number>)[field]]));
    if (Object.keys(changed).length) result[group] = changed;
  }
  return result as CloudletMotionOverrides;
}

export function setField(overrides: CloudletMotionOverrides, path: string, value: number): CloudletMotionOverrides {
  return diffFromDesign(writePath(applyOverrides(overrides), path, value));
}
function writePath(values: CloudletMotionConstants, path: string, value: number): CloudletMotionConstants {
  const [group, field] = path.split('.') as [string, string | undefined];
  const result = values as unknown as Record<string, unknown>;
  if (field) (result[group] as Record<string, number>)[field] = value; else result[group] = value;
  return values;
}

export type ParsedTuning = { ok: true; timeScale?: number; overrides: CloudletMotionOverrides } | { ok: false; error: string };

/**
 * Accepts the panel's own JSON (`{ timeScale?, motion }`) or a bare constants/overrides object.
 * Unknown keys and non-numbers are rejected so a typo never silently resets a value.
 */
export function parseTuning(text: string): ParsedTuning {
  let data: unknown;
  try { data = JSON.parse(text); } catch { return { ok: false, error: 'This is not JSON' }; }
  if (!data || typeof data !== 'object' || Array.isArray(data)) return { ok: false, error: 'An object was expected' };
  const root = data as Record<string, unknown>;
  const motion = 'motion' in root ? root['motion'] : root;
  if (!motion || typeof motion !== 'object' || Array.isArray(motion)) return { ok: false, error: '“motion” must be an object' };
  let values = structuredClone(designMotion);
  for (const [group, value] of Object.entries(motion as Record<string, unknown>)) {
    if (group === 'timeScale' && motion === root) continue;
    const base = (designMotion as unknown as Record<string, unknown>)[group];
    if (base === undefined) return { ok: false, error: `Unknown key “${group}”` };
    if (typeof base === 'number') {
      if (!valid(group, value)) return { ok: false, error: `“${group}”: a number ≥ 0 is needed` };
      values = writePath(values, group, value);
      continue;
    }
    if (!value || typeof value !== 'object') return { ok: false, error: `“${group}”: an object is needed` };
    for (const [field, number] of Object.entries(value as Record<string, unknown>)) {
      if (!(field in (base as object))) return { ok: false, error: `Unknown key “${group}.${field}”` };
      if (!valid(field, number)) return { ok: false, error: `“${group}.${field}”: a number ${field === 'stiffness' || field === 'mass' ? '> 0' : '≥ 0'} is needed` };
      values = writePath(values, `${group}.${field}`, number);
    }
  }
  const scale = root['timeScale'];
  if (scale !== undefined && !(typeof scale === 'number' && Number.isFinite(scale) && scale > 0)) return { ok: false, error: '“timeScale”: a number > 0 is needed' };
  return { ok: true, overrides: diffFromDesign(values), ...(typeof scale === 'number' ? { timeScale: scale } : {}) };
}

function valid(key: string, value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && (key === 'stiffness' || key === 'mass' ? value > 0 : value >= 0);
}

/** The copied JSON: complete values, so they can be pasted into MOTION as they are. */
export function tuningJson(timeScale: number, overrides: CloudletMotionOverrides): string {
  return JSON.stringify({ timeScale, motion: applyOverrides(overrides), changed: diffFromDesign(applyOverrides(overrides)) }, null, 2);
}
