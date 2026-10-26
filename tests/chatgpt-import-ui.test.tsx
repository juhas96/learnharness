import React, { act } from "react";
(globalThis as Record<string, unknown>).React = React;
import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { createRoot, type Root } from "react-dom/client";
import { parseHTML } from "linkedom";
import { ChatGPTImport } from "../components/settings/chatgpt-import.tsx";
import type { ChatGPTStatus } from "../src/core/index.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { window: dom.window, document: dom.document, Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, IS_REACT_ACT_ENVIRONMENT: true });
const originalFetch = globalThis.fetch;
let root: Root | undefined, host: HTMLDivElement | undefined;
afterEach(async () => { await act(async () => root?.unmount()); host?.remove(); root = undefined; host = undefined; delete window.lh; globalThis.fetch = originalFetch; });
const status: ChatGPTStatus = { available: true, pending: false, allowBackgroundUse: false, activeId: "test-account", accounts: [{ id: "test-account", email: "import@example.invalid", registration: "oaiapp_test", connected: true }], error: null };
async function mount(onImported: (status: ChatGPTStatus) => void = () => {}) {
	host = document.createElement("div"); document.body.append(host); root = createRoot(host);
	await act(async () => root!.render(<ChatGPTImport disabled={false} onImported={onImported} />));
}
const button = (text: string) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === text)!;
async function click(text: string) { await act(async () => button(text).click()); }
async function select(file: File) {
	const input = document.querySelector<HTMLInputElement>('input[type="file"]')!;
	Object.defineProperty(input, "files", { configurable: true, value: [file] });
	await act(async () => input.dispatchEvent(new window.Event("change", { bubbles: true })));
}

test("credential import is hidden in the desktop and available in web/hosted mode", async () => {
	window.lh = { expandWindow() {} };
	await mount();
	assert.equal(document.querySelector('[data-testid="chatgpt-import"]'), null);
	await act(async () => root!.unmount()); host!.remove();
	window.lh = { expandWindow() {}, subscriptionTransport: "web" };
	await mount();
	assert.ok(button("Import ChatGPT connection…"));
});

test("import requires explicit confirmation, uploads only the chosen file, refreshes safe status, and shows backup location", async () => {
	let imported: ChatGPTStatus | undefined, calls = 0;
	const file = new File(['{"synthetic":"private-fixture"}'], "chatgpt-credentials.json");
	globalThis.fetch = async (url, options) => {
		calls++;
		assert.equal(url, "/api/subscriptions/import");
		assert.equal(options?.method, "POST");
		assert.equal(new Headers(options?.headers).get("x-learnharness-subscriptions"), "1");
		assert.equal(options?.body, file);
		return Response.json({ status, backupPath: "/private-fixture/previous-credentials" });
	};
	await mount((next) => { imported = next; });
	await click("Import ChatGPT connection…");
	assert.match(document.body.textContent!, /unencrypted file with owner-only permissions/);
	assert.match(document.body.textContent!, /keep the desktop app quit/);
	assert.ok(button("Import and replace connection").disabled);
	await select(file);
	assert.equal(calls, 0, "selecting a file does not transmit it");
	assert.ok(!button("Import and replace connection").disabled);
	await click("Import and replace connection");
	assert.equal(calls, 1);
	assert.deepEqual(imported, status);
	assert.match(document.body.textContent!, /Connection imported|connection imported/);
	assert.match(document.body.textContent!, /previous-credentials/);
	assert.doesNotMatch(document.body.textContent!, /private-fixture"/);
	await click("Done");
	assert.equal(document.querySelector('[data-testid="chatgpt-import-dialog"]'), null);
});

test("server rejection remains visible and retryable instead of reporting success", async () => {
	globalThis.fetch = async () => Response.json({ error: "Finish active work before importing." }, { status: 409 });
	await mount(() => assert.fail("failed import cannot refresh success state"));
	await click("Import ChatGPT connection…");
	await select(new File(["{}"], "chatgpt-credentials.json"));
	await click("Import and replace connection");
	assert.equal(document.querySelector('[role="alert"]')?.textContent, "Finish active work before importing.");
	assert.ok(!button("Import and replace connection").disabled);
});
