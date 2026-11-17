import { paletteParam } from './picker-start';
import { COMPONENTS, KIT_PATH, type RegistryItem } from './site';

/**
 * Which navigations play the scene transition (the kit's page into a component's landing and back):
 * only the "Open …" links of the kit's scenes, and the browser's back and forward between the two
 * pages. Every other link — the header, its Components panel, the footers, the docs — carries no
 * type, and with no type nothing animates.
 */

/** A scene's way out of the kit's page: the component whose landing it opens. */
export type SceneId = RegistryItem;

/** The type of a navigation from the kit's page into a landing (a scene's link, or forward in history). */
export const SCENE_OPEN = 'scene-open';
/** The type of the way back from a landing to the kit's page (back in history). */
export const SCENE_BACK = 'scene-back';

/**
 * Each component and the landing its scene's link opens, as `href` (a section of a landing carries
 * its hash): taken from the kit's list, so a new component's scene opens its landing the same way.
 */
export const SCENE_LANDINGS = Object.fromEntries(COMPONENTS.map((component) => [component.id, component.path])) as Readonly<Record<SceneId, string>>;

/** The type that names the scene: the way back finds the link the landing shrinks into. */
export const sceneType = (scene: SceneId): string => `scene-${scene}`;

/** The types a scene's link puts on its navigation. */
export const openTypes = (scene: SceneId): string[] => [SCENE_OPEN, sceneType(scene)];

/** `href` without its query and hash: `/color-picker?c=ff6a3d#palette` → `/color-picker`. */
export const pathOf = (href: string): string => href.replace(/[?#].*$/su, '') || '/';

const hashOf = (href: string): string => /#.*$/su.exec(href)?.[0] ?? '';

/**
 * The scene whose landing `href` is: a section of a landing (its hash) before the landing itself, so
 * `/color-picker#palette` is the palette's and `/color-picker` the picker's. Null for any other page.
 */
export function sceneOf(href: string): SceneId | null {
  const path = pathOf(href);
  const hash = hashOf(href);
  const scenes = (Object.entries(SCENE_LANDINGS) as [SceneId, string][]).sort(([, a], [, b]) => hashOf(b).length - hashOf(a).length);
  return scenes.find(([, landing]) => pathOf(landing) === path && (hashOf(landing) === '' || hashOf(landing) === hash))?.[0] ?? null;
}

/**
 * The types of a move through history from `from` to `to` (each a path with its hash): the kit's page
 * into a landing opens it, a landing back to the kit's page goes back; anything else has none.
 */
export function traversalTypes(from: string, to: string): string[] | null {
  if (pathOf(from) === KIT_PATH) {
    const scene = sceneOf(to);
    return scene ? openTypes(scene) : null;
  }
  if (pathOf(to) === KIT_PATH) {
    const scene = sceneOf(from);
    return scene ? [SCENE_BACK, sceneType(scene)] : null;
  }
  return null;
}

/** The scene a navigation's types name, if any. */
export function sceneOfTypes(types: readonly string[]): SceneId | null {
  return (Object.keys(SCENE_LANDINGS) as SceneId[]).find((scene) => types.includes(sceneType(scene))) ?? null;
}

/**
 * A landing's link with the colors it should open in (`?c=`, before the hash): the color picker's
 * landing then starts in the chapter's color, so its paint continues the chapter's.
 */
export function withColors(href: string, colors: readonly string[]): string {
  if (colors.length === 0) return href;
  return `${pathOf(href)}?c=${paletteParam(colors)}${hashOf(href)}`;
}
