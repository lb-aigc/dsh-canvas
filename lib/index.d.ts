/**
 * @ldd/dsh-canvas — Host half.
 *
 * Registers the `canvas_*` tools the agent calls to read and mutate the
 * per-session canvas, and drives a session projection (`canvas`) so the canvas
 * state is BOTH durably persisted (a whole-value `canvas/state` session event
 * per mutation, folded back on resume/fork) AND served to the client through
 * the standard `useProjection('canvas')` read face — zero upstream patches.
 *
 * The canvas is a plugin: this bundle installs as a profile layer, the tools
 * appear only when the bundle is mounted, and the harness core knows nothing
 * about the canvas.
 */
import type { Context } from '@deepseek-ai/cordis';
import type { CanvasState } from './model.ts';
export declare const name = "ldd-canvas";
export declare const inject: string[];
declare module '@deepseek-ai/dsh-session/types' {
    interface SessionEventMap {
        /** Whole canvas state after one mutation. Whole-value, never a delta. */
        'canvas/state': {
            state: CanvasState;
        };
    }
}
declare module '@deepseek-ai/dsh-session-projection/types' {
    interface SessionProjectionStateMap {
        canvas: CanvasState;
    }
    interface SessionProjectionMap {
        canvas: CanvasState;
    }
}
export declare function apply(ctx: Context): void;
export { CanvasService } from './remote.ts';
//# sourceMappingURL=index.d.ts.map