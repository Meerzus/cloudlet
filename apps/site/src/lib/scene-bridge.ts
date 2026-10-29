import type { ScrollTrigger } from 'gsap/ScrollTrigger';

/**
 * The seam between scene 2 and scene 3 (LANDING §7–§8). Scene 2 publishes its pinned
 * timeline and, on every update, how far its last toast has drifted away as a cloud.
 * Scene 3 builds once scene 2 is published (so its pin is measured after scene 2's) and
 * launches its volley from its own trigger after scene 2 ends; the drift feed stays for
 * effects tied to the cloud itself.
 */

export interface LifeDrift {
  /** 0 before the drift starts, 1 when the cloud has left; scrubs both ways. */
  readonly progress: number;
  /** Where the cloud is now, in viewport coordinates (null while hidden). */
  readonly rect: DOMRect | null;
}

export interface LifeSceneHandle {
  /** The scrubbed master timeline; its labels are the snap targets (`drift` is the last plateau, `end` the exit). */
  readonly timeline: gsap.core.Timeline;
  readonly trigger: ScrollTrigger;
  /** Timeline seconds where the toast starts to drift away: the hand-off to scene 3 (not a snap label). */
  readonly driftStart: number;
}

type Listener<T> = (value: T) => void;

let scene: LifeSceneHandle | null = null;
let drift: LifeDrift = { progress: 0, rect: null };
const sceneListeners = new Set<Listener<LifeSceneHandle | null>>();
const driftListeners = new Set<Listener<LifeDrift>>();

export const lifeBridge = {
  publish(handle: LifeSceneHandle | null) {
    scene = handle;
    for (const listener of sceneListeners) listener(handle);
  },
  drift(value: LifeDrift) {
    if (value.progress === drift.progress && value.rect === drift.rect) return;
    drift = value;
    for (const listener of driftListeners) listener(value);
  },
  /** Calls back now and on every (re)build; null when the scene is torn down (reduced motion). */
  onScene(listener: Listener<LifeSceneHandle | null>) {
    sceneListeners.add(listener);
    listener(scene);
    return () => void sceneListeners.delete(listener);
  },
  onDrift(listener: Listener<LifeDrift>) {
    driftListeners.add(listener);
    listener(drift);
    return () => void driftListeners.delete(listener);
  },
};
