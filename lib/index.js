import { defineTool } from '@deepseek-ai/dsh-tools';
import { z as zod } from 'zod';
import { KNOWN_SESSION_EVENT_TYPES } from '@deepseek-ai/dsh-session';
import { addEdge, addNode, emptyCanvas, removeNode, updateNode } from "./model.js";
import { registerCanvasSessionEvent } from "./session-compat.js";
import { CanvasService } from "./remote.js";
export const name = 'ldd-canvas';
export const inject = ['tools', 'sessions', 'attachments'];
// Register the out-of-repo `canvas/state` event type into the harness's runtime
// persistence vocabulary BEFORE any session opens, so canvas-bearing logs read
// back cleanly (历史加载失败). Same seam as video-frame-analyzer's
// `video/analysis-input`. Must run at module load, not inside apply(), because
// a session can open before apply() completes.
registerCanvasSessionEvent(KNOWN_SESSION_EVENT_TYPES);
// ---- zod schemas (plain-JSON requirement of the projection cache). ----
// `as ZodType<X>` bridges zod's `.optional()` (`T | undefined`) to the
// interface's `field?: T` under `exactOptionalPropertyTypes` (same idiom as
// the goal package's projection schema).
const canvasNodeSchema = zod.object({
    id: zod.string(),
    kind: zod.enum(['image', 'video', 'music', 'text', 'note']),
    label: zod.string(),
    x: zod.number(),
    y: zod.number(),
    attachmentId: zod.string().optional(),
    url: zod.string().optional(),
    meta: zod.record(zod.string(), zod.any()).optional(),
    content: zod.string().optional(),
});
const canvasEdgeSchema = zod.object({
    id: zod.string(),
    source: zod.string(),
    target: zod.string(),
    label: zod.string().optional(),
});
const canvasStateSchema = zod.object({
    nodes: zod.array(canvasNodeSchema),
    edges: zod.array(canvasEdgeSchema),
});
const NODE_KINDS = ['image', 'video', 'music', 'text', 'note'];
const KIND_LABEL = {
    image: '图片',
    video: '视频',
    music: '音乐',
    text: '文本',
    note: '笔记',
};
// ---- Output schema: exact description of the `canvas_inspect` return shape. ----
const inspectOutputSchema = {
    type: 'object',
    additionalProperties: false,
    properties: {
        nodes: {
            type: 'array',
            required: true,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string', required: true },
                    kind: { type: 'string', required: true },
                    label: { type: 'string', required: true },
                    x: { type: 'number', required: true },
                    y: { type: 'number', required: true },
                    attachmentId: { type: 'string' },
                    url: { type: 'string' },
                    meta: { type: 'json' },
                    content: { type: 'string' },
                },
            },
        },
        edges: {
            type: 'array',
            required: true,
            items: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    id: { type: 'string', required: true },
                    source: { type: 'string', required: true },
                    target: { type: 'string', required: true },
                    label: { type: 'string' },
                },
            },
        },
        summary: { type: 'string', required: true },
    },
};
/** Fold the current canvas state out of the session log (last `canvas/state` wins). */
function foldCanvas(events) {
    let state = emptyCanvas();
    for (const event of events) {
        if (event.type === 'canvas/state')
            state = event.data.state;
    }
    return state;
}
/** Recurse into a content-block array and collect every `image` block's
 *  attachment reference, descending through `tool-result` blocks (generate's
 *  `generate_image` renders images inside its tool result). */
function collectImageMetas(content, out) {
    if (!Array.isArray(content))
        return;
    for (const value of content) {
        if (typeof value !== 'object' || value === null || Array.isArray(value))
            continue;
        const block = value;
        if (block.type === 'image' && typeof block.attachment === 'object' && block.attachment !== null) {
            const ref = block.attachment;
            if (typeof ref.attachmentId === 'string')
                out.push(ref);
        }
        else if (block.type === 'tool-result') {
            collectImageMetas(block.content, out);
        }
    }
}
/** Pull every generated image out of one `assistant/message` event — both the
 *  expanded `message.content` (incl. tool-result nesting) and the compact
 *  `stream` records' `block-end` chunks — so a generated picture is captured
 *  regardless of which durable form the settlement stored it in. */
