import { useEffect, useId, useRef, useState } from 'react';
import type { CloudletMotionOverrides } from '@cloudlet/toast';
import { applyOverrides, designMotion, diffFromDesign, motionSections, parseTuning, readField, setField, tuningJson } from './design-motion.js';

const STORAGE_KEY = 'cloudlet-lab-motion-overrides';

/** Overrides survive a reload of this browser only; storage may be unavailable (private mode). */
export function useMotionOverrides() {
  const [overrides, setOverrides] = useState<CloudletMotionOverrides>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      const parsed = stored ? parseTuning(stored) : null;
      return parsed?.ok ? parsed.overrides : {};
    } catch { return {}; }
  });
  useEffect(() => {
    try {
      if (Object.keys(overrides).length) localStorage.setItem(STORAGE_KEY, JSON.stringify(overrides));
      else localStorage.removeItem(STORAGE_KEY);
    } catch { /* Storage is a convenience only. */ }
  }, [overrides]);
  return [overrides, setOverrides] as const;
}

export const timeScales = ['1', '0.5', '0.25', '0.1'] as const;

/**
 * DESIGN §7 tuning (task 16): every field writes `Toaster motion.overrides` on change and
 * applies to the next transition without a rebuild. JSON carries complete values for task 17.
 */
export function MotionPanel({ overrides, setOverrides, timeScale, setTimeScale }: {
  overrides: CloudletMotionOverrides; setOverrides: (value: CloudletMotionOverrides) => void;
  timeScale: string; setTimeScale: (value: string) => void;
}) {
  const values = applyOverrides(overrides);
  const changed = diffFromDesign(values);
  const count = Object.values(changed).reduce<number>((sum, value) => sum + (typeof value === 'number' ? 1 : Object.keys(value ?? {}).length), 0);
  const json = tuningJson(Number(timeScale), overrides);
  const [draft, setDraft] = useState<string | null>(null);
  const [status, setStatus] = useState('Значения по DESIGN §7. Изменения применяются к следующему переходу.');
  const area = useRef<HTMLTextAreaElement>(null);
  const id = useId();

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(json);
      setStatus(`JSON скопирован: ${count ? `изменено полей — ${count}` : 'значения DESIGN'}, timeScale ${timeScale}.`);
    } catch {
      setDraft(null);
      area.current?.focus(); area.current?.select();
      setStatus('Буфер обмена недоступен: JSON выделен в поле ниже, скопируйте его вручную.');
    }
  };
  const apply = () => {
    const parsed = parseTuning(draft ?? json);
    if (!parsed.ok) { setStatus(`JSON не применён: ${parsed.error}.`); return; }
    setOverrides(parsed.overrides);
    if (parsed.timeScale !== undefined) {
      const known = timeScales.find(value => Number(value) === parsed.timeScale);
      if (known) setTimeScale(known);
    }
    setDraft(null);
    setStatus('JSON применён.');
  };

  return <section id="motion" className="lab-motion" aria-labelledby={`${id}-title`} data-lab-keep-island="" data-testid="motion-panel" data-changed={count}>
    <div className="lab-motion-head">
      <div><h2 id={`${id}-title`}>Настройка движения</h2>
        <p className="lab-hint">Пружины и длительности DESIGN §7 → <code>Toaster motion.overrides</code> (отладочный канал). Меняйте значение и повторяйте переход: идущая анимация доигрывает со старыми значениями. Сохраняется в этом браузере.</p></div>
      <div className="lab-buttons">
        <button type="button" disabled={!count} onClick={() => { setOverrides({}); setDraft(null); setStatus('Сброшено к DESIGN §7.'); }}>Сбросить к DESIGN</button>
        <button type="button" className="lab-primary" onClick={() => void copy()}>Скопировать JSON</button>
      </div>
    </div>
    <div className="lab-motion-speed" role="group" aria-label="Скорость переходов">
      <span>timeScale</span>{timeScales.map(value => <button key={value} type="button" aria-pressed={timeScale === value} onClick={() => setTimeScale(value)}>×{value}</button>)}
    </div>
        <p className="lab-hint" role="status" data-testid="motion-status">{status}</p>
    <div className="lab-motion-grid">{motionSections.map(section => <fieldset key={section.title} className="lab-motion-group">
      <legend>{section.title}</legend><p className="lab-hint">{section.note}</p>
      {section.fields.map(field => {
        const value = readField(values, field.path);
        const base = readField(designMotion, field.path);
        return <NumberField key={field.path} name={field.path} label={field.label} unit={field.unit} step={field.step} min={field.min}
          value={value} base={base} describedBy={`${id}-${field.path}`}
          onCommit={next => setOverrides(setField(overrides, field.path, next))} />;
      })}
    </fieldset>)}</div>
    <details className="lab-motion-json">
      <summary>JSON настроек{count ? ` · изменено ${count}` : ''}</summary>
      <p className="lab-hint">Формат: <code>{'{ timeScale, motion, changed }'}</code> — <code>motion</code> содержит все значения (форма <code>CloudletMotionConstants</code>), <code>changed</code> — только отличия от DESIGN. Можно вставить сюда JSON из задачи 17 и применить.</p>
      <textarea ref={area} aria-label="JSON настроек движения" data-testid="motion-json" spellCheck={false} rows={14}
        value={draft ?? json} onChange={event => setDraft(event.currentTarget.value)} />
      <div className="lab-buttons"><button type="button" onClick={apply}>Применить JSON</button>{draft !== null && <button type="button" onClick={() => setDraft(null)}>Отменить правку</button>}</div>
    </details>
  </section>;
}

/** Keeps the typed text while editing (empty, «0.») and commits only valid numbers. */
function NumberField({ name, label, unit, step, min, value, base, describedBy, onCommit }: {
  name: string; label: string; unit: string; step: number; min: number; value: number; base: number; describedBy: string;
  onCommit: (value: number) => void;
}) {
  const [text, setText] = useState<string | null>(null);
  return <label data-changed={value !== base ? 'true' : undefined}>
    <span>{label}{unit && <small> · {unit}</small>}</span>
    <input type="number" inputMode="decimal" name={name} value={text ?? String(value)} step={step} min={min} aria-describedby={describedBy}
      onChange={event => {
        const input = event.currentTarget;
        setText(input.value);
        const next = input.valueAsNumber;
        if (Number.isFinite(next) && next >= min && (min > 0 || next >= 0)) onCommit(next);
      }}
      onBlur={() => setText(null)} />
    <small id={describedBy} className="lab-motion-base">{value !== base ? `DESIGN: ${base}` : 'как в DESIGN'}</small>
  </label>;
}
