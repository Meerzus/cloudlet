/**
 * Compile-only: the Toaster adapter, the Color picker adapter (shared by the palette's) and the agent bridge declare the same
 * protocol on their own, because @cloudlet/toast and the registry components may not import
 * @cloudlet/agent. These checks fail the typecheck as soon as a copy drifts apart.
 */
import {
  createAgent, type ActResult, type Agent, type AgentChange, type AgentComponent, type AgentEntry, type AgentPermission, type AgentRunContext,
  type AgentRunOutcome, type AgentSignal, type AgentStepCall, type AgentStepCheck, type AgentStepNames, type AgentSummonOutcome,
  type AgentValue, type AgentVerbs,
} from '@cloudlet/agent';
import * as palette from '@/components/ui/color-palette/color-palette-agent';
import * as picker from '@/components/ui/color-picker/color-picker-agent';
import { createCloudlet } from '../../packages/toast/src/index.js';
import {
  toasterAgent, type AgentChangeShape, type AgentComponentShape, type AgentEntryShape, type AgentPermissionShape, type AgentRunContextShape,
  type AgentRunOutcomeShape, type AgentSignalShape, type AgentStepCallShape, type AgentStepCheckShape,
  type AgentStepNamesShape, type AgentSummonOutcomeShape, type AgentValueShape, type AgentVerbsShape, type ToasterAgent,
} from '../../packages/toast/src/agent.js';

/** True only when A and B are the same type, including readonly and optional modifiers. */
type Same<A, B> = (<T>() => T extends A ? 1 : 2) extends (<T>() => T extends B ? 1 : 2) ? true : false;
const same = <A, B>(proof: Same<A, B>): void => { void proof; };

// Every protocol type, one by one: assignability alone would let a narrower copy slip through.
same<AgentEntry, AgentEntryShape>(true);
same<AgentSignal, AgentSignalShape>(true);
same<AgentValue, AgentValueShape>(true);
same<AgentPermission, AgentPermissionShape>(true);
same<AgentStepCall, AgentStepCallShape>(true);
same<AgentStepNames, AgentStepNamesShape>(true);
same<AgentStepCheck, AgentStepCheckShape>(true);
same<AgentRunContext, AgentRunContextShape>(true);
same<AgentRunOutcome, AgentRunOutcomeShape>(true);
same<AgentSummonOutcome, AgentSummonOutcomeShape>(true);
same<AgentChange, AgentChangeShape>(true);
same<AgentVerbs, AgentVerbsShape>(true);
same<AgentComponent, AgentComponentShape>(true);

// The Color picker's copy, which the palette's adapter shares.
same<AgentEntry, picker.AgentEntryShape>(true);
same<AgentSignal, picker.AgentSignalShape>(true);
same<AgentValue, picker.AgentValueShape>(true);
same<AgentPermission, picker.AgentPermissionShape>(true);
same<AgentStepCall, picker.AgentStepCallShape>(true);
same<AgentStepNames, picker.AgentStepNamesShape>(true);
same<AgentStepCheck, picker.AgentStepCheckShape>(true);
same<AgentRunContext, picker.AgentRunContextShape>(true);
same<AgentRunOutcome, picker.AgentRunOutcomeShape>(true);
same<AgentSummonOutcome, picker.AgentSummonOutcomeShape>(true);
same<AgentChange, picker.AgentChangeShape>(true);
same<AgentVerbs, picker.AgentVerbsShape>(true);
same<AgentComponent, picker.AgentComponentShape>(true);
same<Agent['connect'], picker.AgentConnectorShape['connect']>(true);

export function verifyAgentProtocol(bridgeComponent: AgentComponent, bridgeEntry: AgentEntry, toasterEntry: AgentEntryShape) {
  const agent = createAgent();
  // The adapter's result is what connect takes, with no cast.
  const disconnect: () => void = agent.connect(toasterAgent(createCloudlet()));
  const adapter: ToasterAgent = toasterAgent(createCloudlet(), { name: 'secondary' });
  const forward: AgentComponent = adapter;
  // The bridge's component and record fit the adapter's copies of them.
  const backward: AgentComponentShape = bridgeComponent;
  const entry: AgentEntryShape = bridgeEntry;
  const entryBack: AgentEntry = toasterEntry;
  void [disconnect, forward, backward, entry, entryBack];
}

export function verifyPickerAgent(bridgeEntry: AgentEntry, pickerRecord: picker.ColorPickerEntry) {
  // An agent is what the hook takes, with no cast, and the picker's record is a bridge record.
  const connector: picker.AgentConnectorShape = createAgent();
  const pickerEntry: AgentEntry = pickerRecord;
  // @ts-expect-error A bridge record is not necessarily the picker's.
  const narrowed: picker.ColorPickerEntry = bridgeEntry;
  void [connector, pickerEntry, narrowed];
}

export function verifyPaletteAgent(bridgeEntry: AgentEntry, paletteRecord: palette.ColorPaletteEntry) {
  // The palette's record is a bridge record; its hook takes what the picker's does.
  const connector: Parameters<typeof palette.useColorPaletteAgent>[0] = createAgent();
  const paletteEntry: AgentEntry = paletteRecord;
  // @ts-expect-error A bridge record is not necessarily the palette's.
  const narrowed: palette.ColorPaletteEntry = bridgeEntry;
  void [connector, paletteEntry, narrowed];
}

export async function verifyAct(): Promise<string | undefined> {
  // The platform's AbortSignal is what act takes.
  const controller = new AbortController();
  const agent = createAgent({
    timeout: 1_000,
    allow: async (step, { signal }) => !step.needsPerson && !signal.aborted,
  });
  const result: ActResult = await agent.act({ steps: [{ ref: 'toaster', action: 'clear' }] }, { signal: controller.signal });
  // @ts-expect-error A step names its record by ref.
  void agent.act({ steps: [{ action: 'clear' }] });
  return result.ok ? result.steps[0]?.ref : result.error.message;
}
