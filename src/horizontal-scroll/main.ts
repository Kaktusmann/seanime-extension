/// <reference path="./plugin.d.ts" />
/// <reference path="./system.d.ts" />
/// <reference path="./app.d.ts" />
/// <reference path="./core.d.ts" />

function init() {
    $ui.register((ctx) => {
        async function injectHorizontalWheelPatch() {
            const body = await ctx.dom.queryOne("body")
            if (!body) return

            const script = await ctx.dom.createElement("script")
            script.setInnerHTML(
                `(() => {` +
                `if ((window).__horizontalScrollPatchInstalledV2) return;` +
                `(window).__horizontalScrollPatchInstalledV2 = true;` +
                `const requireShift = "{{requireShift}}" === "true";` +
                `const speed = Number("{{speed}}") || 120;` +
                `const selector = ".UI-Carousel__root.relative.w-full.max-w-full";` +
                `const cleanupLegacyStyle = () => {` +
                `document.querySelector('[data-plugin-style="horizontal-scroll-style"]')?.remove();` +
                `};` +
                `const findScrollable = (root) => {` +
                `if (!root) return null;` +
                `if (root.scrollWidth > root.clientWidth + 2) return root;` +
                `const nodes = root.querySelectorAll("*");` +
                `for (const node of nodes) {` +
                `if (node.scrollWidth > node.clientWidth + 2) return node;` +
                `}` +
                `return null;` +
                `};` +
                `const findNavButton = (root, dir) => {` +
                `const labels = dir > 0 ? ["next", "right", "forward"] : ["prev", "previous", "left", "back"];` +
                `const buttons = root.querySelectorAll("button, [role='button']");` +
                `for (const button of buttons) {` +
                `const text = (` +
                `(button.getAttribute("aria-label") || "") + " " +` +
                `(button.getAttribute("title") || "") + " " +` +
                `(button.className || "") + " " +` +
                `(button.getAttribute("data-slot") || "")` +
                `).toLowerCase();` +
                `if (labels.some((word) => text.includes(word))) return button;` +
                `}` +
                `return null;` +
                `};` +
                `const bind = (el) => {` +
                `if (!el || el.dataset.hsWheelBound === "1") return;` +
                `el.dataset.hsWheelBound = "1";` +
                `el.style.touchAction = "pan-x";` +
                `let lastScroll = 0;` +
                `el.addEventListener("wheel", (event) => {` +
                `if (requireShift && !event.shiftKey) return;` +
                `if (event.ctrlKey) return;` +
                `const now = Date.now();` +
                `if (now - lastScroll < speed) { event.preventDefault(); return; }` +
                `lastScroll = now;` +
                `const delta = Math.abs(event.deltaY) >= Math.abs(event.deltaX)` +
                `? event.deltaY` +
                `: event.deltaX;` +
                `if (!delta) return;` +
                `event.preventDefault();` +
                `el.dispatchEvent(new KeyboardEvent("keydown", {` +
                `key: delta > 0 ? "ArrowRight" : "ArrowLeft",` +
                `code: delta > 0 ? "ArrowRight" : "ArrowLeft",` +
                `bubbles: true,` +
                `cancelable: true,` +
                `}));` +
                `}, { passive: false });` +
                `};` +
                `const scan = () => {` +
                `cleanupLegacyStyle();` +
                `document.querySelectorAll(selector).forEach((el) => bind(el));` +
                `};` +
                `scan();` +
                `new MutationObserver(scan).observe(document.body, { childList: true, subtree: true });` +
                `})();`
            )
            body.append(script)
        }

        ctx.dom.onReady(() => {
            injectHorizontalWheelPatch()
        })

        ctx.dom.onMainTabReady(() => {
            injectHorizontalWheelPatch()
        })
    })
}