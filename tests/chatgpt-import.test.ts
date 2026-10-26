import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { after, test } from "node:test";

const directory = fs.mkdtempSync(path.join(os.tmpdir(), "lh-chatgpt-import-test-"));
process.env.LH_AUTH_FILE = path.join(directory, "auth.json");
process.env.LH_DATA_DIR = path.join(directory, "data");
delete process.env.LH_DESKTOP_SERVER;
delete process.env.LH_DESKTOP_API_SECRET;
const require = createRequire(import.meta.url);
const { createChatGPT, SCOPES } = require("../electron/chatgpt.cjs");
const { POST } = await import("../app/api/subscriptions/import/route.ts");
const { webSubscriptionOwner, createWebSubscriptionOwner } = await import("../src/server/web-subscriptions.ts");
const { beginTurn, endTurn } = await import("../src/server/turn-liveness.ts");
const chat = await import("../src/agent/chatgpt-bridge.ts");
const { piModels } = await import("../src/agent/models.ts");
const model = piModels().getModels("openai").find((model) => model.api === "openai-responses")!;
const originalFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
	assert.equal(String(url), "https://api.openai.com/v1/models", "only mocked model discovery is allowed");
	return Response.json({ models: [{ slug: model.id, display_name: "Import test model", visibility: "list" }] });
};
after(() => { webSubscriptionOwner().close(); globalThis.fetch = originalFetch; fs.rmSync(directory, { recursive: true, force: true }); });
const file = path.join(directory, "chatgpt-credentials.json");
const credentials = (id: string) => ({
	version: 1, hostId: `urn:uuid:import-${id}`, activeId: id, allowBackgroundUse: false,
	registrations: [{ id, clientId: `oaiapp_${id}`, issuer: "https://auth.openai.com", subject: id, email: `${id}@example.invalid`, tokens: { accessToken: `test-access-${id}`, refreshToken: `test-refresh-${id}`, idToken: `test-id-${id}`, scopes: SCOPES, expiresAt: Date.now() + 3600000 } }],
});
function request(body = JSON.stringify(credentials("imported")), headers: Record<string, string> = {}) {
	return new Request("https://learn.example/api/subscriptions/import", { method: "POST", headers: { host: "learn.example", origin: "https://learn.example", "X-LearnHarness-Subscriptions": "1", "content-type": "application/json", ...headers }, body });
}

test("import updates the existing runtime/catalog, privately backs up original bytes, and leaves all other files unchanged", async () => {
	const old = JSON.stringify(credentials("previous"));
	fs.writeFileSync(file, old, { mode: 0o600 });
	fs.writeFileSync(process.env.LH_AUTH_FILE!, '{"OPENAI_API_KEY":"test-only-key"}');
	fs.writeFileSync(path.join(directory, "xai-credentials.json"), "other provider bytes");
	fs.mkdirSync(path.join(directory, "data"));
	fs.writeFileSync(path.join(directory, "data/settings.json"), '{"version":1}');
	await webSubscriptionOwner().chatgpt.status();
	const response = await POST(request());
	assert.equal(response.status, 200, await response.clone().text());
	assert.equal(response.headers.get("cache-control"), "no-store");
	const result = await response.json();
	assert.equal(result.status.activeId, "imported");
	assert.equal(result.status.allowBackgroundUse, false);
	assert.equal(fs.readFileSync(result.backupPath, "utf8"), old);
	assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o600);
	assert.equal(fs.statSync(file).mode & 0o777, 0o600);
	assert.equal(JSON.parse(fs.readFileSync(file, "utf8")).activeId, "imported");
	assert.equal((await webSubscriptionOwner().chatgpt.status()).activeId, "imported", "no restart");
	assert.ok(chat.chatGPTConnected());
	assert.ok(chat.chatGPTModels().some((entry) => entry.id === model.id));
	assert.equal(fs.readFileSync(process.env.LH_AUTH_FILE!, "utf8"), '{"OPENAI_API_KEY":"test-only-key"}');
	assert.equal(fs.readFileSync(path.join(directory, "xai-credentials.json"), "utf8"), "other provider bytes");
	assert.equal(fs.readFileSync(path.join(directory, "data/settings.json"), "utf8"), '{"version":1}');
	assert.doesNotMatch(JSON.stringify(result), /test-access|test-refresh|test-id-/);
});

