import fs from "node:fs";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { CURRENT_CHAT_VERSION } from "../core/contracts/chat.ts";
import { CURRENT_GRAPH_FORMAT_VERSION } from "../core/contracts/graph.ts";
import { CURRENT_SETTINGS_VERSION } from "../core/settings.ts";
import { isGraphNode, isGraphChain, isCheckpoint, isCoverageEntry } from "./graph.ts";

export const MAX_BACKUP_BYTES = 100 * 1024 * 1024;
const MAX_DATA_BYTES = MAX_BACKUP_BYTES / 2;
type Files = Map<string, Buffer>;
interface BackupFile { path: string; content: string; sha256: string }
interface Backup { format: "learnharness-backup"; version: 1; createdAt: string; files: BackupFile[] }
const ledgerGuards = {
	"graph/nodes.jsonl": isGraphNode,
	"graph/chains.jsonl": isGraphChain,
	"graph/sessions.jsonl": isCheckpoint,
	"graph/coverage.jsonl": isCoverageEntry,
};
const preferenceFiles = new Set(["settings.json", "graph/positions.json", "graph/render-settings.json"]);
const hash = (data: Buffer) => createHash("sha256").update(data).digest("hex");
const record = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

function allowed(name: string): boolean {
	return /^(chats|jobs)\/[A-Za-z0-9_-]+\.json$/.test(name)
		|| /^prompts\/(?:[A-Za-z0-9_-]+\/)*[A-Za-z0-9_.-]+\.md$/.test(name)
		|| preferenceFiles.has(name) || name === "graph/format.json" || name === "graph/sources.json"
		|| Object.hasOwn(ledgerGuards, name);
}

function json(data: Buffer, name: string): Record<string, unknown> {
	const value: unknown = JSON.parse(data.toString("utf8"));
	if (!record(value)) throw new Error(`Invalid JSON object: ${name}`);
	return value;
}

function lines(data: Buffer, name: string): Record<string, unknown>[] {
	const guard = ledgerGuards[name as keyof typeof ledgerGuards];
	return data.toString("utf8").split("\n").filter((line) => line.trim()).map((line) => {
		const value: unknown = JSON.parse(line);
		if (!guard(value)) throw new Error(`Invalid graph record: ${name}`);
		return value as unknown as Record<string, unknown>;
	});
}

function validate(files: Files): void {
	if (files.size > 100_000 || [...files.values()].reduce((sum, data) => sum + data.length, 0) > MAX_DATA_BYTES) throw new Error("Learning data is too large for a browser backup (50 MiB or 100,000 files).");
	for (const [name, data] of files) {
		if (!allowed(name)) throw new Error(`Unsupported backup path: ${name}`);
		if (name.startsWith("prompts/")) continue;
		if (Object.hasOwn(ledgerGuards, name)) { lines(data, name); continue; }
		const value = json(data, name);
		const maxVersion = name.startsWith("chats/") ? CURRENT_CHAT_VERSION
			: name === "settings.json" ? CURRENT_SETTINGS_VERSION
			: name === "graph/format.json" ? CURRENT_GRAPH_FORMAT_VERSION : undefined;
		if (maxVersion !== undefined && value.version !== undefined &&
			(!Number.isInteger(value.version) || (value.version as number) < 1 || (value.version as number) > maxVersion)) {
			throw new Error(`Unsupported data version: ${name}. Update LearnHarness first.`);
		}
		if (/^(chats|jobs)\//.test(name)) {
			if (value.id !== path.posix.basename(name, ".json") || typeof value.createdAt !== "string" || typeof value.updatedAt !== "string") throw new Error(`Invalid record: ${name}`);
			if (name.startsWith("chats/") && (!Array.isArray(value.messages) || typeof value.title !== "string" || value.messages.some((message) => !record(message) || typeof message.id !== "string" || typeof message.role !== "string"))) throw new Error(`Invalid conversation: ${name}`);
			if (name.startsWith("jobs/") && (typeof value.chatId !== "string" || !["running", "done", "error"].includes(value.status as string) || !["research", "demo", "visual", "pdf"].includes(value.kind as string) || typeof value.toolCallId !== "string")) throw new Error(`Invalid job: ${name}`);
			if (name.startsWith("jobs/") && (value.status === "running" || (record(value.delivery) && value.delivery.status === "pending"))) throw new Error(`Unfinished work: ${name}. Finish jobs before transferring data.`);
		}
		if (name === "graph/sources.json" && Object.entries(value).some(([id, source]) => !record(source) || source.id !== id || typeof source.filePath !== "string" || typeof source.importedAt !== "string")) throw new Error("Invalid notes sources");
	}
}

function readFiles(root: string): Files {
	const files: Files = new Map();
	let size = 0;
	function visit(dir: string, prefix = "") {
		if (!fs.existsSync(dir)) return;
		if (fs.lstatSync(dir).isSymbolicLink()) throw new Error(`Data directories cannot be symbolic links: ${dir}`);
		for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
			const name = prefix + entry.name;
			const full = path.join(dir, entry.name);
			if (entry.isSymbolicLink()) throw new Error(`Data cannot contain symbolic links: ${name}`);
			if (entry.isDirectory()) visit(full, `${name}/`);
			else if (entry.isFile()) {
				// shortcut: caches/debug output are not portable learning records; add future record families to allowed().
				if (name === ".DS_Store" || name.startsWith("debug/") || name.startsWith("models/")) continue;
				if (!allowed(name)) throw new Error(`Unrecognized data file: ${name}. Export stopped to avoid omitting data.`);
				size += fs.statSync(full).size;
				if (size > MAX_DATA_BYTES || files.size >= 100_000) throw new Error("Learning data is too large for a browser backup (50 MiB or 100,000 files).");
				files.set(name, fs.readFileSync(full));
			} else throw new Error(`Unsupported data entry: ${name}`);
		}
	}
	visit(root);
	return files;
}

