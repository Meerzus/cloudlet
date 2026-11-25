/**
 * Compile-only: the Toaster adapter and the agent bridge declare the same protocol on their own,
 * because @cloudlet/toast may not import @cloudlet/agent. These assignments fail the typecheck
 * as soon as the two copies drift apart.
 */
import { createAgent, type AgentComponent, type AgentEntry } from '@cloudlet/agent';
import { createCloudlet } from '../../packages/toast/src/index.js';
import { toasterAgent, type AgentComponentShape, type AgentEntryShape, type ToasterAgent } from '../../packages/toast/src/agent.js';

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
