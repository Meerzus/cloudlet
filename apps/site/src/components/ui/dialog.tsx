'use client';

import { createContext, useContext, useEffect, useId, useRef, type ComponentProps, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

/*
 * shadcn/ui Dialog (new-york) API, application-owned, on the native `<dialog>` instead of Radix:
 * the site has no `@radix-ui/react-dialog`, and `showModal()` already gives the focus trap, inert
 * page, Escape, the top layer and focus return. `Dialog` is controlled (`open`/`onOpenChange`);
 * a click on the backdrop closes it. An element with `data-autofocus` gets the focus on open.
 */

interface DialogState {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly titleId: string;
  readonly descriptionId: string;
}

const DialogContext = createContext<DialogState | null>(null);

function useDialog(): DialogState {
  const state = useContext(DialogContext);
  if (!state) throw new Error('Dialog parts must be inside <Dialog>');
  return state;
}

function Dialog({ open, onOpenChange, children }: { open: boolean; onOpenChange: (open: boolean) => void; children: ReactNode }) {
  const titleId = useId();
  const descriptionId = useId();
  return <DialogContext value={{ open, onOpenChange, titleId, descriptionId }}>{children}</DialogContext>;
}

function DialogContent({ className, children, onClick, ...props }: ComponentProps<'dialog'>) {
  const { open, onOpenChange, titleId, descriptionId } = useDialog();
  const ref = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    const dialog = ref.current;
    if (!dialog) return;
    if (open && !dialog.open) {
      dialog.showModal();
      dialog.querySelector<HTMLElement>('[data-autofocus]')?.focus();
    } else if (!open && dialog.open) {
      dialog.close();
    }
  }, [open]);

  return (
    <dialog
      ref={ref}
      data-slot="dialog-content"
      aria-labelledby={titleId}
      aria-describedby={descriptionId}
      // Escape and `close()` both end here: the state follows the element.
      onClose={() => onOpenChange(false)}
      onClick={(event) => {
        onClick?.(event);
        if (event.target === ref.current) onOpenChange(false);
      }}
      className={cn(
        'fixed inset-0 m-auto h-fit max-h-[calc(100dvh-2rem)] w-[calc(100vw-2rem)] max-w-lg overflow-hidden rounded-2xl border border-border bg-popover p-0 text-popover-foreground shadow-2xl',
        'backdrop:bg-foreground/35 backdrop:backdrop-blur-[4px] open:animate-in open:fade-in-0 open:zoom-in-95 motion-reduce:open:animate-none',
        className,
      )}
      {...props}
    >
      {children}
    </dialog>
  );
}

function DialogTitle({ className, ...props }: ComponentProps<'h2'>) {
  const { titleId } = useDialog();
  return <h2 id={titleId} data-slot="dialog-title" className={cn('text-lg font-semibold leading-none', className)} {...props} />;
}

function DialogDescription({ className, ...props }: ComponentProps<'p'>) {
  const { descriptionId } = useDialog();
  return <p id={descriptionId} data-slot="dialog-description" className={cn('text-sm text-muted-foreground', className)} {...props} />;
}

export { Dialog, DialogContent, DialogDescription, DialogTitle };
