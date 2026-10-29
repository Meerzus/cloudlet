import { describe, expect, it } from 'vitest';
import { MOTION, resolveMotion } from '../../packages/toast/src/react/motion.js';
// The one lab module tests read: its copy of the motion values must match the package.
import { applyOverrides, designMotion, diffFromDesign, motionSections, parseTuning, readField, setField, tuningJson } from '../../apps/lab/src/design-motion.js';

describe('laboratory motion baseline', () => {
  it('matches MOTION of the package field by field (a tuning changes both)', () => {
    const { swipe: _swipe, ...tunable } = MOTION;
    expect(designMotion).toEqual(tunable);
    expect(resolveMotion({})).toEqual(designMotion);
  });

  it('exposes every tunable field in the panel exactly once', () => {
    const paths = motionSections.flatMap(section => section.fields.map(field => field.path));
    const expected = Object.entries(designMotion).flatMap(([group, value]) =>
      typeof value === 'number' ? [group] : Object.keys(value).map(field => `${group}.${field}`));
    expect([...paths].sort()).toEqual([...expected].sort());
    for (const path of paths) expect(Number.isFinite(readField(designMotion, path))).toBe(true);
  });

  it('keeps overrides minimal and round-trips the copied JSON', () => {
    let overrides = setField({}, 'shapeOpen.stiffness', 220);
    overrides = setField(overrides, 'blur', 8);
    overrides = setField(overrides, 'blur', 6);
    expect(overrides).toEqual({ shapeOpen: { stiffness: 220 } });
    expect(applyOverrides(overrides).shapeOpen).toEqual({ ...designMotion.shapeOpen, stiffness: 220 });
    const json = JSON.parse(tuningJson(0.25, overrides)) as { timeScale: number; motion: unknown; changed: unknown };
    expect(json).toEqual({ timeScale: 0.25, motion: applyOverrides(overrides), changed: overrides });
    expect(parseTuning(JSON.stringify(json))).toEqual({ ok: true, timeScale: 0.25, overrides });
    // A bare constants or overrides object is accepted too; the package resolves it the same way.
    expect(parseTuning(JSON.stringify({ slide: { damping: 40 } }))).toEqual({ ok: true, overrides: { slide: { damping: 40 } } });
    expect(resolveMotion(overrides)).toEqual(applyOverrides(overrides));
    expect(diffFromDesign(designMotion)).toEqual({});
  });

  it('rejects typos and out-of-range values instead of silently resetting them', () => {
    expect(parseTuning('{')).toMatchObject({ ok: false });
    expect(parseTuning(JSON.stringify({ motion: { shapeOpen: { stifness: 1 } } }))).toMatchObject({ ok: false, error: expect.stringContaining('stifness') });
    expect(parseTuning(JSON.stringify({ motion: { slide: { mass: 0 } } }))).toMatchObject({ ok: false });
    expect(parseTuning(JSON.stringify({ motion: { blur: -1 } }))).toMatchObject({ ok: false });
    expect(parseTuning(JSON.stringify({ timeScale: 0, motion: {} }))).toMatchObject({ ok: false });
  });
});
