import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { AUTH_FILE } from "../../config.ts";
import { webSubscriptionOwner } from "./web-subscriptions.ts";
import { assertDataTransferIdle } from "./data-backup.ts";
import { refreshConnectionCatalog } from "./model-catalog.ts";

export async function importChatGPTCredentials(raw: unknown) {
	assertDataTransferIdle();
	const file = path.join(path.dirname(AUTH_FILE), "chatgpt-credentials.json");
	let backupPath: string | null = null;
	await webSubscriptionOwner().importChatGPT(raw, () => {
		assertDataTransferIdle();
		if (!fs.existsSync(file)) return;
		if (!fs.lstatSync(file).isFile()) throw new Error("Credential destination must be a regular file.");
		backupPath = `${file}.before-import-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
		fs.writeFileSync(backupPath, fs.readFileSync(file), { mode: 0o600, flag: "wx", flush: true });
	});
	await refreshConnectionCatalog("chatgpt");
	return { status: await webSubscriptionOwner().chatgpt.status(), backupPath };
}