function generatedImagesOf(event) {
    const data = event.data;
    const metas = [];
    collectImageMetas(data.message?.content, metas);
    if (Array.isArray(data.stream)) {
        for (const record of data.stream) {
            if (typeof record !== 'object' || record === null)
                continue;
            const chunk = record.chunk;
            if (typeof chunk !== 'object' || chunk === null)
                continue;
            const raw = chunk;
            if (raw.type === 'block-end')
                collectImageMetas([raw.block], metas);
        }
    }
    return metas;
}
/** Whether a `user/message` is a REAL user submission — not a system-prompt
 *  snapshot or skill-catalog injection, which also ride `user/message` but carry
 *  `source.kind` 'plugin' / 'skill-catalog' and no image blocks. */
function isRealUserMessage(event) {
    const data = event.data;
    return data.source?.kind === 'user';
}
/** Pull every image attachment out of one real `user/message` (the prompt's
 *  reference images, sent from the composer's attachment rail). Content-addressed
 *  (`sha256:…`), identical to the source canvas node's `url`. */
function userImageBlocksOf(event) {
    const data = event.data;
    const blocks = [];
    if (!Array.isArray(data.content))
        return blocks;
    for (const block of data.content) {
        if (typeof block !== 'object' || block === null)
            continue;
        const image = block;
        if (image.type !== 'image' || typeof image.attachment !== 'object' || image.attachment === null)
            continue;
        const ref = image.attachment;
        if (typeof ref.attachmentId === 'string')
            blocks.push(ref);
    }
    return blocks;
}
const turnStates = new WeakMap();
/** Serialize one canvas for the model-facing inspect result. */
function describeCanvas(state) {
    if (state.nodes.length === 0)
        return '画布当前为空。';
    const nodes = state.nodes.map((n) => {
        const meta = n.meta === undefined || Object.keys(n.meta).length === 0 ? '' : ` ${JSON.stringify(n.meta)}`;
        const extra = n.kind === 'text' || n.kind === 'note'
            ? (n.content === undefined ? '' : ` 内容="${n.content.slice(0, 80)}"`)
            : '';
        return `  - [${n.id}] ${KIND_LABEL[n.kind]} "${n.label}" @(${n.x},${n.y})${meta}${extra}`;
    }).join('\n');
    const edges = state.edges.length === 0
        ? '（无连线）'
        : '\n' + state.edges.map((e) => `  - [${e.id}] ${e.source} -> ${e.target}${e.label === undefined ? '' : ` (${e.label})`}`).join('\n');
    return `画布节点（${state.nodes.length}）：\n${nodes}\n连线（${state.edges.length}）：${edges}`;
}
/** The session driving the calling tool; missing = headless / no session. */
function sessionOf(exec) {
    return exec.agent?.session;
}
function defineCanvasTools() {
    const requireSession = (exec) => {
        const session = sessionOf(exec);
        if (session === undefined)
            throw new Error('canvas 工具需要当前会话（无法确定会话身份）');
        return session;
    };
    const inspectTool = defineTool({
        name: 'canvas_inspect',
        description: '读取当前会话画布的全部内容：有哪些节点（图片/视频/音乐/文本/笔记）、每个节点的元数据和位置、节点之间的连线关系。调用此工具了解画布上已有的素材与依赖，再做后续操作。',
        parameters: {},
        output: {
            schema: inspectOutputSchema,
            render: (_args, value) => [{ type: 'text', text: value.summary }],
        },
        isConcurrencySafe: () => true,
        async execute(_args, exec) {
            const session = requireSession(exec);
            const state = foldCanvas(session.snapshotEvents());
            return { nodes: state.nodes, edges: state.edges, summary: describeCanvas(state) };
        },
    });
    const addNodeTool = defineTool({
        name: 'canvas_add_node',
        description: '在画布上新增一个节点。用于把素材（图片/视频/音乐）或文字/笔记组织到画布上，供后续参考或连线。返回新节点的 id。',
        parameters: {
            kind: { type: 'string', enum: [...NODE_KINDS], required: true, description: '节点类型：image=图片, video=视频, music=音乐, text=文本, note=笔记。' },
            label: { type: 'string', required: true, description: '节点显示标题。' },
            x: { type: 'number', description: '画布横坐标（可选，缺省自动布局）。' },
            y: { type: 'number', description: '画布纵坐标（可选，缺省自动布局）。' },
            content: { type: 'string', description: '文本/笔记节点的内容。' },
            url: { type: 'string', description: '素材节点的 URL（图片/视频/音乐直链）。' },
            meta: { type: 'object', additionalProperties: true, description: '素材元数据，如 {width,height} 或 {durationSeconds,aspectRatio}。' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: {
                    nodeId: { type: 'string', required: true },
                    label: { type: 'string', required: true },
                },
            },
            render: (_args, value) => [{ type: 'text', text: `已在画布新增节点「${value.label}」（id=${value.nodeId}）。` }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const session = requireSession(exec);
            const state = foldCanvas(session.snapshotEvents());
            const auto = state.nodes.length;
            const { state: next } = addNode(state, {
                kind: args.kind,
                label: args.label,
                x: typeof args.x === 'number' ? args.x : (auto % 4) * 220,
                y: typeof args.y === 'number' ? args.y : Math.floor(auto / 4) * 180,
                ...(args.content === undefined ? {} : { content: args.content }),
                ...(args.url === undefined ? {} : { url: args.url }),
                ...(args.meta === undefined ? {} : { meta: args.meta }),
            });
            session.append('canvas/state', { state: next });
            const added = next.nodes[next.nodes.length - 1];
            return { nodeId: added.id, label: added.label };
        },
    });
    const removeNodeTool = defineTool({
        name: 'canvas_remove_node',
        description: '从画布删除一个节点（连同与它相连的所有连线）。',
        parameters: {
            nodeId: { type: 'string', required: true, description: '要删除的节点 id。' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: { removed: { type: 'boolean', required: true } },
            },
            render: (_args, value) => [{ type: 'text', text: value.removed ? '已从画布删除该节点。' : '未找到该节点，画布无变化。' }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const session = requireSession(exec);
            const before = foldCanvas(session.snapshotEvents());
            const next = removeNode(before, args.nodeId);
            session.append('canvas/state', { state: next });
            return { removed: next.nodes.length !== before.nodes.length };
        },
    });
    const updateNodeTool = defineTool({
        name: 'canvas_update_node',
        description: '修改画布上已有节点的标题、位置或元数据。',
        parameters: {
            nodeId: { type: 'string', required: true, description: '要修改的节点 id。' },
            label: { type: 'string', description: '新的显示标题。' },
            x: { type: 'number', description: '新的横坐标。' },
            y: { type: 'number', description: '新的纵坐标。' },
            content: { type: 'string', description: '新的文本/笔记内容。' },
            meta: { type: 'object', additionalProperties: true, description: '新的元数据。' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: { updated: { type: 'boolean', required: true } },
            },
            render: (_args, value) => [{ type: 'text', text: value.updated ? '已更新该节点。' : '未找到该节点。' }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const session = requireSession(exec);
            const before = foldCanvas(session.snapshotEvents());
            const patch = {};
            if (typeof args.label === 'string')
                patch.label = args.label;
            if (typeof args.x === 'number')
                patch.x = args.x;
            if (typeof args.y === 'number')
                patch.y = args.y;
            if (typeof args.content === 'string')
                patch.content = args.content;
            if (args.meta !== undefined && typeof args.meta === 'object')
                patch.meta = args.meta;
            const next = updateNode(before, args.nodeId, patch);
            session.append('canvas/state', { state: next });
            return { updated: next !== before };
        },
    });
    const linkTool = defineTool({
        name: 'canvas_link',
        description: '在画布两个节点之间加一条连线，表达关系（如「参考」「依赖」「派生自」）。',
        parameters: {
            source: { type: 'string', required: true, description: '源节点 id。' },
            target: { type: 'string', required: true, description: '目标节点 id。' },
            label: { type: 'string', description: '关系说明（可选）。' },
        },
        output: {
            schema: {
                type: 'object',
                additionalProperties: false,
                properties: { edgeId: { type: 'string', required: true } },
            },
            render: (_args, value) => [{ type: 'text', text: `已连线（id=${value.edgeId}）。` }],
        },
        isConcurrencySafe: () => true,
        async execute(args, exec) {
            const session = requireSession(exec);
            const state = foldCanvas(session.snapshotEvents());
            const { state: next, edge } = addEdge(state, {
                source: args.source,
                target: args.target,
                ...(args.label === undefined ? {} : { label: args.label }),
            });
            session.append('canvas/state', { state: next });
            return { edgeId: edge.id };
        },
    });
    return [inspectTool, addNodeTool, removeNodeTool, updateNodeTool, linkTool];
}
export function apply(ctx) {
    // Session projection: the durable + client-visible canvas read face. Optional
    // (headless assemblies without a projection registry stay unaffected).
    ctx.inject(['sessionProjections'], (projectionCtx) => {
        projectionCtx.sessionProjections.register({
            key: 'canvas',
            stateSchema: canvasStateSchema,
            init: emptyCanvas,
            apply: (state, event) => (event.type === 'canvas/state' ? event.data.state : state),
            wire: {
                viewSchema: canvasStateSchema,
                view: (state) => state,
            },
            stateVersion: 1,
        });
    });
    const disposers = defineCanvasTools().map((tool) => ctx.tools.register(tool));
    ctx.effect(() => () => { for (const dispose of disposers)
        dispose(); }, 'ldd-canvas: dispose tools');
    // Auto-mirror onto the canvas. Three event kinds drive it:
    //  - `turn/start`        → reset the turn's reference/pending state;
    //  - `user/message`      → a real submission: mirror any not-yet-on-canvas
    //                           image (external upload) as a node, and for each
    //                           reference-image source node create a BLANK
    //                           downstream placeholder + edge (the "chain" the
    //                           result will land on);
    //  - `tool/result` / `assistant/message` → a generated image lands: fill the
    //                           oldest pending placeholder (turning its dashed
    //                           chain into the real image), else add a fresh node
    //                           wired to the source (or detached, for text-only).
    ctx.on('session/event', (session, event) => {
        if (event.type === 'turn/start') {
            turnStates.set(session, { refIds: new Set(), pendingNodeIds: [] });
            return;
        }
        if (event.type === 'user/message') {
            if (!isRealUserMessage(event))
                return;
            const blocks = userImageBlocksOf(event);
            if (blocks.length === 0)
                return;
            const state = turnStates.get(session) ?? { refIds: new Set(), pendingNodeIds: [] };
            turnStates.set(session, state);
            // Defer out of the triggering append (see the tool/result comment below).
            queueMicrotask(() => {
                try {
                    let before = foldCanvas(session.snapshotEvents());
                    let next = before;
                    // 1) Mirror every reference image that is not yet on the canvas (an
                    //    image uploaded from outside the canvas still lands here).
                    for (const block of blocks) {
                        state.refIds.add(block.attachmentId);
                        if (next.nodes.some((node) => node.url === block.attachmentId))
                            continue;
                        const auto = next.nodes.length;
                        const result = addNode(next, {
                            kind: 'image',
                            label: block.name ?? '图片',
                            x: (auto % 4) * 220,
                            y: Math.floor(auto / 4) * 180,
                            url: block.attachmentId,
                            meta: {
                                ...(block.width === undefined ? {} : { width: block.width }),
                                ...(block.height === undefined ? {} : { height: block.height }),
                                ...(block.mediaType === undefined ? {} : { mediaType: block.mediaType }),
                                ...(block.bytes === undefined ? {} : { bytes: block.bytes }),
                            },
                        });
                        next = result.state;
                    }
                    // 2) For each reference-image source node, hang a BLANK downstream
                    //    placeholder and wire it — the slot the generated image will fill.
                    for (const block of blocks) {
                        const source = next.nodes.find((node) => node.url === block.attachmentId);
                        if (source === undefined)
                            continue;
                        const pending = addNode(next, {
                            kind: 'image',
                            label: '生成中…',
                            x: source.x + 340,
                            y: source.y,
                            meta: { pending: true },
                        });
                        next = pending.state;
                        const edgeResult = addEdge(next, { source: source.id, target: pending.node.id });
                        next = edgeResult.state;
                        state.pendingNodeIds.push(pending.node.id);
                    }
                    if (next.nodes.length !== before.nodes.length)
                        session.append('canvas/state', { state: next });
                }
                catch (error) {
                    console.error('[ldd-canvas] auto-mirror (user/message) failed:', error);
                }
            });
            return;
        }
        if (event.type !== 'assistant/message' && event.type !== 'tool/result')
            return;
        const metas = generatedImagesOf(event);
        if (metas.length === 0)
            return;
        // Defer the canvas/state append out of the current session/event dispatch.
        // This listener runs synchronously INSIDE the triggering event's
        // Session.append (the tool/result / assistant/message append is still
        // publishing — entry.appending is true), so appending canvas/state here
        // would re-enter Session.append and throw "session append cannot reenter
        // while another append is being published". That throw is swallowed by the
        // observer containment (logger.warn, no banner), which is why the canvas
        // silently stayed empty. A microtask runs after the triggering append's
        // finally clears the flag, so the canvas write-back lands cleanly.
        queueMicrotask(() => {
            try {
                const before = foldCanvas(session.snapshotEvents());
                const state = turnStates.get(session);
                let next = before;
                for (const meta of metas) {
                    if (next.nodes.some((node) => node.url === meta.attachmentId))
                        continue;
                    // Preferred: fill the oldest pending placeholder (its dashed chain
                    // turns into the real image in place).
                    const pendingId = state?.pendingNodeIds.shift();
                    const pending = pendingId !== undefined
                        ? next.nodes.find((node) => node.id === pendingId && node.meta?.pending === true)
                        : undefined;
                    if (pending !== undefined) {
                        next = updateNode(next, pending.id, {
                            label: meta.name ?? '生成图片',
                            url: meta.attachmentId,
                            meta: {
                                ...(meta.width === undefined ? {} : { width: meta.width }),
                                ...(meta.height === undefined ? {} : { height: meta.height }),
                                ...(meta.mediaType === undefined ? {} : { mediaType: meta.mediaType }),
                                ...(meta.bytes === undefined ? {} : { bytes: meta.bytes }),
                            },
                        });
                        continue;
                    }
                    // Fallback: wire to the reference-image source node (image-to-image
                    // without a pre-created placeholder), or a detached auto-grid node.
                    const source = state !== undefined && state.refIds.size > 0
                        ? next.nodes.find((node) => node.url !== undefined && state.refIds.has(node.url))
                        : undefined;
                    const auto = next.nodes.length;
                    const result = addNode(next, {
                        kind: 'image',
                        label: meta.name ?? '生成图片',
                        x: source !== undefined ? source.x + 340 : (auto % 4) * 220,
                        y: source !== undefined ? source.y : Math.floor(auto / 4) * 180,
                        url: meta.attachmentId,
                        meta: {
                            ...(meta.width === undefined ? {} : { width: meta.width }),
                            ...(meta.height === undefined ? {} : { height: meta.height }),
                            ...(meta.mediaType === undefined ? {} : { mediaType: meta.mediaType }),
                            ...(meta.bytes === undefined ? {} : { bytes: meta.bytes }),
                        },
                    });
                    next = result.state;
                    if (source !== undefined) {
                        const edgeResult = addEdge(next, { source: source.id, target: result.node.id });
                        next = edgeResult.state;
                    }
                }
                if (next.nodes.length !== before.nodes.length || next.edges.length !== before.edges.length) {
                    session.append('canvas/state', { state: next });
                }
            }
            catch (error) {
                // The session may have been disposed before the microtask ran; a failed
                // mirror must never take the session down.
                console.error('[ldd-canvas] auto-mirror failed:', error);
            }
        });
    });
    // The write-back Remote service. `new CanvasService(ctx)` registers `ctx.canvas`
    // (cordis Service auto-provides on the owning fiber) AND binds it to the
    // typert gateway (`bindTypertRemote`), so the client's `ctx.remote.canvas`
    // verbs reach these methods and the change lands as a durable `canvas/state`.
    new CanvasService(ctx);
}
// Re-export the write-back Remote service so the package's public surface
// (`@ldd/dsh-canvas`) exposes it; the typert generator's surface walk reaches
// the `@Remote` methods through the `./remote.ts` import above.
export { CanvasService } from "./remote.js";
//# sourceMappingURL=index.js.map