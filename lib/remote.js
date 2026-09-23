var __runInitializers = (this && this.__runInitializers) || function (thisArg, initializers, value) {
    var useValue = arguments.length > 2;
    for (var i = 0; i < initializers.length; i++) {
        value = useValue ? initializers[i].call(thisArg, value) : initializers[i].call(thisArg);
    }
    return useValue ? value : void 0;
};
var __esDecorate = (this && this.__esDecorate) || function (ctor, descriptorIn, decorators, contextIn, initializers, extraInitializers) {
    function accept(f) { if (f !== void 0 && typeof f !== "function") throw new TypeError("Function expected"); return f; }
    var kind = contextIn.kind, key = kind === "getter" ? "get" : kind === "setter" ? "set" : "value";
    var target = !descriptorIn && ctor ? contextIn["static"] ? ctor : ctor.prototype : null;
    var descriptor = descriptorIn || (target ? Object.getOwnPropertyDescriptor(target, contextIn.name) : {});
    var _, done = false;
    for (var i = decorators.length - 1; i >= 0; i--) {
        var context = {};
        for (var p in contextIn) context[p] = p === "access" ? {} : contextIn[p];
        for (var p in contextIn.access) context.access[p] = contextIn.access[p];
        context.addInitializer = function (f) { if (done) throw new TypeError("Cannot add initializers after decoration has completed"); extraInitializers.push(accept(f || null)); };
        var result = (0, decorators[i])(kind === "accessor" ? { get: descriptor.get, set: descriptor.set } : descriptor[key], context);
        if (kind === "accessor") {
            if (result === void 0) continue;
            if (result === null || typeof result !== "object") throw new TypeError("Object expected");
            if (_ = accept(result.get)) descriptor.get = _;
            if (_ = accept(result.set)) descriptor.set = _;
            if (_ = accept(result.init)) initializers.unshift(_);
        }
        else if (_ = accept(result)) {
            if (kind === "field") initializers.unshift(_);
            else descriptor[key] = _;
        }
    }
    if (target) Object.defineProperty(target, contextIn.name, descriptor);
    done = true;
};
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
import { TypertRemoteService, Remote } from '@deepseek-ai/dsh-typert-protocol';
import { addEdge, addNode, emptyCanvas, removeNode, updateNode } from "./model.js";
/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
function foldCanvas(events) {
    let state = emptyCanvas();
    for (const event of events) {
        if (event.type === 'canvas/state')
            state = event.data.state;
    }
    return state;
}
let CanvasService = (() => {
    let _classSuper = TypertRemoteService;
    let _instanceExtraInitializers = [];
    let _inspect_decorators;
    let _addNode_decorators;
    let _removeNode_decorators;
    let _updateNode_decorators;
    let _moveNode_decorators;
    let _link_decorators;
    let _saveAsset_decorators;
    let _readAsset_decorators;
    return class CanvasService extends _classSuper {
        static {
            const _metadata = typeof Symbol === "function" && Symbol.metadata ? Object.create(_classSuper[Symbol.metadata] ?? null) : void 0;
            _inspect_decorators = [Remote('inspect')];
            _addNode_decorators = [Remote('addNode')];
            _removeNode_decorators = [Remote('removeNode')];
            _updateNode_decorators = [Remote('updateNode')];
            _moveNode_decorators = [Remote('moveNode')];
            _link_decorators = [Remote('link')];
            _saveAsset_decorators = [Remote('saveAsset')];
            _readAsset_decorators = [Remote('readAsset')];
            __esDecorate(this, null, _inspect_decorators, { kind: "method", name: "inspect", static: false, private: false, access: { has: obj => "inspect" in obj, get: obj => obj.inspect }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _addNode_decorators, { kind: "method", name: "addNode", static: false, private: false, access: { has: obj => "addNode" in obj, get: obj => obj.addNode }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _removeNode_decorators, { kind: "method", name: "removeNode", static: false, private: false, access: { has: obj => "removeNode" in obj, get: obj => obj.removeNode }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _updateNode_decorators, { kind: "method", name: "updateNode", static: false, private: false, access: { has: obj => "updateNode" in obj, get: obj => obj.updateNode }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _moveNode_decorators, { kind: "method", name: "moveNode", static: false, private: false, access: { has: obj => "moveNode" in obj, get: obj => obj.moveNode }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _link_decorators, { kind: "method", name: "link", static: false, private: false, access: { has: obj => "link" in obj, get: obj => obj.link }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _saveAsset_decorators, { kind: "method", name: "saveAsset", static: false, private: false, access: { has: obj => "saveAsset" in obj, get: obj => obj.saveAsset }, metadata: _metadata }, null, _instanceExtraInitializers);
            __esDecorate(this, null, _readAsset_decorators, { kind: "method", name: "readAsset", static: false, private: false, access: { has: obj => "readAsset" in obj, get: obj => obj.readAsset }, metadata: _metadata }, null, _instanceExtraInitializers);
            if (_metadata) Object.defineProperty(this, Symbol.metadata, { enumerable: true, configurable: true, writable: true, value: _metadata });
        }
        static inject = ['attachments', 'sessions'];
        constructor(ctx) {
            super(ctx, 'canvas');
            __runInitializers(this, _instanceExtraInitializers);
        }
        /** Resolve the live Session owning a session id (the canvas write-back seam). */
        sessionOf(sessionId) {
            const session = this.ctx.sessions.get(sessionId);
            if (session === undefined)
                throw new Error(`canvas: 会话不可用 (${String(sessionId)})`);
            return session;
        }
        /** Read the whole canvas. */
        inspect(sessionId) {
            return foldCanvas(this.sessionOf(sessionId).snapshotEvents());
        }
        /** Add a node; returns the full new canvas (the client re-renders from it). */
        addNode(sessionId, request) {
            const session = this.sessionOf(sessionId);
            const before = foldCanvas(session.snapshotEvents());
            const auto = before.nodes.length;
            const { state: next } = addNode(before, {
                ...(request.id === undefined ? {} : { id: request.id }),
                kind: request.kind,
                label: request.label,
                x: typeof request.x === 'number' ? request.x : (auto % 4) * 220,
                y: typeof request.y === 'number' ? request.y : Math.floor(auto / 4) * 180,
                ...(request.content === undefined ? {} : { content: request.content }),
                ...(request.url === undefined ? {} : { url: request.url }),
                ...(request.meta === undefined ? {} : { meta: request.meta }),
            });
            session.append('canvas/state', { state: next });
            return next;
        }
        /** Remove a node (and its touching edges); returns the full new canvas. */
        removeNode(sessionId, nodeId) {
            const session = this.sessionOf(sessionId);
            const before = foldCanvas(session.snapshotEvents());
            const next = removeNode(before, nodeId);
            console.log(`[ldd-canvas] removeNode host: nodeId=${nodeId} before=${before.nodes.length} after=${next.nodes.length}`);
            session.append('canvas/state', { state: next });
            return next;
        }
        /** Patch one node's mutable fields; returns the full new canvas. */
        updateNode(sessionId, nodeId, patch) {
            const session = this.sessionOf(sessionId);
            const before = foldCanvas(session.snapshotEvents());
            const next = updateNode(before, nodeId, {
                ...(patch.label === undefined ? {} : { label: patch.label }),
                ...(patch.x === undefined ? {} : { x: patch.x }),
                ...(patch.y === undefined ? {} : { y: patch.y }),
                ...(patch.content === undefined ? {} : { content: patch.content }),
                ...(patch.meta === undefined ? {} : { meta: patch.meta }),
            });
            session.append('canvas/state', { state: next });
            return next;
        }
        /** Move a node (position-only convenience; returns the full new canvas). */
        moveNode(sessionId, nodeId, x, y) {
            const session = this.sessionOf(sessionId);
            const before = foldCanvas(session.snapshotEvents());
            const next = updateNode(before, nodeId, { x, y });
            session.append('canvas/state', { state: next });
            return next;
        }
        /** Link two nodes; returns the full new canvas. */
        link(sessionId, request) {
            const session = this.sessionOf(sessionId);
            const before = foldCanvas(session.snapshotEvents());
            const { state: next } = addEdge(before, {
                source: request.source,
                target: request.target,
                ...(request.label === undefined ? {} : { label: request.label }),
            });
            session.append('canvas/state', { state: next });
            return next;
        }
        /** Store one user-uploaded asset durably (image → normalized via `saveImage`,
         *  video/audio → verbatim via `saveFile`); returns its content-addressed
         *  attachment id (+ normalized image size). The client stores the id as the
         *  node's `url` so `loadImage` can read it back. */
        async saveAsset(sessionId, request) {
            this.sessionOf(sessionId);
            const attachments = this.ctx.attachments;
            if (attachments === undefined)
                throw new Error('canvas: 附件存储不可用');
            const binary = atob(request.dataBase64);
            const data = new Uint8Array(binary.length);
            for (let i = 0; i < binary.length; i += 1)
                data[i] = binary.charCodeAt(i);
            if (request.kind === 'image') {
                if (request.mediaType === undefined)
                    throw new Error('canvas: 图片上传缺少媒体类型');
                const ref = await attachments.saveImage({ data, mediaType: request.mediaType, name: request.name });
                return {
                    attachmentId: ref.attachmentId,
                    width: ref.width,
                    height: ref.height,
                    mediaType: ref.mediaType,
                    bytes: ref.bytes,
                };
            }
            const ref = await attachments.saveFile({ data, name: request.name });
            return { attachmentId: ref.attachmentId };
        }
        /** Read one canvas image back by its full durable reference. This is the
         *  canvas's OWN read channel: unlike session-controller's `readAttachment`,
         *  it does NOT require the image to be referenced as a prompt image block in
         *  the session log (a canvas image is stored by `saveAsset` and referenced
         *  only by its node's `url`/`meta`). It re-verifies the stored bytes against
         *  the reference and returns them as base64 for the browser to render. */
        async readAsset(sessionId, request) {
            // Authorization: the owning session must exist (same check as every other
            // verb). The attachment store then verifies the bytes against the ref.
            this.sessionOf(sessionId);
            const attachments = this.ctx.attachments;
            if (attachments === undefined)
                throw new Error('canvas: 附件存储不可用');
            const stored = await attachments.readImage({
                attachmentId: request.attachmentId,
                mediaType: request.mediaType,
                bytes: request.bytes,
                width: request.width,
                height: request.height,
            });
            return {
                mediaType: stored.ref.mediaType,
                dataBase64: Buffer.from(stored.data).toString('base64'),
            };
        }
    };
})();
export { CanvasService };
//# sourceMappingURL=remote.js.map