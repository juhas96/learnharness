/** The dock overlays a sibling scroller, so native scroll chaining cannot reach the transcript. */
export function bindDockScroll(root: HTMLElement, transcript: HTMLElement): () => void {
	function nativeScroll(target: EventTarget | null, delta: number): boolean {
		for (let node = target instanceof Element ? target : null; node && node !== root; node = node.parentElement) {
			if (!(node instanceof HTMLElement)) continue;
			const style = getComputedStyle(node);
			if (!/(auto|scroll)/.test(style.overflowY)) continue;
			// A contained questionnaire owns boundary gestures too; forwarding them collapses it.
			if (style.overscrollBehaviorY === "contain" || style.overscrollBehaviorY === "none") return true;
			if (node.scrollHeight - node.clientHeight < 2) continue;
			if (delta < 0 ? node.scrollTop > 0 : node.scrollTop < node.scrollHeight - node.clientHeight - 0.5) return true;
		}
		return false;
	}
	const wheel = (event: WheelEvent) => {
		if (!event.deltaY || event.ctrlKey || event.defaultPrevented || nativeScroll(event.target, event.deltaY)) return;
		event.preventDefault();
		transcript.scrollTop += event.deltaY * (event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? transcript.clientHeight : 1);
	};
	let gesture: { id: number; x: number; y: number; previousY: number; axis: "x" | "y" | null } | null = null;
	const start = (event: TouchEvent) => {
		const touch = event.touches.length === 1 ? event.touches[0] : undefined;
		gesture = touch ? { id: touch.identifier, x: touch.clientX, y: touch.clientY, previousY: touch.clientY, axis: null } : null;
	};
	const move = (event: TouchEvent) => {
		const touch = event.touches[0];
		if (!gesture || event.touches.length !== 1 || !touch || touch.identifier !== gesture.id) { gesture = null; return; }
		const delta = gesture.previousY - touch.clientY;
		gesture.previousY = touch.clientY;
		if (!gesture.axis) {
			const x = Math.abs(touch.clientX - gesture.x), y = Math.abs(touch.clientY - gesture.y);
			if (Math.max(x, y) < 8) return;
			gesture.axis = y > x ? "y" : "x";
		}
		if (gesture.axis !== "y" || !delta || event.defaultPrevented || !event.cancelable || nativeScroll(event.target, delta)) return;
		event.preventDefault();
		// shortcut: forwarded dock swipes follow the finger without momentum; add inertia if flings are needed.
		transcript.scrollTop += delta;
	};
	const end = () => { gesture = null; };
	root.addEventListener("wheel", wheel, { passive: false });
	root.addEventListener("touchstart", start, { passive: true });
	root.addEventListener("touchmove", move, { passive: false });
	root.addEventListener("touchend", end);
	root.addEventListener("touchcancel", end);
	return () => {
		root.removeEventListener("wheel", wheel);
		root.removeEventListener("touchstart", start);
		root.removeEventListener("touchmove", move);
		root.removeEventListener("touchend", end);
		root.removeEventListener("touchcancel", end);
	};
}
