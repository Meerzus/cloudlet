import { describe, expect, it } from 'vitest';
import {
  openTypes,
  SCENE_BACK,
  SCENE_LANDINGS,
  SCENE_OPEN,
  sceneOf,
  sceneOfTypes,
  sceneType,
  traversalTypes,
  withColors,
} from '../../apps/site/src/lib/scene-transition';
import { COMPONENTS } from '../../apps/site/src/lib/site';

describe('scene transitions', () => {
  it('gives every component of the kit a landing its scene opens, with no work of its own', () => {
    for (const component of COMPONENTS) {
      expect(SCENE_LANDINGS[component.id]).toBe(component.path);
      expect(sceneOf(component.path)).toBe(component.id);
    }
  });

  it('knows a landing by its path, a section of a landing by its hash, whatever the query', () => {
    expect(sceneOf('/toaster')).toBe('toaster');
    expect(sceneOf('/color-picker')).toBe('color-picker');
    expect(sceneOf('/color-picker?c=ff6a3d')).toBe('color-picker');
    expect(sceneOf('/color-picker#palette')).toBe('color-palette');
    expect(sceneOf('/color-picker?c=ff6a3d,2f8f9d#palette')).toBe('color-palette');
    expect(sceneOf('/color-picker#faq')).toBe('color-picker');
  });

  it('is no scene for the kit page, the docs, the playground or anything else', () => {
    for (const href of ['/', '/#faq', '/docs', '/docs/components/toaster', '/toaster/playground', '/toaster/frame', '/proto/b', '/nope']) {
      expect(sceneOf(href)).toBeNull();
    }
  });

  it('puts the open type and the scene on a scene link', () => {
    expect(openTypes('toaster')).toEqual([SCENE_OPEN, 'scene-toaster']);
    expect(sceneOfTypes(openTypes('color-palette'))).toBe('color-palette');
    expect(sceneOfTypes([SCENE_BACK])).toBeNull();
  });

  it('opens on back and forward from the kit page into a landing, and goes back the other way', () => {
    expect(traversalTypes('/', '/toaster')).toEqual([SCENE_OPEN, sceneType('toaster')]);
    expect(traversalTypes('/', '/color-picker#palette')).toEqual([SCENE_OPEN, sceneType('color-palette')]);
    expect(traversalTypes('/toaster', '/')).toEqual([SCENE_BACK, sceneType('toaster')]);
    expect(traversalTypes('/color-picker#palette', '/')).toEqual([SCENE_BACK, sceneType('color-palette')]);
    expect(traversalTypes('/color-picker', '/#color-picker')).toEqual([SCENE_BACK, sceneType('color-picker')]);
  });

  it('leaves every other move through history plain: the header, the footers and the docs never morph', () => {
    const plain: [string, string][] = [
      ['/', '/docs'],
      ['/docs', '/'],
      ['/docs/components/toaster', '/toaster'],
      ['/toaster', '/docs/components/toaster'],
      ['/toaster', '/color-picker'],
      ['/color-picker', '/toaster'],
      ['/toaster', '/toaster/playground'],
      ['/', '/#faq'],
      ['/toaster', '/toaster'],
    ];
    for (const [from, to] of plain) expect(traversalTypes(from, to)).toBeNull();
  });

  it('opens the color picker in the colors of the chapter, before the hash', () => {
    expect(withColors('/color-picker', ['#ff6a3d'])).toBe('/color-picker?c=ff6a3d');
    expect(withColors('/color-picker#palette', ['#ff6a3d', '#2f8f9d', '#f2b84b'])).toBe('/color-picker?c=ff6a3d,2f8f9d,f2b84b#palette');
    expect(withColors('/toaster', [])).toBe('/toaster');
  });
});
