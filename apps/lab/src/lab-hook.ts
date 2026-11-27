import type { Agent, AgentCallTool } from '@cloudlet/agent';

/**
 * What the laboratory puts on `window` for end-to-end tests: the page agent's tools, so a test
 * decides itself which tool to call. Laboratory only; no package ships it.
 */
export interface CloudletLabHook {
  /** The page agent's own `callTool`: the same answers, the same queue. */
  readonly callTool: AgentCallTool;
}

declare global {
  interface Window { __cloudletLab?: CloudletLabHook }
}

/** Puts the hook on `view` and returns its removal, which leaves a newer agent's hook alone. */
export function installLabHook(view: Window, agent: Agent): () => void {
  const hook: CloudletLabHook = { callTool: agent.callTool };
  view.__cloudletLab = hook;
  return () => { if (view.__cloudletLab === hook) delete view.__cloudletLab; };
}
