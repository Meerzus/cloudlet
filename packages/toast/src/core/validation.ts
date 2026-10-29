import type { ControllerOptions } from '../contracts/controller.js';
import type { InputIssue } from '../contracts/identity.js';
import type {
  Description,
  NotificationContent,
  NotificationPatch,
  PrimaryAction,
  Progress,
} from '../contracts/notifications.js';

const contentKeys = ['title', 'description', 'icon', 'progress', 'action', 'announcementPriority', 'duration', 'attention'];
const patchKeys = [...contentKeys, 'kind', 'priority'];
const specKeys = [...patchKeys, 'id', 'dedupeKey', 'onClose'];
const messageKeys = [
  'operationSuccess', 'operationError', 'operationCancelled', 'cancellationRequested', 'actionError', 'renderError',
] as const;
const noIssues: readonly InputIssue[] = Object.freeze([]);
const owns = Object.hasOwn;
const at = (path: string, key: PropertyKey): string => path ? `${path}.${String(key)}` : String(key);

function issue(issues: InputIssue[], path: string, message: string): void {
  issues.push(Object.freeze({ path, message }));
}

/** Only Cloudlet-owned data records are inspected. Opaque slots are never passed here. */
function record(
  value: unknown,
  path: string,
  keys: readonly string[],
  issues: InputIssue[],
  undefinedKeys: readonly string[] = [],
): Record<string, unknown> | undefined {
  if (value === null || typeof value !== 'object' ||
      (Object.getPrototypeOf(value) !== Object.prototype && Object.getPrototypeOf(value) !== null)) {
    issue(issues, path, 'Expected a plain object');
    return undefined;
  }
  let hasAccessor = false;
  for (const key of Reflect.ownKeys(value)) {
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (typeof key !== 'string' || !keys.includes(key)) {
      issue(issues, at(path, key), 'Unknown field');
    }
    if (descriptor && !('value' in descriptor)) {
      issue(issues, at(path, key), 'Expected a data property');
      hasAccessor = true;
    } else if (descriptor?.value === undefined &&
               (typeof key !== 'string' || !undefinedKeys.includes(key))) {
      issue(issues, at(path, key), 'Omit optional fields instead of passing undefined');
    }
  }
  return hasAccessor ? undefined : value as Record<string, unknown>;
}

type Rule = 'string' | 'nonempty string' | 'function' | 'boolean' | readonly string[];
type Fields = readonly (readonly [key: string, rule: Rule, required?: boolean | 'own'])[];

/** Optional undefined is already diagnosed by record; required fields still validate. */
function fields(data: Record<string, unknown>, issues: InputIssue[], path: string, rules: Fields): void {
  for (const [key, rule, required] of rules) {
    const own = owns(data, key);
    if (!required && (!own || data[key] === undefined)) continue;
    const value = required === 'own' && !own ? undefined : data[key];
    const valid = typeof rule === 'string'
      ? rule === 'nonempty string' ? typeof value === 'string' && value.trim().length > 0 : typeof value === rule
      : typeof value === 'string' && rule.includes(value);
    if (!valid) issue(issues, at(path, key), typeof rule === 'string' ? `Expected a ${rule}` : `Expected one of: ${rule.join(', ')}`);
  }
}

function forbidden(data: Record<string, unknown>, issues: InputIssue[], path: string, keys: readonly string[], variant: string): void {
  for (const key of keys) if (owns(data, key)) issue(issues, at(path, key), `Field is not allowed for ${variant}`);
}

function description(value: unknown, issues: InputIssue[]): void {
  const data = record(value, 'description', ['kind', 'text', 'content', 'announcement'], issues, ['content']);
  if (!data) return;
  if (data.kind === 'text') {
    forbidden(data, issues, 'description', ['content', 'announcement'], 'a text description');
    fields(data, issues, 'description', [['text', 'string', 'own']]);
  } else if (data.kind === 'rich') {
    forbidden(data, issues, 'description', ['text'], 'a rich description');
    if (!owns(data, 'content')) issue(issues, 'description.content', 'Required field');
    fields(data, issues, 'description', [['announcement', 'nonempty string', 'own']]);
  } else fields(data, issues, 'description', [['kind', ['text', 'rich'], true]]);
}

function progress(value: unknown, issues: InputIssue[]): void {
  const data = record(value, 'progress', ['kind', 'value', 'label'], issues);
  if (!data) return;
  if (data.kind === 'determinate') {
    if (typeof data.value !== 'number' || !Number.isFinite(data.value) || data.value < 0 || data.value > 1) {
      issue(issues, 'progress.value', 'Expected a finite number between 0 and 1');
    }
  } else if (data.kind === 'indeterminate') forbidden(data, issues, 'progress', ['value'], 'indeterminate progress');
  else fields(data, issues, 'progress', [['kind', ['indeterminate', 'determinate'], true]]);
  fields(data, issues, 'progress', [['label', 'string']]);
}

