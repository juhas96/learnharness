import { PATHS } from "../../config.ts";
import { exportData, importData, MAX_BACKUP_BYTES } from "../store/data-backup.ts";
import { chatStore } from "../store/chats.ts";
import { jobStore } from "../store/jobs.ts";
import { extractionStatuses } from "../agent/subagents/extraction.ts";
import { isTurnRunning } from "./turn-liveness.ts";
import { runningTurn } from "./turn-runs.ts";
import { compactionInFlight } from "./compaction.ts";
import { emit } from "../core/events.ts";

export function assertDataTransferIdle(): void {
	if (extractionStatuses().length || chatStore.listChats().some((chat) => isTurnRunning(chat.id) || runningTurn(chat.id) || compactionInFlight(chat.id) || jobStore.listJobs(chat.id).some((job) => job.status === "running" || job.delivery?.status === "pending"))) {
		throw new Error("Wait for lessons, background jobs, and extractions to finish before transferring data.");
	}
}

export function exportLearningData(): Buffer {
	assertDataTransferIdle();
	return exportData(PATHS.data);
}

export function importLearningData(data: Buffer, replace: boolean) {
	assertDataTransferIdle();
	const result = importData(PATHS.data, data, replace);
	emit("chats-changed", {});
	emit("jobs-changed", {});
	emit("activity-changed", {});
	return result;
}

export { MAX_BACKUP_BYTES };
