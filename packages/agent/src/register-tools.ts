import { isSignal } from './act.js';
import { ACT, SNAPSHOT } from './tools.js';
import type { Agent, AgentSignal, AgentTool, AgentToolName, AgentToolResult, Allow } from './types.js';

// What the bridge reads of WebMCP (the Community Group draft of 24 November 2026), declared here so
// the package needs neither the DOM library nor a types package. Only the members it uses.

/** `ToolAnnotations`: hints for the browser's agent, all `false` when left out. */
interface WebMcpAnnotations {
  readonly readOnlyHint?: boolean;
  readonly untrustedContentHint?: boolean;
  readonly consequentialHint?: boolean;
}

/** `ModelContextTool`, without `title` and `outputSchema`, which the bridge does not set. */
interface WebMcpTool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: object;
  readonly annotations: WebMcpAnnotations;
  readonly execute: (input: unknown, options?: { readonly signal?: unknown }) => Promise<AgentToolResult>;
}

/** `document.modelContext`: early builds returned no promise from `registerTool`, or threw. */
interface WebMcpContext {
  readonly registerTool: (tool: WebMcpTool, options: { readonly signal: AgentSignal }) => unknown;
}

declare const document: { readonly modelContext?: unknown } | undefined;
declare const reportError: ((error: unknown) => void) | undefined;
declare const AbortController: new () => { readonly signal: AgentSignal; abort(reason?: unknown): void };

/**
 * The options of {@link registerTools}.
 *
 * @experimental WebMCP is a draft behind a flag; this may change in any 0.x release.
 */
export interface RegisterToolsOptions {
  /**
   * The gate for the browser's agent, asked on its every step after the agent's own `allow`, as
   * `ActOptions.allow` describes: a step runs only when both answer `true`, and this one never
   * widens what the agent lets through. WebMCP has no way to ask a person, so the app decides here.
   */
  readonly allow: Allow;
  /**
   * Hears what went wrong registering a tool (a name already taken, a frame without the `tools`
   * permission, an early build that throws). A withdrawn registration is not an error. Without it
   * the error goes to `reportError`, and nowhere when there is none.
   */
  readonly onError?: (error: unknown) => void;
}

const ANNOTATIONS: Readonly<Record<AgentToolName, WebMcpAnnotations>> = Object.freeze({
  [ACT]: Object.freeze({ consequentialHint: true, untrustedContentHint: true }),
  [SNAPSHOT]: Object.freeze({ readOnlyHint: true, untrustedContentHint: true }),
});

const noop = (): void => {};

/** A withdrawn registration rejects with the signal's reason, an `AbortError`; reading a thrown value may throw. */
function isAbort(error: unknown): boolean {
  try { return error !== null && typeof error === 'object' && (error as { name?: unknown }).name === 'AbortError'; } catch { return false; }
}

/** The page's WebMCP, or undefined where the browser has none. */
function modelContext(): WebMcpContext | undefined {
  if (typeof document !== 'object' || document === null) return undefined;
  const context = document.modelContext as Partial<WebMcpContext> | null | undefined;
  return context !== null && typeof context === 'object' && typeof context.registerTool === 'function' ? context as WebMcpContext : undefined;
}

/**
 * Registers the agent's tools, `cloudlet_act` and `cloudlet_snapshot`, with the browser's agent
 * through WebMCP (`document.modelContext.registerTool`), and returns the function that removes them
 * both. Calling that function again does nothing; registering again after it works.
 *
 * Where the browser has no WebMCP it does nothing at all and returns a function that does nothing.
 * A tool's `execute` runs `agent.callTool` with the browser's signal and `allow` as the call's
 * second gate, and never throws: WebMCP passes a thrown error to the agent without its text, so a
 * failure comes back as `{ ok: false, error: { message } }` like any other. Removing the tools does
 * not cancel a call already running; the browser's own signal does.
 *
 * Call it once per page (an effect with this function as its cleanup): a name registered twice is
 * an error WebMCP reports to `onError`.
 *
 * @throws TypeError when `agent` has no tools or `allow` or `onError` is not a function, in every
 * browser, with WebMCP or without.
 * @experimental WebMCP is a draft behind a flag in Chrome; this may change in any 0.x release.
 */
export function registerTools(agent: Agent, options: RegisterToolsOptions): () => void {
  if (agent === null || typeof agent !== 'object' || typeof agent.callTool !== 'function') throw new TypeError('registerTools expects an agent from createAgent');
  const tools: readonly AgentTool[] = agent.tools;
  // Checked through `unknown`: narrowing a readonly array with `Array.isArray` widens its items to any.
  if (!Array.isArray(tools as unknown)) throw new TypeError('registerTools expects an agent from createAgent');
  if (options === null || typeof options !== 'object') throw new TypeError('registerTools expects { allow }');
  const { allow, onError } = options;
  if (typeof allow !== 'function') throw new TypeError('registerTools needs allow: the gate for the browser\'s agent');
  if (onError !== undefined && typeof onError !== 'function') throw new TypeError('onError must be a function');

  const fail = (error: unknown): void => {
    if (isAbort(error)) return;
    try {
      if (onError) onError(error);
      else if (typeof reportError === 'function') reportError(error);
    } catch (thrown) {
      // A broken handler must not break the page; its own error is surfaced where the page sees errors.
      try { if (typeof reportError === 'function') reportError(thrown); } catch { /* Nowhere left to say it. */ }
    }
  };

  let context: WebMcpContext | undefined;
  try { context = modelContext(); } catch (error) { fail(error); return noop; }
  if (!context) return noop;

  // One controller for both tools: aborting it is the only way WebMCP removes a tool.
  const controller = new AbortController();
  const { signal } = controller;
  for (const tool of tools) {
    const { name } = tool;
    const descriptor: WebMcpTool = {
      name,
      description: tool.description,
      inputSchema: tool.inputSchema,
      annotations: ANNOTATIONS[name] ?? {},
      execute: async (input, call) => {
        // A build that passes no usable signal still runs the call, only without cancellation.
        const own = call?.signal;
        try {
          return await agent.callTool(name, input, isSignal(own) ? { signal: own, allow } : { allow });
        } catch (error) {
          // `callTool` never rejects; this is a broken agent, and the browser's agent still gets text.
          fail(error);
          return Object.freeze({ ok: false as const, error: Object.freeze({ message: 'The agent bridge failed. Nothing ran.' }) });
        }
      },
    };
    try {
      // `Promise.resolve` reads `then` once and turns a throwing getter into a rejection; a build that
      // returns no promise resolves at once.
      void Promise.resolve(context.registerTool(descriptor, { signal })).then(undefined, fail);
    } catch (error) {
      fail(error);
    }
  }

  // Aborting twice does nothing, so the removal is idempotent as it is.
  return () => { controller.abort(); };
}
