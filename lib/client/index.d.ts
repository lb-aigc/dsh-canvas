/**
 * @ldd/dsh-canvas — Browser half.
 *
 * The canvas lives in ONE seat — the right Sidebar, as a page-type tab
 * (`kind: 'canvas'`) — fed by the ONE host-side truth (`useProjection('canvas')`,
 * which folds the durable `canvas/state` events). The registration uses the
 * stock public two-stage path: `ctx.sidebarRightTabs.register` declares the tab
 * type, the keyed `sidebar.right.pane.tab` seat hosts its body. That is the same
 * path `ui-sidebar-files` and `ui-sidebar-documentpreview` take, so it costs zero
 * upstream patches. It deliberately claims NO guide entry: the shipped guide
 * draws its own page whenever more than one entry is registered, which would
 * turn the strip's add control from "open Files" into "open the guide". The way
 * in is the always-mounted 「画布」 utility in the Session header below.
 *
 * The seat is session-scoped, so the framework hands the body `useProjection`
 * and `sessionId`. The injected face carries the image loader, the one-shot
 * agent prompt, the write-back verbs (the six typert Remote methods of
 * {@link CanvasService}, mounted from the generated `@ldd/dsh-canvas/remote`
 * contribution and called directly with the session id — the same direct shape
 * `session-controller` uses), AND the file-upload entry (`pickFilesAndUpload`).
 * Every write lands as a durable `canvas/state` event on the Host, so the
 * projection re-renders from the SAME mirror the `canvas_*` tools mutate.
 *
 * The right-Sidebar services are taken through `ctx.inject` rather than the
 * top-level `inject` list: the canvas has to keep working in a composition
 * without the right Sidebar, and a missing optional service must not take the
 * canvas down with it. The host half uses the same idiom for its optional
 * `sessionProjections`.
 *
 * The sessions service is read through `ctx.get('sessions')` with a minimal
 * STRUCTURAL face (not `ctx.sessions.<method>`). This package's single tsconfig
 * compiles host + client halves together, and the host half imports
 * `@deepseek-ai/dsh-session` (declaring `Context.sessions: SessionStore`) while
 * the client half imports the runtime (declaring `Context.sessions: ISessions`);
 * a direct `ctx.sessions` property access would surface that conflict as
 * TS2339. `ctx.get` sidesteps it (same idiom as generate's `SessionsLike`). The
 * `remote` service is reached the same way (`ctx.get('remote')`) with a local
 * structural shim, so this package does NOT import `@deepseek-ai/dsh-api-gateway`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis';
import type { CanvasState } from '../model.ts';
/** Local structural copy of the main-process import result (no apps/desktop edge). */
interface ImportFileResultLike {
    readonly imported: boolean;
    readonly relativePath: string;
    readonly kind: 'video' | 'image' | 'document' | 'text' | 'other';
}
declare global {
    interface Window {
        readonly ldd?: {
            importFile(data: ArrayBuffer, fileName: string, workspacePath: string): Promise<ImportFileResultLike>;
        };
    }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionMap {
        /** Whole per-session canvas (nodes + edges). */
        canvas: CanvasState;
    }
}
/** The right-Sidebar page kind this plugin owns; `openTab('canvas')` names it. */
export declare const CANVAS_KIND = "canvas";
export declare const inject: string[];
/**
 * Register the browser half: the right-Sidebar tab type and its body, the
 * Session-header way in, and the write-back Remote mount (the generated
 * `canvas` namespace contribution).
 * @param ctx - client root context carrying the slots and the Session seat.
 */
export declare function apply(ctx: ClientContext): void;
export {};
//# sourceMappingURL=index.d.ts.map