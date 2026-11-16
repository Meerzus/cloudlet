'use client';

import { useCallback, useEffect, useState } from 'react';
import { SLOGANS, type ProtoId, type Slogan } from './slogans';

/** Writes `?s=` in place, keeping every other parameter (the picker's `?c=`) and adding no history entry. */
function writeSlogan(index: number) {
  const url = new URL(window.location.href);
  url.searchParams.set('s', String(index + 1));
  const search = url.search.replace(/%2C/giu, ',');
  window.history.replaceState(window.history.state, '', `${url.pathname}${search}${url.hash}`);
}

/** The prototype's slogan: `?s=1|2|3` on load, then the switch. The server renders the first. */
export function useSlogan(id: ProtoId): { slogan: Slogan; index: number; select: (index: number) => void } {
  const slogans = SLOGANS[id];
  const [index, setIndex] = useState(0);
  useEffect(() => {
    const asked = Number(new URLSearchParams(window.location.search).get('s'));
    if (Number.isInteger(asked) && asked >= 1 && asked <= slogans.length) setIndex(asked - 1);
  }, [slogans.length]);
  const select = useCallback((next: number) => {
    setIndex(next);
    writeSlogan(next);
  }, []);
  return { slogan: slogans[index] ?? slogans[0]!, index, select };
}

/** A small switch in the corner: which slogan the hero prints. Not part of the design being judged. */
export function SloganSwitch({ id, index, onSelect }: { id: ProtoId; index: number; onSelect: (index: number) => void }) {
  return (
    <div role="group" aria-label="Slogan" className="proto-slogans">
      <span aria-hidden="true" className="proto-slogans-label">
        Slogan
      </span>
      {SLOGANS[id].map((slogan, position) => (
        <button
          key={slogan.title}
          type="button"
          aria-pressed={position === index}
          aria-label={`Slogan ${position + 1}: ${slogan.title}`}
          title={slogan.title}
          onClick={() => onSelect(position)}
        >
          {position + 1}
        </button>
      ))}
    </div>
  );
}
