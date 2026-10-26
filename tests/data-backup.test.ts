import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createHash } from "node:crypto";
import { after, test } from "node:test";
import { exportData, importData } from "../src/store/data-backup.ts";

const temp = fs.mkdtempSync(path.join(os.tmpdir(), "lh-backup-test-"));
after(() => fs.rmSync(temp, { recursive: true, force: true }));
let sequence = 0;
function root() { return path.join(temp, `profile-${sequence++}`, "data"); }
function write(dir: string, name: string, value: unknown) {
	const file = path.join(dir, name);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, typeof value === "string" ? value : JSON.stringify(value));
}
const chat = (id: string, title = id) => ({ id, title, messages: [], createdAt: "2026-10-26", updatedAt: "2026-10-26" });
const node = (id: string) => ({ id, name: id, statement: id, aliases: [], provenance: [], createdAt: "2026-10-26" });
function files(dir: string): Map<string, string> {
	return new Map((JSON.parse(exportData(dir).toString()).files as { path: string; content: string }[]).map((file) => [file.path, file.content]));
}
function edited(backup: Buffer, name: string, value: string): Buffer {
	const parsed = JSON.parse(backup.toString());
	const entry = parsed.files.find((file: { path: string }) => file.path === name);
	entry.content = Buffer.from(value).toString("base64");
	entry.sha256 = createHash("sha256").update(value).digest("hex");
	return Buffer.from(JSON.stringify(parsed));
}

test("portable export/replace round trip, private automatic backup, credentials untouched", () => {
	const source = root(), target = root();
	write(source, "chats/a.json", chat("a"));
	write(source, "jobs/j.json", { id: "j", chatId: "a", status: "done", kind: "research", toolCallId: "t", createdAt: "2026-10-26", updatedAt: "2026-10-26" });
	write(source, "graph/nodes.jsonl", JSON.stringify(node("n")) + "\n");
	write(source, "graph/format.json", { version: 1 });
	write(source, "settings.json", { version: 1, general: {} });
	write(source, "prompts/teacher/test.md", "Custom prompt ü\n");
	write(target, "chats/old.json", chat("old"));
	write(path.dirname(target), "auth/auth.json", { key: "test-only" });
	write(path.dirname(source), "chatgpt-credentials.json", { token: "test-only" });
	const before = files(target);
	const backup = exportData(source);
	assert.ok(!backup.toString().includes("test-only"));
	const result = importData(target, backup, true);
	assert.deepEqual(files(target), files(source));
	assert.equal(fs.statSync(result.backupPath).mode & 0o777, 0o600);
	assert.equal(fs.statSync(path.dirname(result.backupPath)).mode & 0o777, 0o700);
	const recovered = root();
	importData(recovered, fs.readFileSync(result.backupPath), true);
	assert.deepEqual(files(recovered), before);
	assert.equal(fs.readFileSync(path.join(path.dirname(target), "auth/auth.json"), "utf8"), '{"key":"test-only"}');
	assert.deepEqual(files(source), files(target), "export leaves source intact");
});

test("merge retains destination settings/layout, adds records and graph history, deduplicates repeated import", () => {
	const source = root(), target = root();
	write(source, "chats/a.json", chat("a"));
	write(target, "chats/b.json", chat("b"));
	write(source, "settings.json", { version: 1, appearance: { theme: "light" } });
	write(target, "settings.json", { version: 1, appearance: { theme: "dark" } });
	write(source, "graph/positions.json", { positions: { a: { x: 1, y: 2 } } });
	write(target, "graph/positions.json", { positions: { b: { x: 3, y: 4 } } });
	write(source, "graph/nodes.jsonl", JSON.stringify(node("a")) + "\n");
	write(target, "graph/nodes.jsonl", JSON.stringify(node("b")) + "\n");
	write(source, "graph/sources.json", { s: { id: "s", filePath: "notes.md", importedAt: "today" } });
	const backup = exportData(source);
	importData(target, backup, false);
	assert.ok(fs.existsSync(path.join(target, "chats/a.json")) && fs.existsSync(path.join(target, "chats/b.json")));
	assert.match(fs.readFileSync(path.join(target, "settings.json"), "utf8"), /dark/);
	assert.deepEqual(JSON.parse(fs.readFileSync(path.join(target, "graph/positions.json"), "utf8")).positions, { b: { x: 3, y: 4 } });
	const before = files(target);
	importData(target, backup, false);
	assert.deepEqual(files(target), before);
	assert.equal(fs.readFileSync(path.join(target, "graph/nodes.jsonl"), "utf8").trim().split("\n").length, 2);
});

