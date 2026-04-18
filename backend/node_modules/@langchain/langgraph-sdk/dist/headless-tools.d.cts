//#region src/headless-tools.d.ts
/**
 * Represents a headless tool interrupt payload emitted by LangChain's
 * schema-only `tool({ ... })` overload.
 *
 * Servers may serialize the nested tool call as `toolCall` (JS) or
 * `tool_call` (Python). Use {@link parseHeadlessToolInterruptPayload} to
 * normalize either shape before reading fields.
 */
interface HeadlessToolInterrupt {
  type: "tool";
  toolCall: {
    id: string | undefined;
    name: string;
    args: unknown;
  };
}
/**
 * Parses a headless-tool interrupt `value` from the graph. Accepts both
 * `toolCall` (LangChain JS) and `tool_call` (Python / JSON snake_case).
 */
declare function parseHeadlessToolInterruptPayload(value: unknown): HeadlessToolInterrupt | null;
/**
 * Client-side implementation returned by `headlessTool.implement(...)`.
 */
interface HeadlessToolImplementation<Args = unknown, Output = unknown> {
  tool: {
    name: string;
  };
  execute: (args: Args) => Promise<Output>;
}
type AnyHeadlessToolImplementation = HeadlessToolImplementation<any, any>;
interface ToolEvent {
  phase: "start" | "success" | "error";
  name: string;
  args: unknown;
  result?: unknown;
  error?: Error;
  duration?: number;
}
type OnToolCallback = (event: ToolEvent) => void;
/**
 * Strip headless-tool interrupts from a user-facing interrupt list.
 */
declare function filterOutHeadlessToolInterrupts<T extends {
  value?: unknown;
}>(interrupts: readonly T[]): T[];
declare function isHeadlessToolInterrupt(interrupt: unknown): interrupt is HeadlessToolInterrupt;
declare function findHeadlessTool<Args = unknown, Output = unknown>(tools: HeadlessToolImplementation[], name: string): HeadlessToolImplementation<Args, Output> | undefined;
declare function executeHeadlessTool<Args = unknown, Output = unknown>(implementation: HeadlessToolImplementation<Args, Output>, args: Args, onTool?: OnToolCallback): Promise<{
  success: true;
  result: Output;
} | {
  success: false;
  error: Error;
}>;
declare function handleHeadlessToolInterrupt(interrupt: HeadlessToolInterrupt, tools: HeadlessToolImplementation[], onTool?: OnToolCallback): Promise<{
  toolCallId: string | undefined;
  value: unknown;
}>;
declare function headlessToolResumeCommand(result: {
  toolCallId: string | undefined;
  value: unknown;
}): {
  resume: unknown;
};
interface FlushPendingHeadlessToolInterruptsOptions {
  onTool?: OnToolCallback;
  resumeSubmit: (command: {
    resume: unknown;
  }) => void | Promise<void>;
  defer?: (run: () => void) => void;
}
/**
 * Execute and resume all newly seen headless-tool interrupts from a values
 * payload. Callers own `handledIds` and should clear it when the thread changes.
 */
declare function flushPendingHeadlessToolInterrupts(values: Record<string, unknown> | null | undefined, tools: HeadlessToolImplementation[] | undefined, handledIds: Set<string>, options: FlushPendingHeadlessToolInterruptsOptions): void;
//#endregion
export { AnyHeadlessToolImplementation, FlushPendingHeadlessToolInterruptsOptions, HeadlessToolImplementation, HeadlessToolInterrupt, OnToolCallback, ToolEvent, executeHeadlessTool, filterOutHeadlessToolInterrupts, findHeadlessTool, flushPendingHeadlessToolInterrupts, handleHeadlessToolInterrupt, headlessToolResumeCommand, isHeadlessToolInterrupt, parseHeadlessToolInterruptPayload };
//# sourceMappingURL=headless-tools.d.cts.map