function safeHref(value: string): boolean {
  // URL parsers strip controls before interpreting schemes; rejecting them prevents scheme obfuscation.
  if (/[\u0000-\u001f\u007f]/u.test(value)) return false;
  const href = value.trim();
  const colon = href.indexOf(':');
  const boundary = href.search(/[/?#]/u);
  if (colon === -1 || (boundary !== -1 && boundary < colon)) return true;
  const scheme = href.slice(0, colon).toLowerCase();
  return ['http', 'https', 'mailto', 'tel'].includes(scheme);
}

function action(value: unknown, issues: InputIssue[]): void {
  const data = record(value, 'action', ['kind', 'label', 'run', 'errorMessage', 'href', 'target', 'rel'], issues);
  if (!data) return;
  fields(data, issues, 'action', [['label', 'nonempty string', true]]);
  if (data.kind === 'command') {
    forbidden(data, issues, 'action', ['href', 'target', 'rel'], 'a command action');
    fields(data, issues, 'action', [['run', 'function', true], ['errorMessage', 'function']]);
  } else if (data.kind === 'link') {
    forbidden(data, issues, 'action', ['run', 'errorMessage'], 'a link action');
    fields(data, issues, 'action', [['href', 'nonempty string', true]]);
    if (typeof data.href === 'string' && !safeHref(data.href)) issue(issues, 'action.href', 'Unsupported or unsafe URL');
    fields(data, issues, 'action', [['target', ['_self', '_blank', '_parent', '_top']], ['rel', 'string']]);
  } else fields(data, issues, 'action', [['kind', ['command', 'link'], true]]);
}

function common(data: Record<string, unknown>, issues: InputIssue[], patch: boolean): void {
  fields(data, issues, '', [
    ['title', 'nonempty string', !patch || owns(data, 'title')],
    ['kind', ['info', 'success', 'loading', 'warning', 'error']],
    ['priority', ['normal', 'high']], ['announcementPriority', ['polite', 'assertive', 'off']],
    ['attention', ['auto', 'open', 'stack']],
  ]);
  for (const [key, validate] of [['description', description], ['progress', progress], ['action', action]] as const) {
    if (owns(data, key) && data[key] !== undefined && !(patch && data[key] === null)) validate(data[key], issues);
  }
  if (owns(data, 'duration') && data.duration !== undefined && data.duration !== null &&
      (typeof data.duration !== 'number' || !Number.isFinite(data.duration) || data.duration < 0)) {
    issue(issues, 'duration', 'Expected null or a finite nonnegative duration');
  }
}

function finish(issues: InputIssue[]): readonly InputIssue[] {
  return issues.length === 0 ? noIssues : Object.freeze(issues);
}

export function validateSpec(value: unknown): readonly InputIssue[] {
  const issues: InputIssue[] = [];
  const data = record(value, '', specKeys, issues);
  if (data) {
    common(data, issues, false);
    fields(data, issues, '', [['id', 'nonempty string'], ['dedupeKey', 'nonempty string'], ['onClose', 'function']]);
  }
  return finish(issues);
}

export function validatePatch(value: unknown): readonly InputIssue[] {
  const issues: InputIssue[] = [];
  const data = record(value, '', patchKeys, issues);
  if (data) common(data, issues, true);
  return finish(issues);
}

/** Operation content cannot set identity, scheduling priority or notification kind. */
export function validateContent(value: unknown, pending = false): readonly InputIssue[] {
  const issues: InputIssue[] = [];
  const data = record(value, '', contentKeys, issues);
  if (data) {
    common(data, issues, false);
    if (pending && owns(data, 'duration')) issue(issues, 'duration', 'Pending content cannot define a duration');
  }
  return finish(issues);
}

/** Validate before copying or invoking user code; mapper output is validated separately. */
export function validateTrackOptions(value: unknown, isFactory: boolean): readonly InputIssue[] {
  const issues: InputIssue[] = [];
  const data = record(value, '', [
    'id', 'priority', 'pending', 'success', 'error', 'cancelled', 'cancel', 'isCancellation', 'onClose',
  ], issues);
  if (!data) return finish(issues);
  fields(data, issues, '', [['id', 'nonempty string'], ['priority', ['normal', 'high']]]);
  for (const key of ['pending', 'success', 'error', 'cancelled'] as const) {
    if (key === 'cancelled' && !owns(data, key)) continue;
    if (key !== 'pending' && typeof data[key] === 'function') continue;
    for (const problem of validateContent(data[key], key === 'pending')) {
      issue(issues, problem.path ? `${key}.${problem.path}` : key, problem.message);
    }
  }
  fields(data, issues, '', [['cancel', 'function'], ['isCancellation', 'function'], ['onClose', 'function']]);
  if (isFactory && owns(data, 'cancel')) issue(issues, 'cancel', 'Factory cancellation uses its attempt signal');
  return finish(issues);
}

/** Attention delays are finite nonnegative milliseconds. */
export const validDelay = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0;

export function validateOptions(options: ControllerOptions | undefined): ControllerOptions {
  if (options === undefined) return Object.freeze({ autoDismiss: true });
  const issues: InputIssue[] = [];
  const data = record(options, '', ['autoDismiss', 'attentionDelay', 'messages', 'onOverflow', 'onDiagnostic'], issues);
  if (data) {
    fields(data, issues, '', [['autoDismiss', 'boolean'], ['onOverflow', 'function'], ['onDiagnostic', 'function']]);
    if (owns(data, 'attentionDelay') && data.attentionDelay !== undefined && typeof data.attentionDelay !== 'number') {
      issue(issues, 'attentionDelay', 'Expected a number');
    }
    if (owns(data, 'messages') && data.messages !== undefined) {
      const messages = record(data.messages, 'messages', messageKeys, issues);
      if (messages) fields(messages, issues, 'messages', messageKeys.map((key) => [key, 'string']));
    }
  }
  if (issues.length) throw new TypeError(issues.map(({ path, message }) => `${path || 'options'}: ${message}`).join('; '));
  if (options.attentionDelay !== undefined && !validDelay(options.attentionDelay)) {
    throw new RangeError('attentionDelay: Expected a finite nonnegative number of milliseconds');
  }
  const result: { -readonly [Key in keyof ControllerOptions]: ControllerOptions[Key] } = { autoDismiss: options.autoDismiss ?? true };
  if (options.attentionDelay !== undefined) result.attentionDelay = options.attentionDelay;
  if (options.messages !== undefined) {
    result.messages = copyFields(options.messages, [], messageKeys);
  }
  if (options.onOverflow !== undefined) result.onOverflow = options.onOverflow;
  if (options.onDiagnostic !== undefined) result.onDiagnostic = options.onDiagnostic;
  return Object.freeze(result);
}

/** Required fields retain undefined opaque slots; each variant has an explicit whitelist. */
function copyFields<Value extends object>(value: Value, required: readonly (keyof Value)[], optional: readonly (keyof Value)[] = []): Value {
  const copy = {} as Value;
  for (const key of [...required, ...optional]) {
    const item = value[key];
    if (required.includes(key) || item !== undefined) copy[key] = item;
  }
  return Object.freeze(copy);
}

function copyDescription<Slot>(value: Description<Slot>): Description<Slot> {
  return value.kind === 'text' ? copyFields(value, ['kind', 'text']) : copyFields(value, ['kind', 'content', 'announcement']);
}

function copyProgress(value: Progress): Progress {
  return value.kind === 'indeterminate' ? copyFields(value, ['kind'], ['label']) : copyFields(value, ['kind', 'value'], ['label']);
}

function copyAction(value: PrimaryAction): PrimaryAction {
  return value.kind === 'command' ? copyFields(value, ['kind', 'label', 'run'], ['errorMessage'])
    : copyFields(value, ['kind', 'label', 'href'], ['target', 'rel']);
}

type MutableContent<Slot> = { -readonly [Key in keyof NotificationContent<Slot>]: NotificationContent<Slot>[Key] };

/** Call after validation. Copy only the library's structures, never the caller's opaque payloads. */
export function copyContent<Slot>(content: NotificationContent<Slot>): Readonly<NotificationContent<Slot>> {
  const copy: MutableContent<Slot> = { title: content.title, announcementPriority: content.announcementPriority ?? 'polite' };
  if (content.description !== undefined) copy.description = copyDescription(content.description);
  if (owns(content, 'icon')) copy.icon = content.icon as Slot;
  if (content.progress !== undefined) copy.progress = copyProgress(content.progress);
  if (content.action !== undefined) copy.action = copyAction(content.action);
  if (content.duration !== undefined) copy.duration = content.duration;
  if (content.attention !== undefined) copy.attention = content.attention;
  return Object.freeze(copy);
}

function equalData(left: object | undefined, right: object | undefined): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every((key) =>
    owns(right, key) && Object.is((left as Record<string, unknown>)[key], (right as Record<string, unknown>)[key]));
}

/** Kind and priority belong to the record; this helper changes only presentation content. */
export function patchContent<Slot>(
  content: Readonly<NotificationContent<Slot>>,
  patch: NotificationPatch<Slot>,
): Readonly<NotificationContent<Slot>> {
  const merged: MutableContent<Slot> = { ...content };
  for (const key of contentKeys as readonly (keyof NotificationContent<Slot>)[]) {
    const value = patch[key];
    if (value === null && ['description', 'icon', 'progress', 'action'].includes(key)) delete merged[key];
    // Fields are copied between the matching keys of these validated shapes.
    else if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  if (merged.title === content.title && merged.announcementPriority === content.announcementPriority &&
      merged.duration === content.duration && owns(merged, 'duration') === owns(content, 'duration') &&
      merged.attention === content.attention &&
      Object.is(merged.icon, content.icon) && owns(merged, 'icon') === owns(content, 'icon') &&
      equalData(merged.description, content.description) && equalData(merged.progress, content.progress) &&
      equalData(merged.action, content.action)) return content;
  return copyContent(merged);
}
