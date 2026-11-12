'use client';

import { useEffect, useRef, useState, type ReactNode, type RefObject } from 'react';
import type { FlutedScene, GlassLook } from './fluted-glass';

const REDUCED = '(prefers-reduced-motion: reduce)';

interface GlassCardProps {
  /** The material behind the glass: `material-<frame>-1280` in public/picker. */
  readonly frame: 'opacity' | 'tools';
  readonly look: GlassLook;
  readonly className?: string;
  /** Filled with the glass once it draws, null without WebGL 2 (Tools reads the drift from it). */
  readonly scene?: RefObject<FlutedScene | null>;
  /** The picture, decoded: the glass's texture and the plain card without WebGL 2. */
  readonly image?: RefObject<HTMLImageElement | null>;
  /** Called once the picture is decoded (Tools reads its pixels then). */
  readonly onImage?: (image: HTMLImageElement) => void;
  /** Layers over the glass: the film in Opacity. */
  readonly children?: ReactNode;
}

/**
 * A card of fluted glass over a frame in its own colors (COLOR_PICKER §8.6–§8.8). The picture is
 * fetched once the card comes within a screen of the viewport, and Paper Shaders' glass (a chunk of
 * its own) is loaded after it; until then, and for good without WebGL 2, the card is the plain picture.
 * The scene drifts behind the glass on screen and in a visible tab, and holds still under reduced motion.
 */
export function GlassCard({ frame, look, className, scene, image, onImage, children }: GlassCardProps) {
  const card = useRef<HTMLDivElement>(null);
  const host = useRef<HTMLDivElement>(null);
  const ownImage = useRef<HTMLImageElement>(null);
  const img = image ?? ownImage;
  const [near, setNear] = useState(false);
  const [glass, setGlass] = useState(false);
  const lookRef = useRef(look);
  lookRef.current = look;
  const instance = useRef<FlutedScene | null>(null);

  useEffect(() => {
    const element = card.current;
    if (!element || near) return;
    const observer = new IntersectionObserver(([entry]) => entry?.isIntersecting && setNear(true), { rootMargin: '100% 0px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [near]);

  useEffect(() => {
    const picture = img.current;
    const mount = host.current;
    if (!near || !picture || !mount) return;
    let alive = true;
    const cleanups: (() => void)[] = [];

    const start = async () => {
      if (!picture.complete || picture.naturalWidth === 0) return;
      try {
        await picture.decode();
      } catch {
        return;
      }
      if (!alive) return;
      onImage?.(picture);
      const { FlutedScene } = await import('./fluted-glass');
      if (!alive) return;
      const created = FlutedScene.create(mount, picture, lookRef.current);
      if (!created) return;
      instance.current = created;
      if (scene) scene.current = created;

      const reduced = window.matchMedia(REDUCED);
      const motion = () => created.setMoving(!reduced.matches);
      motion();
      reduced.addEventListener('change', motion);
      let onScreen = true;
      const sync = () => created.setActive(onScreen && document.visibilityState === 'visible');
      const view = new IntersectionObserver(([entry]) => {
        onScreen = entry?.isIntersecting ?? true;
        sync();
      });
      view.observe(mount);
      document.addEventListener('visibilitychange', sync);
      const lost = (event: Event) => {
        event.preventDefault();
        setGlass(false);
      };
      created.canvas.addEventListener('webglcontextlost', lost);
      cleanups.push(() => {
        reduced.removeEventListener('change', motion);
        view.disconnect();
        document.removeEventListener('visibilitychange', sync);
        created.canvas.removeEventListener('webglcontextlost', lost);
        created.destroy();
        instance.current = null;
        if (scene) scene.current = null;
      });
      setGlass(true);
    };

    const load = () => void start();
    picture.addEventListener('load', load, { once: true });
    load();
    return () => {
      alive = false;
      picture.removeEventListener('load', load);
      for (const cleanup of cleanups) cleanup();
      setGlass(false);
    };
    // The look is read when the glass starts; later looks go through the effect below.
  }, [near]);

  useEffect(() => {
    instance.current?.setLook(look);
  }, [look]);

  return (
    <div ref={card} className={['cp-glass-card', className].filter(Boolean).join(' ')} data-glass={glass || undefined}>
      {near && (
        <picture>
          <source type="image/avif" srcSet={`/picker/material-${frame}-1280.avif`} />
          {/* eslint-disable-next-line @next/next/no-img-element -- the glass's texture and the card without WebGL 2 */}
          <img ref={img} className="cp-glass-image" src={`/picker/material-${frame}-1280.webp`} alt="" decoding="async" />
        </picture>
      )}
      <div ref={host} className="cp-glass-host" aria-hidden="true" />
      {children}
    </div>
  );
}
