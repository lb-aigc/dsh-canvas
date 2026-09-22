import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/** The canvas glyph: a rounded frame with four node dots (fill, currentColor). */
function CanvasGlyph({ size }) {
    return (_jsxs("svg", { width: size, height: size, viewBox: "0 0 16 16", fill: "none", "aria-hidden": "true", focusable: "false", children: [_jsx("path", { fillRule: "evenodd", clipRule: "evenodd", d: "M4.5 1.5h7A3 3 0 0 1 14.5 4.5v7a3 3 0 0 1-3 3h-7a3 3 0 0 1-3-3v-7a3 3 0 0 1 3-3Zm0 1.3A1.7 1.7 0 0 0 2.8 4.5v7c0 .94.76 1.7 1.7 1.7h7c.94 0 1.7-.76 1.7-1.7v-7c0-.94-.76-1.7-1.7-1.7h-7Z", fill: "currentColor" }), _jsx("circle", { cx: "5.5", cy: "5.5", r: "1", fill: "currentColor" }), _jsx("circle", { cx: "10.5", cy: "5.5", r: "1", fill: "currentColor" }), _jsx("circle", { cx: "5.5", cy: "10.5", r: "1", fill: "currentColor" }), _jsx("circle", { cx: "10.5", cy: "10.5", r: "1", fill: "currentColor" })] }));
}
/**
 * The root footer action itself.
 * @param props - the injected opener and the `wide` column state.
 * @returns the canvas icon + label (expanded) or icon-only rail circle.
 */
export function CanvasFooterButton({ open, wide }) {
    return (_jsxs("button", { type: "button", className: wide ? 'ldd-canvas-footer-button ldd-canvas-footer-button--wide' : 'ldd-canvas-footer-button ldd-canvas-footer-button--rail', title: "\u753B\u5E03", "aria-label": "\u753B\u5E03", onClick: open, children: [_jsx(CanvasGlyph, { size: wide ? 16 : 18 }), wide && _jsx("span", { className: "ldd-canvas-footer-button__label", children: "\u753B\u5E03" })] }));
}
//# sourceMappingURL=CanvasFooterButton.js.map