test("invalid files, missing scope/account, and malformed JSON leave credentials and backup count unchanged without reflecting secrets", async () => {
	const before = fs.readFileSync(file, "utf8"), paths = fs.readdirSync(directory);
	const noScope = credentials("invalid"); noScope.registrations[0]!.tokens.scopes = ["openid"];
	for (const raw of ["private-token-broken-json", "null", "[]", JSON.stringify({ ...credentials("invalid"), version: 999 }), JSON.stringify({ ...credentials("invalid"), activeId: "missing" }), JSON.stringify(noScope)]) {
		const response = await POST(request(raw));
		assert.ok(response.status >= 400);
		assert.doesNotMatch(await response.text(), /private-token|test-access|test-refresh|test-id-/);
		assert.equal(fs.readFileSync(file, "utf8"), before);
		assert.deepEqual(fs.readdirSync(directory), paths);
	}
});

test("same-origin/custom-header and content/size checks run before import; desktop import is disabled", async () => {
	assert.equal((await POST(request(undefined, { origin: "https://elsewhere.invalid" }))).status, 403);
	assert.equal((await POST(request(undefined, { "X-LearnHarness-Subscriptions": "" }))).status, 403);
	assert.equal((await POST(request(undefined, { "content-type": "text/plain" }))).status, 415);
	assert.equal((await POST(request("x".repeat(128 * 1024 + 1)))).status, 413);
	assert.equal((await POST(request(undefined, { "content-length": String(128 * 1024 + 1) }))).status, 413);
	process.env.LH_DESKTOP_SERVER = "1";
	try { assert.equal((await POST(request())).status, 404); }
	finally { delete process.env.LH_DESKTOP_SERVER; }
});

test("active work blocks import before backup or replacement", async () => {
	const chats = path.join(directory, "data/chats"); fs.mkdirSync(chats, { recursive: true });
	fs.writeFileSync(path.join(chats, "busy.json"), JSON.stringify({ id: "busy", title: "Busy", messages: [], createdAt: "today", updatedAt: "today" }));
	const before = fs.readFileSync(file, "utf8"), paths = fs.readdirSync(directory);
	beginTurn("busy");
	try { assert.equal((await POST(request())).status, 409); }
	finally { endTurn("busy"); }
	assert.equal(fs.readFileSync(file, "utf8"), before);
	assert.deepEqual(fs.readdirSync(directory), paths);
});

test("backup failure preserves the active account; import invalidates old admission scopes after success", async () => {
	let saved = credentials("old"), failWrite = false;
	const service = createChatGPT({ store: { read: async () => saved, write: async (next: typeof saved) => { if (failWrite) throw new Error("synthetic write failure"); saved = structuredClone(next); } }, openExternal: () => assert.fail("no sign-in"), fetch: globalThis.fetch });
	try {
		await service.status();
		const stamp = service.stamp();
		await assert.rejects(service.importCredentials(credentials("new"), () => { throw new Error("synthetic backup failure"); }), /backup failure/);
		assert.equal((await service.status()).activeId, "old");
		assert.deepEqual(service.stamp(), stamp);
		await service.importCredentials(credentials("new"), () => {});
		assert.ok(service.stamp().epoch > stamp.epoch);
		assert.equal((await service.status()).activeId, "new");
		failWrite = true;
		await assert.rejects(service.importCredentials(credentials("failed"), () => {}));
		assert.equal(saved.activeId, "new");
	} finally { service.close(); }
});

test("pending sign-in is refused without cancellation or credential writes", async () => {
	let saved = credentials("old"), backups = 0;
	const service = createChatGPT({ store: { read: async () => saved, write: async (next: typeof saved) => { saved = next; } }, openExternal: () => {}, fetch: () => assert.fail("no provider requests") });
	try {
		assert.equal((await service.login()).pending, true);
		await assert.rejects(service.importCredentials(credentials("new"), () => { backups++; }));
		assert.equal(backups, 0);
		assert.equal((await service.status()).pending, true);
		assert.equal(saved.activeId, "old");
	} finally { service.close(); }
});

test("another import and ChatGPT controls cannot race a pending credential replacement", async () => {
	let finish!: () => void, entered!: () => void;
	const writing = new Promise<void>((resolve) => { entered = resolve; });
	const release = new Promise<void>((resolve) => { finish = resolve; });
	const owner = createWebSubscriptionOwner({ directory, chatgptStore: { read: async () => credentials("old"), write: async () => { entered(); await release; } } });
	try {
		const importing = owner.importChatGPT(credentials("new"), () => {});
		await writing;
		await assert.rejects(owner.importChatGPT(credentials("other"), () => {}), /already running/);
		await assert.rejects(owner.control("chatgpt", { op: "consent", enabled: false }, "https://learn.example"), /already running/);
		finish();
		assert.equal((await importing).activeId, "new");
	} finally { finish(); owner.close(); }
});
