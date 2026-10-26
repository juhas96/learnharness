"use client";

import { useRef, useState } from "react";
import { Dialog } from "radix-ui";
import { DownloadIcon, UploadIcon } from "lucide-react";

const buttonClass = "flex h-7 items-center gap-1.5 rounded-lg px-2.5 text-xs text-muted-foreground transition-colors hover:bg-accent disabled:opacity-50";

export function DataTransfer() {
	const [open, setOpen] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [replace, setReplace] = useState(false);
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const [error, setError] = useState("");
	const [result, setResult] = useState<{ backupPath: string; files: number } | null>(null);

	const changeOpen = (next: boolean) => {
		if (pending.current) return;
		if (!next && result) { window.location.reload(); return; }
		setOpen(next);
		setFile(null);
		setReplace(false);
		setError("");
		setResult(null);
	};
	const transfer = async (importing: boolean) => {
		if (pending.current || (importing && !file)) return;
		pending.current = true;
		setBusy(true);
		setError("");
		try {
			const response = importing
				? await fetch(`/api/data-transfer?mode=${replace ? "replace" : "merge"}`, { method: "POST", headers: { "X-LearnHarness-Import": "1", "Content-Type": "application/octet-stream" }, body: file })
				: await fetch("/api/data-transfer", { cache: "no-store" });
			if (!response.ok) {
				const body = await response.json();
				throw new Error(body.error ?? `Data transfer failed (${response.status}).`);
			}
			if (importing) setResult(await response.json());
			else {
				const url = URL.createObjectURL(await response.blob());
				const link = document.createElement("a");
				link.href = url;
				link.download = `learnharness-${new Date().toISOString().replace(/[:.]/g, "-")}.lhbackup`;
				link.click();
				setTimeout(() => URL.revokeObjectURL(url), 1000);
			}
		} catch (failure) { setError(failure instanceof Error ? failure.message : "Data transfer failed."); }
		finally { pending.current = false; setBusy(false); }
	};

	return (
		<div className="shrink-0 rounded-xl border bg-card/85 px-1 py-[3px] shadow-lg backdrop-blur">
			<div className="flex">
				<button type="button" className={buttonClass} disabled={busy} onClick={() => void transfer(false)}><DownloadIcon className="size-3" />Export data…</button>
				<Dialog.Root open={open} onOpenChange={changeOpen}>
					<Dialog.Trigger asChild><button type="button" className={buttonClass} disabled={busy}><UploadIcon className="size-3" />Import data…</button></Dialog.Trigger>
					<Dialog.Portal>
						<Dialog.Overlay className="fixed inset-0 z-50 bg-background/80" />
						<Dialog.Content onEscapeKeyDown={(event) => { event.stopPropagation(); if (busy) event.preventDefault(); }} onInteractOutside={(event) => { if (busy) event.preventDefault(); }} className="fixed left-1/2 top-1/2 z-50 max-h-[90vh] w-[32rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-xl border bg-card p-5 shadow-xl">
							<Dialog.Title className="text-sm font-semibold">Import learning data</Dialog.Title>
							<Dialog.Description className="mt-2 text-xs text-muted-foreground">Restore a LearnHarness data backup. Conversations, graph, jobs, settings, and custom prompts are included. Provider keys and subscription logins are excluded.</Dialog.Description>
							{result ? <div className="mt-4 space-y-2 text-xs" role="status"><p>Import complete. Learning data now contains {result.files} files. Your previous data is backed up at:</p><p className="break-all font-mono">{result.backupPath}</p><p>Choose Done to reload LearnHarness.</p></div> : <>
								<label className="mt-4 block text-xs">Backup file<input type="file" accept=".lhbackup" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setError(""); }} className="mt-2 block w-full rounded border p-2" /></label>
								<label className="mt-4 flex items-center gap-2 text-xs"><input type="checkbox" checked={replace} disabled={busy} onChange={(event) => setReplace(event.target.checked)} />Replace existing data</label>
								<p className="mt-2 text-xs text-muted-foreground">{replace ? "Restores the backup exactly, replacing the current learning data." : "Merges missing records and skips identical ones. Conflicts stop the import. Existing settings and layout stay."} A backup is saved before any changes. Finish active lessons and jobs first.</p>
								<p className="mt-2 text-xs text-muted-foreground">Browser backups support up to 50 MiB of learning data.</p>
							</>}
							{error && <p role="alert" className="mt-3 whitespace-pre-wrap break-words text-xs text-destructive">{error}</p>}
							<div className="mt-5 flex justify-end gap-2">
								<Dialog.Close asChild><button type="button" disabled={busy} className="rounded border px-3 py-1.5 text-xs">{result ? "Done" : "Cancel"}</button></Dialog.Close>
								{!result && <button type="button" disabled={busy || !file} onClick={() => void transfer(true)} className="rounded border bg-accent px-3 py-1.5 text-xs disabled:opacity-50">{busy ? "Importing…" : replace ? "Replace data" : "Merge data"}</button>}
							</div>
						</Dialog.Content>
					</Dialog.Portal>
				</Dialog.Root>
			</div>
			{error && !open && <p role="alert" className="max-w-80 whitespace-pre-wrap break-words px-2 py-1 text-xs text-destructive">{error}</p>}
		</div>
	);
}
