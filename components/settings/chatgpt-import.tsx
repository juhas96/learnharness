"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatGPTStatus } from "@/src/core";
import { Button } from "@/components/ui/button";
import { ConnectionDialog, ConnectionFooter } from "./connection-controls";

export function ChatGPTImport({ disabled, onImported }: { disabled: boolean; onImported: (status: ChatGPTStatus) => void }) {
	const [web, setWeb] = useState(false);
	const [open, setOpen] = useState(false);
	const [file, setFile] = useState<File | null>(null);
	const [busy, setBusy] = useState(false);
	const pending = useRef(false);
	const [failure, setFailure] = useState("");
	const [result, setResult] = useState<{ backupPath: string | null; catalogError?: string | null } | null>(null);
	useEffect(() => { setWeb(!window.lh || window.lh.subscriptionTransport === "web"); }, []);
	function close() { if (!pending.current) setOpen(false); }
	async function run() {
		if (!file || pending.current || disabled) return;
		pending.current = true;
		setBusy(true);
		setFailure("");
		try {
			if (file.size > 128 * 1024) throw new Error("Credential file exceeds 128 KiB.");
			const response = await fetch("/api/subscriptions/import", {
				method: "POST", headers: { "Content-Type": "application/json", "X-LearnHarness-Subscriptions": "1" }, body: file,
			});
			const body = await response.json();
			if (!response.ok) throw new Error(body.error ?? "ChatGPT import did not complete.");
			onImported(body.status);
			setResult({ backupPath: body.backupPath, catalogError: body.status.catalogError });
			setFile(null);
		} catch (error) { setFailure(error instanceof Error ? error.message : "ChatGPT import did not complete."); }
		finally { pending.current = false; setBusy(false); }
	}
	if (!web) return null;
	return <>
		<Button type="button" variant="ghost" size="xs" disabled={disabled || busy} data-testid="chatgpt-import" onClick={() => { setFile(null); setFailure(""); setResult(null); setOpen(true); }}>Import ChatGPT connection…</Button>
		{open && <ConnectionDialog label="Import ChatGPT connection" testid="chatgpt-import-dialog" backdropTestid="chatgpt-import-backdrop" busy={busy} onClose={close}>
			<h2 className="text-sm font-semibold">Import ChatGPT connection</h2>
			{result ? <div role="status" className="mt-3 space-y-2 text-xs text-muted-foreground">
				<p>ChatGPT connection imported. The account and model list have been refreshed.</p>
				{result.backupPath && <p className="break-all">Previous credentials backed up at: <span className="font-mono">{result.backupPath}</span></p>}
				{result.catalogError && <p role="alert" className="text-red-400">{result.catalogError} The credentials were imported, but models are unavailable. Your saved login may need to be renewed in the desktop app.</p>}
			</div> : <>
				<p className="mt-3 text-xs leading-relaxed text-muted-foreground">Select chatgpt-credentials.json from your installed LearnHarness profile. On macOS it is in ~/Library/Application Support/LearnHarness/.</p>
				<p className="mt-3 text-xs leading-relaxed text-muted-foreground">This uploads your saved login to the machine running LearnHarness and replaces its ChatGPT connections. Existing credentials are backed up privately first. Finish active lessons and jobs before importing.</p>
				<p className="mt-3 text-xs leading-relaxed text-muted-foreground">Credentials are stored in an unencrypted file with owner-only permissions. This reuses the desktop login; keep the desktop app quit while using the hosted copy because refresh tokens rotate. Learning data and other providers are unchanged.</p>
				<label className="mt-4 block text-xs">ChatGPT credentials file<input type="file" accept=".json,application/json" disabled={busy} onChange={(event) => { setFile(event.target.files?.[0] ?? null); setFailure(""); }} className="mt-2 block w-full min-w-0 rounded-sm border border-border p-2" /></label>
			</>}
			{failure && <p role="alert" className="mt-3 text-xs text-red-400">{failure}</p>}
			<ConnectionFooter>
				<Button variant="ghost" size="sm" disabled={busy} onClick={close}>{result ? "Done" : "Cancel"}</Button>
				{!result && <Button variant="outline" size="sm" disabled={busy || disabled || !file} onClick={() => void run()}>{busy ? "Importing…" : "Import and replace connection"}</Button>}
			</ConnectionFooter>
		</ConnectionDialog>}
	</>;
}
