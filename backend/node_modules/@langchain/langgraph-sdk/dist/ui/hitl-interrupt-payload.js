//#region src/ui/hitl-interrupt-payload.ts
/**
* Human-in-the-loop interrupt values from the LangGraph API may use
* snake_case (Python server) while JS clients and LangChain types expect
* camelCase. Normalize known HITL fields on interrupt payloads at read time.
*/
/**
* Copy a plain object and expose both casing styles for a field.
*
* camelCase is treated as canonical when both keys are present so newer
* consumers keep the current behavior while legacy snake_case access still
* resolves to the same value.
*/
function aliasCasePair(item, camel, snake) {
	if (item === null || typeof item !== "object" || Array.isArray(item)) return item;
	const o = item;
	const merged = o[camel] ?? o[snake];
	const next = { ...o };
	if (merged !== void 0) {
		next[camel] = merged;
		next[snake] = merged;
	}
	return next;
}
function mapArrayAlias(raw, camel, snake) {
	if (!Array.isArray(raw)) return raw;
	return raw.map((item) => aliasCasePair(item, camel, snake));
}
/**
* If `value` looks like a HITL request object, expose both the new camelCase
* keys and the deprecated snake_case aliases so older apps keep working while
* migrating to the new shape.
*/
function normalizeHitlInterruptPayload(value) {
	if (value === null || typeof value !== "object") return value;
	if (Array.isArray(value)) return value.map((v) => normalizeHitlInterruptPayload(v));
	const obj = value;
	if (!("action_requests" in obj || "actionRequests" in obj || "review_configs" in obj || "reviewConfigs" in obj)) return value;
	const next = { ...obj };
	const actionRequestsRaw = obj.actionRequests ?? obj.action_requests;
	if (actionRequestsRaw !== void 0) {
		const actionRequests = mapArrayAlias(actionRequestsRaw, "name", "action_name");
		next.actionRequests = actionRequests;
		next.action_requests = actionRequests;
	}
	const reviewConfigsRaw = obj.reviewConfigs ?? obj.review_configs;
	if (reviewConfigsRaw !== void 0) {
		const reviewConfigs = mapArrayAlias(reviewConfigsRaw, "allowedDecisions", "allowed_decisions");
		next.reviewConfigs = reviewConfigs;
		next.review_configs = reviewConfigs;
	}
	return next;
}
//#endregion
export { normalizeHitlInterruptPayload };

//# sourceMappingURL=hitl-interrupt-payload.js.map