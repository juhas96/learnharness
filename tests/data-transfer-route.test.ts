import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-transfer-route-"));
process.env.LH_DATA_DIR = path.join(temp, "data");
process.env.LH_AUTH_FILE = path.join(temp, "auth.json");
const { GET, POST } = await import("../app/api/data-transfer/route.ts");
const { beginTurn, endTurn } = await import("../src/server/turn-liveness.ts");
after(() => fs.rmSync(temp, { recursive: true, force: true }));

const backup = JSON.stringify({ format: "learnharness-backup", version: 1, files: [] });
function request(body = backup, mode = "merge", headers: Record<string, string> = {}) {
	return new Request(`http://localhost/api/data-transfer?mode=${mode}`, { method: "POST", headers: { Origin: "http://localhost", "X-LearnHarness-Import": "1", ...headers }, body });
}

test("export and both import modes work with empty profiles; responses are not cached", async () => {
	const response = GET();
	assert.equal(response.status, 200);
	assert.equal(response.headers.get("cache-control"), "no-store");
	assert.match(response.headers.get("content-disposition")!, /attachment;.*\.lhbackup/);
	const bytes = await response.text();
	for (const mode of ["merge", "replace"]) {
		const imported = await POST(request(bytes, mode));
		assert.equal(imported.status, 200);
		const result = await imported.json();
		assert.ok(fs.existsSync(result.backupPath));
		assert.equal(result.files, 0);
	}
});

test("import refuses cross-origin requests, missing custom header, invalid modes, and malformed backups", async () => {
	assert.equal((await POST(request(backup, "merge", { Origin: "https://elsewhere.test" }))).status, 403);
	assert.equal((await POST(request(backup, "replace", { "X-LearnHarness-Import": "" }))).status, 403);
	assert.equal((await POST(request(backup, "typo"))).status, 400);
	assert.equal((await POST(request("bad json"))).status, 409);
});

test("import accepts the public Host behind Coolify instead of comparing internal URL ports", async () => {
	assert.equal((await POST(request(backup, "merge", { Origin: "https://learn.devmoon.eu", Host: "learn.devmoon.eu" }))).status, 200);
});

test("active lessons block both export and import without being aborted", async () => {
	const chats = path.join(process.env.LH_DATA_DIR!, "chats");
	fs.mkdirSync(chats, { recursive: true });
	fs.writeFileSync(path.join(chats, "busy.json"), JSON.stringify({ id: "busy", title: "Busy", messages: [], createdAt: "today", updatedAt: "today" }));
	beginTurn("busy");
	try {
		assert.equal(GET().status, 409);
		assert.equal((await POST(request())).status, 409);
		assert.match(await GET().text(), /Wait for lessons/);
	} finally { endTurn("busy"); }
});

test("background jobs and pending deliveries block data transfer without starting recovery", async () => {
	const jobs = path.join(process.env.LH_DATA_DIR!, "jobs");
	fs.mkdirSync(jobs, { recursive: true });
	for (const state of [{ status: "running" }, { status: "done", delivery: { kind: "result", status: "pending" } }]) {
		fs.writeFileSync(path.join(jobs, "j.json"), JSON.stringify({ id: "j", chatId: "busy", kind: "research", toolCallId: "t", createdAt: "today", updatedAt: "today", ...state }));
		assert.equal(GET().status, 409);
		assert.equal((await POST(request())).status, 409);
		assert.equal(JSON.parse(fs.readFileSync(path.join(jobs, "j.json"), "utf8")).status, state.status);
	}
	fs.unlinkSync(path.join(jobs, "j.json"));
});
