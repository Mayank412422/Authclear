//#region src/headless-tools.ts
/**
* Parses a headless-tool interrupt `value` from the graph. Accepts both
* `toolCall` (LangChain JS) and `tool_call` (Python / JSON snake_case).
*/
function parseHeadlessToolInterruptPayload(value) {
	if (typeof value !== "object" || value == null) return null;
	const v = value;
	if (v.type !== "tool") return null;
	const rawTc = v.toolCall ?? v.tool_call;
	if (typeof rawTc !== "object" || rawTc == null) return null;
	const tc = rawTc;
	if (typeof tc.name !== "string") return null;
	return {
		type: "tool",
		toolCall: {
			id: typeof tc.id === "string" ? tc.id : void 0,
			name: tc.name,
			args: tc.args
		}
	};
}
/**
* Strip headless-tool interrupts from a user-facing interrupt list.
*/
function filterOutHeadlessToolInterrupts(interrupts) {
	return interrupts.filter((interrupt) => interrupt.value == null || !isHeadlessToolInterrupt(interrupt.value));
}
function isHeadlessToolInterrupt(interrupt) {
	return parseHeadlessToolInterruptPayload(interrupt) != null;
}
function findHeadlessTool(tools, name) {
	return tools.find((tool) => tool.tool.name === name);
}
async function executeHeadlessTool(implementation, args, onTool) {
	const startTime = Date.now();
	onTool?.({
		phase: "start",
		name: implementation.tool.name,
		args
	});
	try {
		const result = await implementation.execute(args);
		const duration = Date.now() - startTime;
		onTool?.({
			phase: "success",
			name: implementation.tool.name,
			args,
			result,
			duration
		});
		return {
			success: true,
			result
		};
	} catch (err) {
		const error = err instanceof Error ? err : new Error(String(err));
		const duration = Date.now() - startTime;
		onTool?.({
			phase: "error",
			name: implementation.tool.name,
			args,
			error,
			duration
		});
		return {
			success: false,
			error
		};
	}
}
async function handleHeadlessToolInterrupt(interrupt, tools, onTool) {
	const { toolCall } = interrupt;
	const implementation = findHeadlessTool(tools, toolCall.name);
	if (!implementation) {
		const error = /* @__PURE__ */ new Error(`Headless tool "${toolCall.name}" is not registered. Available tools: ${tools.map((tool) => tool.tool.name).join(", ") || "none"}`);
		onTool?.({
			phase: "error",
			name: toolCall.name,
			args: toolCall.args,
			error,
			duration: 0
		});
		return {
			toolCallId: toolCall.id,
			value: { error: error.message }
		};
	}
	const result = await executeHeadlessTool(implementation, toolCall.args, onTool);
	if (result.success) return {
		toolCallId: toolCall.id,
		value: result.result
	};
	return {
		toolCallId: toolCall.id,
		value: { error: result.error.message }
	};
}
function headlessToolResumeCommand(result) {
	return { resume: result.toolCallId ? { [result.toolCallId]: result.value } : result.value };
}
/**
* Execute and resume all newly seen headless-tool interrupts from a values
* payload. Callers own `handledIds` and should clear it when the thread changes.
*/
function flushPendingHeadlessToolInterrupts(values, tools, handledIds, options) {
	if (!tools?.length || !values) return;
	const interrupts = values.__interrupt__;
	if (!Array.isArray(interrupts) || interrupts.length === 0) return;
	const defer = options.defer ?? ((run) => run());
	for (const interrupt of interrupts) {
		const headlessInterrupt = parseHeadlessToolInterruptPayload(interrupt.value);
		if (!headlessInterrupt) continue;
		const interruptId = interrupt.id ?? headlessInterrupt.toolCall.id ?? "";
		if (handledIds.has(interruptId)) continue;
		handledIds.add(interruptId);
		defer(() => {
			handleHeadlessToolInterrupt(headlessInterrupt, tools, options.onTool).then((result) => {
				options.resumeSubmit(headlessToolResumeCommand(result));
			});
		});
	}
}
//#endregion
export { executeHeadlessTool, filterOutHeadlessToolInterrupts, findHeadlessTool, flushPendingHeadlessToolInterrupts, handleHeadlessToolInterrupt, headlessToolResumeCommand, isHeadlessToolInterrupt, parseHeadlessToolInterruptPayload };

//# sourceMappingURL=headless-tools.js.map