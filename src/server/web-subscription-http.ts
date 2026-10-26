import { NATIVE_SUBSCRIPTIONS } from "../core/contracts/subscriptions.ts";
import { webSubscriptionOwner, webSubscriptionsEnabled, webSubscriptionStatus } from "./web-subscriptions.ts";
import { importChatGPTCredentials } from "./chatgpt-import.ts";

const HEADERS = { "Cache-Control": "no-store", "Referrer-Policy": "no-referrer", "X-Content-Type-Options": "nosniff" };
/** Same-origin browser controls, not user authentication. Web/dev deliberately
 * retains the existing shared-server/API-key trust model. Never trust forwarded
 * origins or add CORS grants here. A public deployment needs its own access gate. */
export function subscriptionRequestOrigin(request: Request): string | undefined {
	try {
		const url = new URL(request.url);
		const host = request.headers.get("host") ?? url.host;
		const addressed = new URL(`${url.protocol}//${host}`);
		if (!["http:", "https:"].includes(addressed.protocol) || addressed.username || addressed.password || addressed.pathname !== "/" || addressed.search || addressed.hash) return;
		return addressed.origin;
	} catch { return; }
}
function authorized(request: Request): boolean {
	const origin = subscriptionRequestOrigin(request);
	if (!origin || request.headers.get("x-learnharness-subscriptions") !== "1") return false;
	if (request.headers.get("sec-fetch-site") === "cross-site") return false;
	const supplied = request.headers.get("origin");
	return request.method === "GET" ? !supplied || supplied === origin : supplied === origin;
}
function error(message: string, status: number) { return Response.json({ error: message }, { status, headers: HEADERS }); }

export async function chatGPTCredentialImportResponse(request: Request): Promise<Response> {
	if (!webSubscriptionsEnabled()) return error("Credential import is only available in the web app.", 404);
	if (request.method !== "POST") return error("Unsupported method.", 405);
	if (!authorized(request)) return error("Credential import requires a same-origin LearnHarness request.", 403);
	if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return error("Choose a ChatGPT JSON credentials file.", 415);
	const limit = 128 * 1024;
	if (Number(request.headers.get("content-length")) > limit) return error("Credential file exceeds 128 KiB.", 413);
	const reader = request.body?.getReader();
	if (!reader) return error("Choose a ChatGPT JSON credentials file.", 400);
	let raw: unknown;
	try {
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > limit) { await reader.cancel(); return error("Credential file exceeds 128 KiB.", 413); }
			chunks.push(value);
		}
		raw = JSON.parse(Buffer.concat(chunks).toString("utf8"));
	} catch { return error("Choose a valid chatgpt-credentials.json file.", 400); }
	finally { reader.releaseLock(); }
	try {
		return Response.json(await importChatGPTCredentials(raw), { headers: HEADERS });
	} catch {
		return error("ChatGPT import did not complete. Check that the file contains a saved connected account, finish active lessons and jobs, cancel pending sign-in, then retry. Existing credentials are backed up before replacement.", 409);
	}
}
export async function subscriptionControlsResponse(request: Request): Promise<Response> {
	if (!webSubscriptionsEnabled()) return error("Web subscription controls are unavailable in desktop-owned mode.", 404);
	if (!authorized(request)) return error("Subscription controls require a same-origin LearnHarness request.", 403);
	try {
		if (request.method === "GET") return Response.json(await webSubscriptionStatus(), { headers: HEADERS });
		if (request.method !== "POST") return error("Unsupported method.", 405);
		if (request.headers.get("content-type")?.split(";")[0]?.trim() !== "application/json") return error("Expected JSON.", 415);
		// Bound both advertised and streamed input before parsing commands.
		if (Number(request.headers.get("content-length")) > 16384) return error("Request too large.", 413);
		const reader = request.body?.getReader();
		if (!reader) return error("Expected a command.", 400);
		const chunks: Uint8Array[] = []; let size = 0;
		try {
			for (;;) {
				const next = await reader.read(); if (next.done) break;
				size += next.value.byteLength;
				if (size > 16384) { await reader.cancel(); return error("Request too large.", 413); }
				chunks.push(next.value);
			}
		} finally { reader.releaseLock(); }
		const command: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
		if (!command || typeof command !== "object" || Array.isArray(command)) return error("Invalid command.", 400);
		const fields = command as Record<string, unknown>;
		const providerId = fields.providerId;
		if (providerId !== "chatgpt" && !NATIVE_SUBSCRIPTIONS.some((provider) => provider.providerId === providerId)) return error("Unsupported connection.", 400);
		const allowed = providerId === "chatgpt" ? ["login", "cancel", "select", "disconnect", "logout", "consent"] : ["login", "cancel", "respond", "open", "retry", "disconnect", "consent"];
		if (typeof fields.op !== "string" || !allowed.includes(fields.op)) return error("Unsupported control.", 400);
		return Response.json(await webSubscriptionOwner().control(providerId as string, fields, subscriptionRequestOrigin(request)!), { headers: HEADERS });
	} catch {
		return error("The subscription connection could not be changed. Retry or reconnect in Providers.", 400);
	}
}
/** One-use same-origin navigation. Full provider authorization URLs go only to
 * a top-level browser redirect, never status JSON, the SSE bus or application JS. */
export async function subscriptionBrowserResponse(request: Request): Promise<Response> {
	if (!webSubscriptionsEnabled()) return error("Unavailable.", 404);
	const origin = subscriptionRequestOrigin(request);
	if (!origin || (request.method === "POST" ? !authorized(request) : request.headers.get("sec-fetch-site") !== "same-origin")) return error("Open sign-in from LearnHarness.", 403);
	const id = new URL(request.url).searchParams.get("id");
	if (!id || !/^[0-9a-f-]{36}$/.test(id)) return error("This sign-in action is no longer available.", 410);
	const target = await webSubscriptionOwner().takeBrowserAction(id, origin);
	if (!target) return error("This sign-in action is no longer available.", 410);
	return new Response(null, { status: 303, headers: { ...HEADERS, Location: target } });
}
