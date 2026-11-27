/**
 * Compile-only: the Toaster adapter and the agent bridge declare the same protocol on their own,
 * because @cloudlet/toast may not import @cloudlet/agent. These checks fail the typecheck as soon
 * as the two copies drift apart.
 */
import {
  createAgent, type ActResult, type AgentComponent, type AgentEntry, type AgentPermission, type AgentRunContext,
  type AgentRunOutcome, type AgentSignal, type AgentStepCall, type AgentStepCheck, type AgentStepNames, type AgentSummonOutcome,
  type AgentValue,
} from '@cloudlet/agent';
import { createCloudlet } from '../../packages/toast/src/index.js';
import {
  toasterAgent, type AgentComponentShape, type AgentEntryShape, type AgentPermissionShape, type AgentRunContextShape,
  type AgentRunOutcomeShape, type AgentSignalShape, type AgentStepCallShape, type AgentStepCheckShape,
  type AgentStepNamesShape, type AgentSummonOutcomeShape, type AgentValueShape, type ToasterAgent,
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
same<AgentComponent, AgentComponentShape>(true);

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
