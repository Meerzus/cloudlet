import { describe, expect, it } from 'vitest';
import { ISLANDS, NARROW_COMPONENTS } from '@/components/kit/islands';
import { COMPONENTS } from '@/lib/site';

describe("the kit hero's islands", () => {
  it('give every component of the kit exactly one island', () => {
    for (const component of COMPONENTS) {
      expect(ISLANDS.filter((island) => island.component === component.id), component.id).toHaveLength(1);
    }
  });

  it('carry only components of the kit', () => {
    const ids = new Set<string>(COMPONENTS.map((component) => component.id));
    for (const island of ISLANDS) if (island.component) expect(ids.has(island.component), island.id).toBe(true);
  });

  it('have unique ids, depths from far (0) to near (1), painted far to near', () => {
    expect(new Set(ISLANDS.map((island) => island.id)).size).toBe(ISLANDS.length);
    for (const island of ISLANDS) expect(island.depth, island.id).toBeGreaterThanOrEqual(0);
    for (const island of ISLANDS) expect(island.depth, island.id).toBeLessThanOrEqual(1);
    const depths = ISLANDS.map((island) => island.depth);
    expect(depths).toEqual([...depths].sort((a, b) => a - b));
  });

  it('keep at most NARROW_COMPONENTS components on narrow screens', () => {
    const narrow = ISLANDS.filter((island) => island.component && island.narrow);
    expect(narrow.length).toBeLessThanOrEqual(NARROW_COMPONENTS);
    expect(narrow.length).toBe(Math.min(COMPONENTS.length, NARROW_COMPONENTS));
  });

  it('rest each component on screen: the middle of its cloud is inside the hero', () => {
    for (const island of ISLANDS.filter((entry) => entry.component)) {
      for (const place of [island.wide, island.narrow].filter((entry) => entry !== null)) {
        const middle = place.x + place.w / 2;
        expect(middle, island.id).toBeGreaterThan(10);
        expect(middle, island.id).toBeLessThan(90);
        expect(place.y, island.id).toBeGreaterThanOrEqual(0);
        expect(place.y, island.id).toBeLessThan(100);
      }
    }
  });
});
