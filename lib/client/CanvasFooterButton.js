import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * The root footer action itself.
 * @param props - the injected opener and the `wide` column state.
 * @returns the canvas icon (rail) or icon + label (expanded).
 */
export function CanvasFooterButton({ open, wide }) {
    return (_jsxs("button", { type: "button", className: wide ? 'ldd-canvas-footer-button ldd-canvas-footer-button--wide' : 'ldd-canvas-footer-button', title: "\u753B\u5E03", "aria-label": "\u753B\u5E03", onClick: open, children: [_jsxs("svg", { viewBox: "0 0 16 16", width: "16", height: "16", "aria-hidden": "true", focusable: "false", children: [_jsx("rect", { x: "1.5", y: "2.5", width: "5.5", height: "4.5", rx: "1" }), _jsx("rect", { x: "9", y: "2.5", width: "5.5", height: "2.5", rx: "1" }), _jsx("rect", { x: "9", y: "6.5", width: "5.5", height: "7", rx: "1" }), _jsx("rect", { x: "1.5", y: "8.5", width: "5.5", height: "5", rx: "1" })] }), wide && _jsx("span", { className: "ldd-canvas-footer-button__label", children: "\u753B\u5E03" })] }));
}
//# sourceMappingURL=CanvasFooterButton.js.map