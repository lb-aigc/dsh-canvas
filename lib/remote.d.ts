/**
 * @ldd/dsh-canvas — Canvas write-back Remote service (typert remote).
 *
 * The host half of the canvas's bidirectional-editing path. The agent mutates
 * the canvas through `canvas_*` tools; this service exposes the SAME mutations
 * as typert `@Remote` verbs so the CLIENT can call them directly (drag / link /
 * edit / delete) and the change lands as a durable `canvas/state` session event
 * — zero agent round-trip.
 *
 * Every verb takes the owning session's `SessionId` as its FIRST parameter —
 * the same direct (non-lookup) shape the harness `session-controller` uses
 * (`prompt({ sessionId })`, `commands.execute(sessionId, …)`). The client calls
 * `ctx.remote.canvas.addNode(sessionId, request)` with no scope machinery; the
 * host resolves the live `Agent` through `ctx.agents.get(sessionId)` and writes
 * back through `agent.session.append` — the exact seam the `canvas_*` tools
 * already use, so agent and user edits share one durable mirror.
 */
import { TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol';
import type { Context } from '@deepseek-ai/cordis';
import type { SessionId } from '@deepseek-ai/dsh-session/types';
import type { CanvasState } from './types.ts';
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasSaveAssetRequest, CanvasSaveAssetValue, CanvasUpdateNodeRequest } from './types.ts';
export declare class CanvasService extends TypertRemoteService {
    static inject: string[];
    constructor(ctx: Context);
    /** Resolve the live Session owning a session id (the canvas write-back seam). */
    private sessionOf;
    /** Read the whole canvas. */
    inspect(sessionId: SessionId): CanvasState;
    /** Add a node; returns the full new canvas (the client re-renders from it). */
    addNode(sessionId: SessionId, request: CanvasAddNodeRequest): CanvasState;
    /** Remove a node (and its touching edges); returns the full new canvas. */
    removeNode(sessionId: SessionId, nodeId: string): CanvasState;
    /** Patch one node's mutable fields; returns the full new canvas. */
    updateNode(sessionId: SessionId, nodeId: string, patch: CanvasUpdateNodeRequest): CanvasState;
    /** Move a node (position-only convenience; returns the full new canvas). */
    moveNode(sessionId: SessionId, nodeId: string, x: number, y: number): CanvasState;
    /** Link two nodes; returns the full new canvas. */
    link(sessionId: SessionId, request: CanvasLinkRequest): CanvasState;
    /** Store one user-uploaded asset durably (image → normalized via `saveImage`,
     *  video/audio → verbatim via `saveFile`); returns its content-addressed
     *  attachment id (+ normalized image size). The client stores the id as the
     *  node's `url` so `loadImage` can read it back. */
    saveAsset(sessionId: SessionId, request: CanvasSaveAssetRequest): Promise<CanvasSaveAssetValue>;
}
//# sourceMappingURL=remote.d.ts.map