import { exportLearningData, importLearningData, MAX_BACKUP_BYTES } from "@/src/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export function GET() {
	try {
		return new Response(new Uint8Array(exportLearningData()), {
			headers: {
				"Content-Type": "application/octet-stream",
				"Content-Disposition": `attachment; filename="learnharness-${new Date().toISOString().replace(/[:.]/g, "-")}.lhbackup"`,
				"Cache-Control": "no-store",
				"X-Content-Type-Options": "nosniff",
			},
		});
	} catch (error) { return failure(error); }
}

export async function POST(request: Request) {
	// Browser cookies/Basic Auth must not authorize cross-origin destructive restores.
	const origin = request.headers.get("origin");
	let sameHost = false;
	try {
		// Host survives the Coolify reverse proxy; request.url may use its internal port/protocol.
		sameHost = !!origin && new URL(origin).origin === origin && new URL(origin).host === (request.headers.get("host") ?? new URL(request.url).host);
	} catch { /* reject malformed origins */ }
	if (!sameHost || request.headers.get("x-learnharness-import") !== "1") return Response.json({ error: "Same-origin import required." }, { status: 403 });
	const mode = new URL(request.url).searchParams.get("mode");
	if (mode !== "merge" && mode !== "replace") return Response.json({ error: "Choose merge or replace." }, { status: 400 });
	try {
		const reader = request.body?.getReader();
		if (!reader) throw new Error("Choose a backup file.");
		const chunks: Uint8Array[] = [];
		let size = 0;
		for (;;) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > MAX_BACKUP_BYTES) { await reader.cancel(); return Response.json({ error: "Backup exceeds 100 MiB." }, { status: 413 }); }
			chunks.push(value);
		}
		return Response.json(importLearningData(Buffer.concat(chunks), mode === "replace"), { headers: { "Cache-Control": "no-store" } });
	} catch (error) { return failure(error); }
}

function failure(error: unknown) {
	return Response.json({ error: error instanceof Error ? error.message : "Data transfer failed." }, { status: 409, headers: { "Cache-Control": "no-store" } });
}
