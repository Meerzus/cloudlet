'use client';

import { FoldHorizontal, UnfoldHorizontal } from 'lucide-react';
import type { FoldPose } from '@/lib/devices';
import { ControlSlot } from './control-slot';

/**
 * The foldable's Fold / Unfold button. Its slot is collapsed (and inert) for other devices, and
 * choosing the foldable springs it open; the Fold ↔ Unfold label change springs the same way.
 */
export function FoldToggle({
  shown,
  pose,
  onToggle,
}: {
  shown: boolean;
  pose: FoldPose;
  onToggle: () => void;
}) {
  const open = pose === 'open';
  return (
    <ControlSlot shown={shown} className="max-md:hidden">
      <button type="button" className="device-fold" aria-pressed={open} onClick={onToggle}>
        {open ? (
          <FoldHorizontal className="size-4" aria-hidden="true" />
        ) : (
          <UnfoldHorizontal className="size-4" aria-hidden="true" />
        )}
        {open ? 'Fold' : 'Unfold'}
      </button>
    </ControlSlot>
  );
}
