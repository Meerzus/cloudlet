import { describe, expect, it } from 'vitest';
import { springAt, springRetarget, springVelocityAt } from '../../apps/site/src/lib/spring';
import { MORPH, SpringChannel, clipAt, morphClock, radiusAt } from '../../apps/site/src/components/ui/color-picker/morph';

const stops = (easing: string) => easing.replace(/^linear\(|\)$/g, '').split(', ').map(Number);

describe('springRetarget', () => {
  it('starts at the current value, ends at the target and settles within the spring time', () => {
    const open = springRetarget(MORPH.sizeOpen, 0, 0, 1)!;
    const values = stops(open.easing);
    expect(values[0]).toBe(0);
    expect(values.at(-1)).toBe(1);
    expect(open.duration).toBeGreaterThan(200);
    expect(open.duration).toBeLessThan(1200);
    // A 900/60/2 spring overshoots a little before it settles.
    expect(Math.max(...values)).toBeGreaterThan(1);
    expect(Math.max(...values)).toBeLessThan(1.1);
  });

  it('carries momentum: a movement interrupted in flight keeps going before it turns', () => {
    // Opening, interrupted at 60 ms while still accelerating outward, is sent back to 0.
    const t = 0.06;
    const position = springAt(MORPH.sizeOpen, 0, 0, 1, t);
    const velocity = springVelocityAt(MORPH.sizeOpen, 0, 0, 1, t);
    expect(position).toBeGreaterThan(0.05);
    expect(velocity).toBeGreaterThan(0);
    const back = springRetarget(MORPH.sizeClose, position, velocity, 0)!;
    const values = stops(back.easing);
    // Normalised: 0 is where it was, 1 is the target. Leftover speed pushes it past 0 first (below zero).
    expect(values[1]).toBeLessThan(0);
    expect(values.at(-1)).toBe(1);
    // Without the momentum the first stop would already head towards the target.
    const cold = stops(springRetarget(MORPH.sizeClose, position, 0, 0)!.easing);
    expect(cold[1]).toBeGreaterThan(0);
  });

  it('has nothing to do when the channel is already at the target', () => {
    expect(springRetarget(MORPH.sizeOpen, 1, 0, 1)).toBeNull();
  });
});

describe('SpringChannel', () => {
  it('reads value and speed in flight and retargets from them, honouring the clock rate', () => {
    const channel = new SpringChannel(0);
    const first = channel.retarget(1, MORPH.sizeOpen, 1000)!;
    expect(first.from).toBe(0);
    expect(first.to).toBe(1);
    const mid = channel.value(1100);
    expect(mid).toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
    expect(channel.velocity(1100)).toBeGreaterThan(0);
    const back = channel.retarget(0, MORPH.sizeClose, 1100)!;
    expect(back.from).toBeCloseTo(mid, 6);
    expect(back.to).toBe(0);
    // Slow motion: at a quarter rate the same wall time covers a quarter of the spring time.
    morphClock.rate = 0.25;
    try {
      const slow = new SpringChannel(0);
      slow.retarget(1, MORPH.sizeOpen, 0);
      expect(slow.value(400)).toBeCloseTo(springAt(MORPH.sizeOpen, 0, 0, 1, 0.1), 6);
    } finally {
      morphClock.rate = 1;
    }
    channel.settle(1);
    expect(channel.value(5000)).toBe(1);
    expect(channel.velocity(5000)).toBe(0);
    expect(channel.retarget(1, MORPH.sizeOpen, 5000)).toBeNull();
  });
});

describe('clip helpers', () => {
  it('interpolates the insets and the radius between collapsed and expanded', () => {
    expect(clipAt([8, 100, 200, 8], 0)).toEqual(['8px', '100px', '200px', '8px']);
    expect(clipAt([8, 100, 200, 8], 1)).toEqual(['0px', '0px', '0px', '0px']);
    expect(clipAt([8, 100, 200, 8], 0.5)).toEqual(['4px', '50px', '100px', '4px']);
    expect(radiusAt(16, 20, 0)).toBe('16px');
    expect(radiusAt(16, 20, 1)).toBe('20px');
    expect(radiusAt(16, 20, 0.25)).toBe('17px');
  });
});