test("conflicting conversation, prompt, source, or graph history aborts the whole import before backup/writes", () => {
	for (const [name, a, b] of [
		["chats/a.json", chat("a"), chat("a", "different")],
		["prompts/a.md", "a", "b"],
		["graph/nodes.jsonl", JSON.stringify(node("n")), JSON.stringify({ ...node("n"), aliases: ["changed"] })],
		["graph/sources.json", { s: { id: "s", filePath: "a", importedAt: "today" } }, { s: { id: "s", filePath: "b", importedAt: "today" } }],
	] as const) {
		const source = root(), target = root();
		write(source, name, a); write(target, name, b);
		write(source, "chats/new.json", chat("new"));
		const before = files(target);
		assert.throws(() => importData(target, exportData(source), false), /Conflicting records/);
		assert.deepEqual(files(target), before);
		assert.ok(!fs.existsSync(path.join(path.dirname(target), "data-backups")));
	}
});

test("invalid backups cannot change the destination: traversal, secrets, duplicates, checksums, schemas, newer versions", () => {
	const source = root(), target = root();
	write(source, "chats/a.json", chat("a")); write(target, "chats/b.json", chat("b"));
	const backup = exportData(source), before = files(target);
	const changed = (fn: (value: { version: number; files: { path: string; content: string }[] }) => void) => { const value = JSON.parse(backup.toString()); fn(value); return Buffer.from(JSON.stringify(value)); };
	for (const invalid of [
		Buffer.from("not json"),
		changed((b) => { b.version = 999; }),
		changed((b) => { b.files[0]!.path = "../escape.json"; }),
		changed((b) => { b.files[0]!.path = "auth/auth.json"; }),
		changed((b) => { b.files.push(b.files[0]!); }),
		changed((b) => { b.files[0]!.content = "AAAA"; }),
		edited(backup, "chats/a.json", JSON.stringify({ ...chat("a"), version: 999 })),
		edited(backup, "chats/a.json", JSON.stringify({ ...chat("a"), id: "wrong" })),
		edited(backup, "chats/a.json", "[]"),
	]) {
		assert.throws(() => importData(target, invalid, true));
		assert.deepEqual(files(target), before);
	}
});

test("symlinks are refused and a failed stage swap rolls the original directory back", () => {
	const source = root(), target = root();
	write(source, "chats/a.json", chat("a")); write(target, "chats/b.json", chat("b"));
	fs.symlinkSync(path.join(source, "chats/a.json"), path.join(target, "chats/link.json"));
	assert.throws(() => exportData(target), /symbolic links/);
	fs.unlinkSync(path.join(target, "chats/link.json"));
	const before = files(target), backup = exportData(source);
	const rename = fs.renameSync;
	fs.renameSync = ((from, to) => { if (String(from).includes(".lh-import-") && String(to) === target && !String(from).endsWith("-previous")) throw new Error("synthetic swap failure"); return rename(from, to); }) as typeof fs.renameSync;
	try { assert.throws(() => importData(target, backup, true), /synthetic swap failure/); }
	finally { fs.renameSync = rename; }
	assert.deepEqual(files(target), before);
});

test("future graph/settings versions, malformed ledgers, and unfinished imported jobs are refused", () => {
	const source = root(), target = root();
	write(source, "graph/format.json", { version: 1 });
	write(source, "graph/nodes.jsonl", JSON.stringify(node("n")) + "\n");
	write(source, "settings.json", { version: 1 });
	write(source, "jobs/j.json", { id: "j", chatId: "a", kind: "research", toolCallId: "t", createdAt: "today", updatedAt: "today", status: "done" });
	const backup = exportData(source);
	for (const [name, content] of [
		["graph/format.json", '{"version":999}'],
		["settings.json", '{"version":999}'],
		["graph/nodes.jsonl", '{"id":"n"}\n'],
		["jobs/j.json", JSON.stringify({ id: "j", chatId: "a", kind: "research", toolCallId: "t", createdAt: "today", updatedAt: "today", status: "running" })],
	]) assert.throws(() => importData(target, edited(backup, name!, content!), true));
	assert.ok(!fs.existsSync(target));
});
