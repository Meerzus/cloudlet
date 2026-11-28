import { createAgent, type AgentComponent, type AgentEntry } from '@cloudlet/agent';
import { createCloudlet } from '@cloudlet/toast';
import { toasterAgent, type AgentComponentShape, type ToasterAgent } from '@cloudlet/toast/agent';

// Both packed archives together: the adapter is what connect takes, with no cast, and back.
const agent = createAgent();
const toaster: ToasterAgent = toasterAgent(createCloudlet());
const disconnect: () => void = agent.connect(toaster);
const secondary: AgentComponent = toasterAgent(createCloudlet(), { name: 'secondary' });
agent.connect(secondary);
export function backward(bridgeComponent: AgentComponent): AgentComponentShape {
  return bridgeComponent;
}
const records: readonly AgentEntry[] = agent.snapshot();
void records;
disconnect();