function encode(files: Files): Buffer {
	const backup: Backup = { format: "learnharness-backup", version: 1, createdAt: new Date().toISOString(), files: [...files].map(([name, data]) => ({ path: name, content: data.toString("base64"), sha256: hash(data) })) };
	return Buffer.from(JSON.stringify(backup));
}

export function exportData(root: string): Buffer {
	const files = readFiles(root);
	validate(files);
	return encode(files);
}

function decode(data: Buffer): Files {
	if (data.length > MAX_BACKUP_BYTES) throw new Error("Backup exceeds 100 MiB.");
	const backup = json(data, "backup");
	if (backup.format !== "learnharness-backup" || backup.version !== 1 || !Array.isArray(backup.files) || backup.files.length > 100_000) throw new Error("Unsupported LearnHarness backup.");
	const files: Files = new Map();
	for (const file of backup.files) {
		if (!record(file) || typeof file.path !== "string" || !allowed(file.path) || files.has(file.path) || typeof file.content !== "string" || typeof file.sha256 !== "string") throw new Error("Invalid backup file entry.");
		const bytes = Buffer.from(file.content, "base64");
		if (bytes.toString("base64") !== file.content || hash(bytes) !== file.sha256) throw new Error(`Backup checksum failed: ${file.path}`);
		files.set(file.path, bytes);
	}
	validate(files);
	return files;
}

function ledgerKey(row: Record<string, unknown>): string {
	return typeof row.id === "string" ? row.id : JSON.stringify([row.chatId, row.fp ?? ""]);
}

function mergeFiles(current: Files, incoming: Files): Files {
	const merged = new Map(current);
	const conflicts: string[] = [];
	for (const [name, data] of incoming) {
		const existing = current.get(name);
		if (!existing) { merged.set(name, data); continue; }
		if (existing.equals(data) || preferenceFiles.has(name)) continue;
		if (Object.hasOwn(ledgerGuards, name)) {
			const before = lines(existing, name);
			const after = lines(data, name);
			const groups = (rows: Record<string, unknown>[]) => {
				const result = new Map<string, Record<string, unknown>[]>();
				for (const row of rows) { const key = ledgerKey(row); result.set(key, [...(result.get(key) ?? []), row]); }
				return result;
			};
			const oldGroups = groups(before);
			for (const [key, rows] of groups(after)) {
				if (oldGroups.has(key) && !isDeepStrictEqual(oldGroups.get(key), rows)) conflicts.push(`${name}: ${key}`);
			}
			merged.set(name, Buffer.from([...before, ...after.filter((row) => !oldGroups.has(ledgerKey(row)))].map((row) => JSON.stringify(row)).join("\n") + "\n"));
		} else if (name === "graph/sources.json") {
			const before = json(existing, name), after = json(data, name);
			for (const key of Object.keys(after)) if (Object.hasOwn(before, key) && !isDeepStrictEqual(before[key], after[key])) conflicts.push(`${name}: ${key}`);
			merged.set(name, Buffer.from(JSON.stringify({ ...after, ...before })));
		} else if (name.endsWith(".json") && isDeepStrictEqual(json(existing, name), json(data, name))) continue;
		else conflicts.push(name);
	}
	if (conflicts.length) throw new Error(`Import stopped; nothing changed. Conflicting records:\n${conflicts.slice(0, 20).join("\n")}${conflicts.length > 20 ? `\n…and ${conflicts.length - 20} more` : ""}`);
	return merged;
}

/** Synchronous through gate/snapshot/swap: no writer can interleave in this app's single server process. */
export function importData(root: string, data: Buffer, replace: boolean): { backupPath: string; files: number } {
	const incoming = decode(data);
	const current = readFiles(root);
	validate(current);
	const result = replace ? incoming : mergeFiles(current, incoming);
	validate(result);
	const backupDir = path.join(path.dirname(root), `${path.basename(root)}-backups`);
	fs.mkdirSync(backupDir, { recursive: true, mode: 0o700 });
	if (fs.lstatSync(backupDir).isSymbolicLink()) throw new Error("Backup directory cannot be a symbolic link.");
	fs.chmodSync(backupDir, 0o700);
	const backupPath = path.join(backupDir, `before-import-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}.lhbackup`);
	fs.writeFileSync(backupPath, encode(current), { mode: 0o600, flag: "wx" });
	const staging = fs.mkdtempSync(path.join(path.dirname(root), ".lh-import-"));
	const previous = `${staging}-previous`;
	let moved = false;
	try {
		for (const [name, bytes] of result) {
			const file = path.join(staging, name);
			fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
			fs.writeFileSync(file, bytes, { mode: 0o600 });
		}
		if (fs.existsSync(root)) { fs.renameSync(root, previous); moved = true; }
		try { fs.renameSync(staging, root); }
		catch (error) { if (moved) fs.renameSync(previous, root); throw error; }
	} finally {
		fs.rmSync(staging, { recursive: true, force: true });
	}
	// The portable backup remains even if removing the old tree fails.
	if (moved) { try { fs.rmSync(previous, { recursive: true }); } catch { /* keep the recoverable tree */ } }
	return { backupPath, files: result.size };
}
