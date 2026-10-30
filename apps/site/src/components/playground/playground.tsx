'use client';

import { Check, Copy } from 'lucide-react';
import Link from 'next/link';
import { useEffect, useId, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useCopy, usePageNotifications, useToasterSettings, type ToasterSettings } from '@/components/site/notifications';
import { useTheme } from '@/components/site/theme';
import { Segmented } from '@/components/site/segmented';
import { DEMO_GROUPS, demosIn, isCodeLabel, type Demo, type DemoGroup } from '@/lib/demos';
import type { ThemePreference } from '@/lib/theme';
import { TOASTER_PATH } from '@/lib/site';
import { cn } from '@/lib/utils';

const THEMES: readonly { value: ThemePreference; label: string }[] = [
  { value: 'system', label: 'System' },
  { value: 'light', label: 'Light' },
  { value: 'dark', label: 'Dark' },
];
const POSITIONS: readonly { value: ToasterSettings['position']; label: string }[] = [
  { value: 'auto', label: 'Auto' },
  { value: 'top-center', label: 'Top' },
  { value: 'bottom-center', label: 'Bottom' },
];
const DIRECTIONS: readonly { value: ToasterSettings['dir']; label: string }[] = [
  { value: 'ltr', label: 'LTR' },
  { value: 'rtl', label: 'RTL' },
];

/**
 * Every demo of the shared catalog on a button, calling the real
 * page-level Toaster. Theme is the site's own; position and direction apply to
 * the page Toaster only while this page is open.
 */
export function Playground() {
  const { preference, setPreference } = useTheme();
  const [position, setPosition] = useState<ToasterSettings['position']>('auto');
  const [dir, setDir] = useState<ToasterSettings['dir']>('ltr');
  useToasterSettings({ position, dir });

  return (
    <main className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
      {/* A panel like the group cards: small text straight on the deep top of the day sky misses 4.5:1. */}
      <div className="rounded-3xl border border-glass-border bg-background/78 p-5 sm:p-8">
        <h1 className="text-balance text-5xl font-semibold tracking-[-0.04em] sm:text-7xl">Playground</h1>
        <p className="mt-4 max-w-2xl text-pretty text-lg text-muted-foreground sm:text-xl">
          Every kind of Cloudlet, one click away. The buttons call the real library on this page; Copy code gives you
          exactly that call.
        </p>
        <p className="mt-3 text-sm text-muted-foreground">
          Snippets assume <code className="font-mono text-foreground">const cloudlet = useCloudlet();</code> ·{' '}
          <Link
            href={`${TOASTER_PATH}#get-started`}
            className="rounded-sm text-foreground underline underline-offset-4 outline-none focus-visible:ring-[3px] focus-visible:ring-ring/60"
          >
            Get started
          </Link>
        </p>
        <div
          role="group"
          aria-label="Toaster settings"
          className="mt-6 flex flex-wrap items-center gap-x-6 gap-y-4 border-t border-glass-border pt-5"
        >
          <Segmented legend="Theme" options={THEMES} value={preference} onChange={setPreference} />
          <Segmented legend="Position" options={POSITIONS} value={position} onChange={setPosition} />
          <Segmented legend="Direction" options={DIRECTIONS} value={dir} onChange={setDir} />
        </div>
      </div>

      <div className="mt-4 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        {DEMO_GROUPS.map((group) => (
          <GroupCard key={group.id} group={group.id} blurb={group.blurb} />
        ))}
      </div>
    </main>
  );
}

function GroupCard({ group, blurb }: { group: DemoGroup; blurb: string }) {
  const titleId = useId();
  // Denser instead of frosted: the cards scroll over the fixed sky, so a backdrop blur is redone
  // under all of them every frame — on integrated graphics most scroll frames missed 60 Hz.
  return (
    <section
      aria-labelledby={titleId}
      className="flex flex-col rounded-3xl border border-glass-border bg-background/72 p-5 sm:p-6"
    >
      <h2 id={titleId} className="text-2xl font-semibold tracking-[-0.02em]">
        {group}
      </h2>
      <p className="mt-2 text-pretty text-sm text-muted-foreground">{blurb}</p>
      <ul className="mt-5 flex flex-col gap-2">
        {demosIn(group).map((demo) => (
          <DemoRow key={demo.id} demo={demo} />
        ))}
      </ul>
    </section>
  );
}

function DemoRow({ demo }: { demo: Demo }) {
  const cloudlet = usePageNotifications();
  return (
    <li className="flex items-center gap-2">
      <Button
        variant="outline"
        className={cn('min-w-0 flex-1 justify-start', isCodeLabel(demo) && 'font-mono')}
        disabled={!cloudlet}
        onClick={() => {
          if (cloudlet) demo.run(cloudlet);
        }}
      >
        <span className="truncate">{demo.label}</span>
      </Button>
      <CopyCode snippet={demo.snippet} label={demo.label} />
    </li>
  );
}

function CopyCode({ snippet, label }: { snippet: string; label: string }) {
  // The button itself confirms; a "Copied" toast would land in the stack being played with.
  const copy = useCopy({ toast: false });
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = window.setTimeout(() => setCopied(false), 1600);
    return () => window.clearTimeout(timer);
  }, [copied]);

  return (
    <button type="button" className="code-copy shrink-0" onClick={async () => setCopied(await copy(snippet))}>
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      {copied ? 'Copied' : 'Copy code'}
      <span className="sr-only">
        {copied ? ' code for ' : ' for '}
        {label}
      </span>
    </button>
  );
}
