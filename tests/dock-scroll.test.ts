import assert from "node:assert/strict";
import { test } from "node:test";
import { parseHTML } from "linkedom";
import { bindDockScroll } from "../components/dock-scroll.ts";

const dom = parseHTML("<html><body></body></html>");
Object.assign(globalThis, { Element: dom.window.Element, HTMLElement: dom.window.HTMLElement, getComputedStyle: (element: HTMLElement) => ({ overflowY: element.style.overflowY || "visible" }) });
function setup() {
	const root = dom.document.createElement("div"), field = dom.document.createElement("textarea"), transcript = dom.document.createElement("div");
	root.append(field);
	Object.defineProperties(transcript, { scrollTop: { writable: true, value: 500 }, clientHeight: { value: 600 } });
	Object.defineProperties(field, { scrollTop: { writable: true, value: 0 }, clientHeight: { value: 100 }, scrollHeight: { configurable: true, value: 100 } });
	field.style.overflowY = "auto";
	return { field, transcript, dispose: bindDockScroll(root, transcript) };
}
function touch(field: HTMLElement, type: string, x: number, y: number, fingers = 1, cancelable = true) {
	const event = new dom.window.Event(type, { bubbles: true, cancelable });
	Object.assign(event, { touches: fingers ? Array.from({ length: fingers }, (_, id) => ({ identifier: id, clientX: x + id * 20, clientY: y })) : [] });
	field.dispatchEvent(event);
	return event;
}

test("vertical swipes over a non-scrolling dock field move the transcript in either direction", () => {
	const { field, transcript, dispose } = setup();
	touch(field, "touchstart", 100, 400);
	assert.ok(touch(field, "touchmove", 100, 350).defaultPrevented);
	assert.equal(transcript.scrollTop, 550);
	touch(field, "touchmove", 100, 375);
	assert.equal(transcript.scrollTop, 525);
	touch(field, "touchend", 100, 375, 0);
	dispose();
});

test("native nested scrolling stays native until its edge; overflow-visible wrappers do not swallow scrolling", () => {
	const { field, transcript, dispose } = setup();
	Object.defineProperty(field, "scrollHeight", { value: 500 });
	field.scrollTop = 200;
	touch(field, "touchstart", 100, 400);
	assert.equal(touch(field, "touchmove", 100, 350).defaultPrevented, false);
	assert.equal(transcript.scrollTop, 500);
	field.scrollTop = 400;
	assert.ok(touch(field, "touchmove", 100, 300).defaultPrevented);
	assert.equal(transcript.scrollTop, 550);
	field.style.overflowY = "visible";
	field.scrollTop = 0;
	touch(field, "touchmove", 100, 250);
	assert.equal(transcript.scrollTop, 600);
	dispose();
});

test("taps, horizontal gestures, pinch zoom, cancelled/non-cancelable gestures remain untouched", () => {
	const { field, transcript, dispose } = setup();
	touch(field, "touchstart", 100, 400);
	assert.equal(touch(field, "touchmove", 101, 402).defaultPrevented, false);
	touch(field, "touchend", 101, 402, 0);
	touch(field, "touchstart", 100, 400);
	assert.equal(touch(field, "touchmove", 150, 405).defaultPrevented, false);
	touch(field, "touchstart", 100, 400, 2);
	assert.equal(touch(field, "touchmove", 100, 300, 2).defaultPrevented, false);
	touch(field, "touchstart", 100, 400);
	touch(field, "touchcancel", 100, 400, 0);
	assert.equal(touch(field, "touchmove", 100, 300).defaultPrevented, false);
	touch(field, "touchstart", 100, 400);
	assert.equal(touch(field, "touchmove", 100, 300, 1, false).defaultPrevented, false);
	assert.equal(transcript.scrollTop, 500);
	dispose();
});

test("wheel units keep working and cleanup removes both wheel and touch forwarding", () => {
	const { field, transcript, dispose } = setup();
	const wheel = () => {
		const event = new dom.window.Event("wheel", { bubbles: true, cancelable: true });
		Object.assign(event, { deltaY: 2, deltaMode: 1 }); field.dispatchEvent(event);
	};
	wheel();
	assert.equal(transcript.scrollTop, 532);
	const pinch = new dom.window.Event("wheel", { bubbles: true, cancelable: true });
	Object.assign(pinch, { deltaY: 2, deltaMode: 0, ctrlKey: true }); field.dispatchEvent(pinch);
	assert.equal(pinch.defaultPrevented, false);
	assert.equal(transcript.scrollTop, 532);
	dispose();
	wheel();
	touch(field, "touchstart", 100, 400);
	touch(field, "touchmove", 100, 300);
	assert.equal(transcript.scrollTop, 532);
});
