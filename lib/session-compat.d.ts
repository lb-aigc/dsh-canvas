/**
 * Harness generates a closed persistence vocabulary at build time. LDD owns the
 * `canvas/state` event type and must register it before any profile session is
 * opened, or a session log that contains it is refused on read ("… unknown to
 * this harness and not marked ignorable") and the GUI reports 历史加载失败.
 *
 * Mirrors `@ldd/dsh-video-frame-analyzer`'s session-compat for
 * `video/analysis-input`. The registration mutates the SAME Set instance the
 * harness itself imported (ESM module-cache singleton), so no path-to-runtime
 * resolution is needed — unlike an out-of-tree loose module.
 */
export declare function registerCanvasSessionEvent(eventTypes: ReadonlySet<string>): void;
//# sourceMappingURL=session-compat.d.ts.map