import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
/**
 * CanvasView: the per-session canvas, drawn in whichever seat hosts it — today
 * the right Sidebar's `canvas` page tab and the Conversation's 画布 view tab,
 * both of which hand it `useProjection` and the injected image loader.
 *
 * Reads the whole canvas through `useProjection('canvas')` and renders it with
 * React Flow. Image nodes resolve their `sha256:` attachment (or an http url)
 * into a thumbnail via the injected `loadImage`; text/note nodes show inline
 * content.
 *
 * Phase 3 — the user edits the canvas directly, with zero agent round-trip:
 * - DRAG a node (React Flow keeps it responsive locally via `applyNodeChanges`;
 *   `onNodeDragStop` persists through the `moveNode` verb).
 * - CONNECT two nodes by dragging a handle (persists through `link`).
 * - ADD a note/text node from the toolbar (persists through `addNode`).
 * - EDIT label/content and DELETE via the bottom edit bar on a selected node
 *   (`updateNode` / `removeNode`).
 *
 * Every write lands as a durable `canvas/state` event on the Host, so the
 * projection re-renders from the SAME mirror the `canvas_*` tools mutate — agent
 * and user edits share one durable source of truth. Writes are fire-and-forget
 * with local feedback; the projection's refresh is the authoritative reconcile.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Background, Controls, Handle, MiniMap, Position, ReactFlow, applyEdgeChanges, applyNodeChanges, } from '@xyflow/react';
import { newId } from "../model.js";
import './react-flow.css';
import './canvas.css';
/** Local-only ids for the drag-to-create ghost node + dashed edge overlay. */
const GHOST_NODE_ID = '__draft-target__';
const GHOST_EDGE_ID = '__draft-edge__';
const LoadImageContext = createContext(async () => { throw new Error('canvas: no image loader injected'); });
/** Write-back actions reachable from deep inside a node card (the delete button). */
const CanvasActionsContext = createContext({
    removeNode: () => { },
});
/** A node's `url` is either a `sha256:` attachment id or a plain http(s) url. */
function isShaAttachment(url) {
    return url !== undefined && url.startsWith('sha256:');
}
/** A plain, browser-loadable image URL (NOT mock:// / other placeholder schemes). */
function isHttpUrl(url) {
    return url !== undefined && (url.startsWith('http://') || url.startsWith('https://'));
}
/** Human-readable kind caption for the card head. */
const KIND_LABEL = {
    image: '图片',
    video: '视频',
    music: '音乐',
    text: '文本',
    note: '笔记',
};
/** One inline kind glyph (16×16, stroke currentColor, consistent with the header button). */
function kindIcon(kind) {
    const common = {
        viewBox: '0 0 16 16',
        width: 14,
        height: 14,
        'aria-hidden': true,
        focusable: false,
    };
    switch (kind) {
        case 'image':
            return (_jsxs("svg", { ...common, children: [_jsx("rect", { x: "1.5", y: "2.5", width: "13", height: "11", rx: "2" }), _jsx("circle", { cx: "5", cy: "6", r: "1.4" }), _jsx("path", { d: "M2.5 12.5l3.2-3.2 2.4 2.4 2.2-2.2 3.2 3" })] }));
        case 'video':
            return (_jsxs("svg", { ...common, children: [_jsx("rect", { x: "1.5", y: "3", width: "13", height: "10", rx: "2" }), _jsx("path", { d: "M6.5 5.5l4 2.5-4 2.5z" })] }));
        case 'music':
            return (_jsxs("svg", { ...common, children: [_jsx("path", { d: "M6 2.5v8.2" }), _jsx("path", { d: "M6 10.7a1.8 1.8 0 1 1-1.8-1.8" }), _jsx("path", { d: "M6 5.3l6.5-1.8v6" }), _jsx("path", { d: "M12.5 9.5a1.8 1.8 0 1 1-1.8-1.8" })] }));
        case 'text':
            return (_jsx("svg", { ...common, children: _jsx("path", { d: "M3 4h10M3 8h10M3 12h6" }) }));
        case 'note':
            return (_jsxs("svg", { ...common, children: [_jsx("path", { d: "M3 2.5h8l2 2V13.5H3z" }), _jsx("path", { d: "M11 2.5V4.5h2" }), _jsx("path", { d: "M5.5 7h5M5.5 9.5h5M5.5 12h3" })] }));
    }
}
/** Format a seconds count as m:ss (a media node's duration meta). */
function formatDuration(seconds) {
    const total = Math.round(seconds);
    const minutes = Math.floor(total / 60);
    const rest = total % 60;
    return `${minutes}:${String(rest).padStart(2, '0')}`;
}
/**
 * A one-line fact line for the card head, derived from a node's `meta`.
 * Returns undefined when the node carries nothing worth surfacing.
 */
function metaText(kind, meta) {
    if (meta === undefined)
        return undefined;
    if (kind === 'image') {
        const width = meta['width'];
        const height = meta['height'];
        if (typeof width === 'number' && typeof height === 'number')
            return `${width} × ${height}`;
        return undefined;
    }
    if (kind === 'video' || kind === 'music') {
        const duration = meta['durationSeconds'];
        if (typeof duration === 'number' && duration > 0)
            return formatDuration(duration);
        return undefined;
    }
    return undefined;
}
/** One node card: a head row (kind glyph + caption + meta fact) over a kind body. */
function CanvasNodeCard({ id, data }) {
    const loadImage = useContext(LoadImageContext);
    const { removeNode } = useContext(CanvasActionsContext);
    const [resolved, setResolved] = useState(null);
    const sha = isShaAttachment(data.url);
    const fact = metaText(data.kind, data.meta);
    useEffect(() => {
        const url = data.url;
        if (data.kind !== 'image' || !isShaAttachment(url)) {
            setResolved(null);
            return;
        }
        let cancelled = false;
        loadImage(url)
            .then((resolvedUrl) => { if (!cancelled)
            setResolved(resolvedUrl); })
            .catch(() => { if (!cancelled)
            setResolved(null); });
        return () => { cancelled = true; };
    }, [data.kind, data.url, loadImage]);
    // Resolve an image node's <img> src. `sha256:` → loaded blob; http(s) → verbatim;
    // anything else (mock-image://, empty) → null → render a friendly placeholder
    // instead of a broken image.
    const src = sha
        ? resolved
        : (isHttpUrl(data.url) ? data.url : null);
    const hasTextBody = data.kind === 'text' || data.kind === 'note';
    // Image cards size to the picture's aspect ratio (short edge 200px, long edge
    // capped at 360px) so the image is fully shown — no `object-fit: cover` crop.
    const metaWidth = data.meta?.['width'];
    const metaHeight = data.meta?.['height'];
    const imageW = typeof metaWidth === 'number' && metaWidth > 0 ? metaWidth : undefined;
    const imageH = typeof metaHeight === 'number' && metaHeight > 0 ? metaHeight : undefined;
    let displayW = 240;
    let displayH = 180;
    if (imageW !== undefined && imageH !== undefined) {
        const ratio = imageW / imageH;
        const short = 200;
        const long = Math.min(360, short * Math.max(ratio, 1 / ratio));
        if (ratio >= 1) {
            displayW = long;
            displayH = long / ratio;
        }
        else {
            displayW = long * ratio;
            displayH = long;
        }
    }
    return (_jsxs("div", { className: "ldd-canvas-node", "data-kind": data.kind, children: [_jsx(Handle, { type: "target", position: Position.Left, className: "ldd-canvas-handle" }), _jsx(Handle, { type: "source", position: Position.Right, className: "ldd-canvas-handle" }), _jsx("button", { type: "button", className: "ldd-canvas-node-delete", title: "\u5220\u9664\u8282\u70B9", "aria-label": `删除「${data.label}」`, onClick: (event) => {
                    event.stopPropagation();
                    removeNode(id);
                }, children: _jsx("svg", { viewBox: "0 0 16 16", width: "12", height: "12", "aria-hidden": "true", focusable: "false", children: _jsx("path", { d: "M3.5 4.5h9M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9M6.5 6.5v5M9.5 6.5v5" }) }) }), _jsxs("div", { className: "ldd-canvas-node-head", children: [_jsxs("span", { className: "ldd-canvas-node-kind", children: [kindIcon(data.kind), _jsx("span", { children: KIND_LABEL[data.kind] })] }), fact !== undefined && _jsx("span", { className: "ldd-canvas-node-fact", children: fact })] }), data.kind === 'image' && (src !== null
                ? _jsx("img", { className: "ldd-canvas-node-image", src: src, alt: data.label, style: { width: displayW, height: displayH } })
                : _jsxs("div", { className: "ldd-canvas-node-image ldd-canvas-image-placeholder", children: [kindIcon('image'), "\u56FE\u7247"] })), data.kind === 'video' && (_jsxs("div", { className: "ldd-canvas-node-media", children: [_jsx("span", { className: "ldd-canvas-node-media-glyph", children: kindIcon('video') }), _jsx("span", { className: "ldd-canvas-node-media-caption", children: "\u89C6\u9891\u7D20\u6750" })] })), data.kind === 'music' && (_jsxs("div", { className: "ldd-canvas-node-media", children: [_jsx("span", { className: "ldd-canvas-node-media-glyph", children: kindIcon('music') }), _jsx("span", { className: "ldd-canvas-node-media-caption", children: "\u97F3\u9891\u7D20\u6750" })] })), hasTextBody && (_jsx("div", { className: "ldd-canvas-node-text", children: data.content === undefined || data.content === ''
                    ? _jsx("span", { className: "ldd-canvas-node-text-empty", children: "\uFF08\u65E0\u5185\u5BB9\uFF09" })
                    : data.content })), _jsx("div", { className: "ldd-canvas-node-label", children: data.label })] }));
}
/** The drop target shown while a dragged connection awaits its new node:
 *  a dashed "＋" marker at the release point. The ghost node + dashed edge are
 *  local-only (never written back) — picking a menu item replaces them with the
 *  real node + a solid edge. */
function DraftTargetNode() {
    return (_jsx("div", { className: "ldd-canvas-draft-target", children: _jsx("span", { className: "ldd-canvas-draft-plus", children: "\uFF0B" }) }));
}
const nodeTypes = {
    image: CanvasNodeCard,
    video: CanvasNodeCard,
    music: CanvasNodeCard,
    text: CanvasNodeCard,
    note: CanvasNodeCard,
    draft: DraftTargetNode,
};
function toFlowNodes(state) {
    return state.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: { x: n.x, y: n.y },
        data: { label: n.label, kind: n.kind, content: n.content, url: n.url, meta: n.meta },
    }));
}
function toFlowEdges(state) {
    return state.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        // 'default' = bezier (smooth curve); 'smoothstep' was the angular fold.
        type: 'default',
        ...(e.label === undefined || e.label === '' ? {} : { label: e.label }),
    }));
}
export function CanvasView({ useProjection, loadImage, ask, pickFiles, uploadFiles, addNode, removeNode, updateNode, moveNode, link }) {
    const canvas = useProjection('canvas');
    // Local, RESPONSIVE flow state: the projection is the authoritative mirror,
    // but dragging must feel immediate, so React Flow's `applyNodeChanges` mutates
    // a local copy on every drag frame; the projection refresh reconciles it.
    const [flowNodes, setFlowNodes] = useState([]);
    const [flowEdges, setFlowEdges] = useState([]);
    const [selected, setSelected] = useState(null);
    const [draftLabel, setDraftLabel] = useState('');
    const [draftContent, setDraftContent] = useState('');
    const [question, setQuestion] = useState('');
    // The React Flow instance, captured on init so a pane double-click can map a
    // viewport (screen) coordinate into flow-space for placing a new node.
    const rfRef = useRef(null);
    // The add-node menu, opened by double-clicking empty canvas OR by dropping a
    // dragged connection on empty canvas: screen position (for the floating menu)
    // + flow position (where the new node lands) + optional source node (a
    // drag-to-create, so the new node gets wired to that source).
    const [menu, setMenu] = useState(null);
    const lastPaneClick = useRef(null);
    // The node a dragged connection left from (set onConnectStart, read+cleared onConnectEnd).
    const connectSourceRef = useRef(null);
    // Reconcile local flow state from the projection (authoritative) on every change.
    useEffect(() => {
        if (canvas !== undefined) {
            setFlowNodes(toFlowNodes(canvas));
            setFlowEdges(toFlowEdges(canvas));
        }
    }, [canvas]);
    // While a dragged connection awaits its new node, overlay a local ghost node +
    // a dashed edge so the user sees the pending link (the release point + the
    // line that turns solid once a menu item is picked). Local-only: picking an
    // item writes the real node + edge, and the projection reconcile drops the
    // ghost. A double-click menu (no source) renders no overlay.
    const displayNodes = useMemo(() => {
        if (menu === null || menu.sourceNodeId === undefined)
            return flowNodes;
        const ghost = {
            id: GHOST_NODE_ID,
            type: 'draft',
            position: { x: menu.flowX, y: menu.flowY },
            data: {},
            draggable: false,
            selectable: false,
            connectable: false,
        };
        return [...flowNodes, ghost];
    }, [flowNodes, menu]);
    const displayEdges = useMemo(() => {
        if (menu === null || menu.sourceNodeId === undefined)
            return flowEdges;
        const dashed = {
            id: GHOST_EDGE_ID,
            source: menu.sourceNodeId,
            target: GHOST_NODE_ID,
            type: 'default',
            animated: true,
            style: { strokeDasharray: '6 6' },
        };
        return [...flowEdges, dashed];
    }, [flowEdges, menu]);
    // Seed the edit drafts when a node is selected.
    useEffect(() => {
        if (selected !== null) {
            setDraftLabel(selected.label);
            setDraftContent(selected.content ?? '');
        }
    }, [selected]);
    const onNodesChange = useCallback((changes) => {
        setFlowNodes((nds) => applyNodeChanges(changes, nds));
    }, []);
    const onEdgesChange = useCallback((changes) => {
        setFlowEdges((eds) => applyEdgeChanges(changes, eds));
    }, []);
    // Fire-and-forget write-back: log (not throw) so a transient failure never
    // takes the React tree down; the projection refresh is the reconcile.
    const run = useCallback((p) => {
        void p.catch((error) => { console.error('[ldd-canvas] write-back failed:', error); });
    }, []);
    if (canvas === undefined) {
        return _jsx("div", { className: "ldd-canvas-empty", children: "\u753B\u5E03\u4E0D\u53EF\u7528\uFF08canvas \u63D2\u4EF6\u672A\u6302\u8F7D\uFF09\u3002" });
    }
    const onDragStop = (_, node) => {
        run(moveNode(node.id, node.position.x, node.position.y));
    };
    const onConnect = (connection) => {
        const source = connection.source;
        const target = connection.target;
        if (source === null || target === null)
            return;
        run(link({ source, target }));
    };
    // Start of a dragged connection: remember the source node, so a release on
    // empty canvas can offer "create a node here" wired back to that source.
    const onConnectStart = useCallback((_event, params) => {
        connectSourceRef.current = params.nodeId;
    }, []);
    // End of a dragged connection. A valid drop already went through onConnect;
    // an empty-canvas release opens the add-node menu (the dashed ghost edge
    // stays on screen until a menu item is picked).
    const onConnectEnd = useCallback((event, connectionState) => {
        const source = connectSourceRef.current;
        connectSourceRef.current = null;
        if (source === null)
            return;
        if (connectionState.isValid)
            return;
        // MouseEvent carries clientX/Y directly; TouchEvent keeps them under `touches`.
        const point = event instanceof MouseEvent
            ? { x: event.clientX, y: event.clientY }
            : { x: event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? event.changedTouches[0]?.clientY ?? 0 };
        const flow = rfRef.current?.screenToFlowPosition({ x: point.x, y: point.y });
        if (flow === undefined)
            return;
        setSelected(null);
        setQuestion('');
        setMenu({ x: point.x, y: point.y, flowX: flow.x, flowY: flow.y, sourceNodeId: source });
    }, []);
    // Double-click empty canvas → open the add-node menu at that spot. A single
    // click just clears selection (and closes the menu). The viewport coordinate
    // maps through the React Flow instance so the node lands under the cursor.
    const onPaneClick = (event) => {
        setSelected(null);
        setQuestion('');
        const now = Date.now();
        const last = lastPaneClick.current;
        const near = last !== null && now - last.time < 350
            && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 40;
        if (near) {
            lastPaneClick.current = null;
            const flow = rfRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
            setMenu({ x: event.clientX, y: event.clientY, flowX: flow?.x ?? 0, flowY: flow?.y ?? 0 });
        }
        else {
            lastPaneClick.current = { time: now, x: event.clientX, y: event.clientY };
            setMenu(null);
        }
    };
    // Place a new asset node at the double-click / connection-drop spot. For a
    // drag-to-create (a sourceNodeId), mint the id up front and wire the new node
    // to that source in the same breath, so the dashed ghost becomes a solid edge.
    // Await addNode BEFORE link — the write-back is fire-and-forget otherwise and
    // a concurrent link could reach the host before the target node exists.
    const addAssetNode = async (kind, label) => {
        if (menu === null)
            return;
        const { flowX, flowY, sourceNodeId } = menu;
        const id = newId();
        try {
            await addNode({ id, kind, label, x: flowX, y: flowY });
            if (sourceNodeId !== undefined)
                await link({ source: sourceNodeId, target: id });
        }
        catch (error) {
            console.error('[ldd-canvas] add-node (drag-to-create) failed:', error);
        }
        setMenu(null);
    };
    // Place a card for each stored asset at (flowX, flowY), grid-laid. Images
    // carry their attachment id (+ size) so the card renders the picture; on a
    // drag-to-create, the first asset wires to the source.
    const placeAssets = async (assets, flowX, flowY, sourceNodeId) => {
        for (let index = 0; index < assets.length; index += 1) {
            const asset = assets[index];
            const col = index % 3;
            const row = Math.floor(index / 3);
            const id = newId();
            const meta = asset.width !== undefined && asset.height !== undefined
                ? { width: asset.width, height: asset.height }
                : undefined;
            try {
                await addNode({
                    id, kind: asset.kind, label: asset.name, x: flowX + col * 40, y: flowY + row * 40,
                    ...(asset.attachmentId === undefined ? {} : { url: asset.attachmentId }),
                    ...(meta === undefined ? {} : { meta }),
                });
                if (sourceNodeId !== undefined && index === 0)
                    await link({ source: sourceNodeId, target: id });
            }
            catch (error) {
                console.error('[ldd-canvas] upload node failed:', error);
            }
        }
    };
    // Menu-bar upload: open the picker, store the files, place the cards.
    const uploadAssets = async () => {
        if (menu === null)
            return;
        const { flowX, flowY, sourceNodeId } = menu;
        const files = await pickFiles();
        if (files.length === 0) {
            setMenu(null);
            return;
        }
        const assets = await uploadFiles(files).catch(() => []);
        await placeAssets(assets, flowX, flowY, sourceNodeId);
        setMenu(null);
    };
    // Drag-and-drop upload: files dropped on the canvas become cards at the drop
    // spot (images store + render; video/audio write to the workspace).
    const onCanvasDrop = async (event) => {
        event.preventDefault();
        // stopPropagation is REQUIRED: the composer (conversation input) registers
        // document-level dragenter/dragover/drop listeners that would otherwise also
        // consume the same drop and add the files to the input attachment rail
        // instead of the canvas. Keeping the drop from bubbling to document means
        // the canvas owns files dropped over it.
        event.stopPropagation();
        const files = Array.from(event.dataTransfer?.files ?? []);
        if (files.length === 0)
            return;
        const flow = rfRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY });
        const assets = await uploadFiles(files).catch((error) => {
            console.error('[ldd-canvas] upload failed:', error);
            return [];
        });
        await placeAssets(assets, flow?.x ?? 0, flow?.y ?? 0);
    };
    const onCanvasDragOver = (event) => {
        event.preventDefault();
        // Same reason as onDrop: don't let the composer's document-level dragover
        // (which flips its dropEffect and shows the global drop overlay) override
        // the canvas's own handling.
        event.stopPropagation();
        if (event.dataTransfer !== null)
            event.dataTransfer.dropEffect = 'copy';
    };
    // dragenter/dragleave MUST also stopPropagation. The composer (conversation
    // input) tracks a document-level dragenter/dragleave depth to show its
    // full-screen DropOverlay. Without these, dragging a file over the canvas
    // fires the composer's dragenter (overlay pops up), then onCanvasDrop's
    // stopPropagation swallows the composer's drop — so its depth never resets,
    // the drop source is the external file manager (no dragend in this window),
    // and the overlay sticks forever, blocking the canvas. Stopping the enter/
    // leave here keeps the canvas an isolated drop zone: the overlay only ever
    // appears when files are dragged over the composer area itself.
    const onCanvasDragEnter = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    const onCanvasDragLeave = (event) => {
        event.preventDefault();
        event.stopPropagation();
    };
    const saveEdit = () => {
        if (selected === null)
            return;
        const patch = {};
        const label = draftLabel.trim();
        if (label !== '' && label !== selected.label)
            patch.label = label;
        if ((selected.kind === 'text' || selected.kind === 'note') && draftContent !== selected.content) {
            patch.content = draftContent;
        }
        if (Object.keys(patch).length > 0)
            run(updateNode(selected.id, patch));
        setSelected(null);
    };
    const deleteSelected = () => {
        if (selected === null)
            return;
        run(removeNode(selected.id));
        setSelected(null);
    };
    const submitAsk = () => {
        if (selected === null)
            return;
        const text = question.trim();
        if (text === '')
            return;
        void ask(`关于画布上的节点「${selected.label}」（${KIND_LABEL[selected.kind]}），${text}`);
        setQuestion('');
    };
    const actions = useMemo(() => ({
        removeNode: (nodeId) => {
            run(removeNode(nodeId));
            setSelected((sel) => (sel !== null && sel.id === nodeId ? null : sel));
        },
    }), [removeNode, run]);
    return (_jsx(LoadImageContext.Provider, { value: loadImage, children: _jsx(CanvasActionsContext.Provider, { value: actions, children: _jsxs("div", { className: "ldd-canvas-root", onDragEnter: onCanvasDragEnter, onDragOver: onCanvasDragOver, onDragLeave: onCanvasDragLeave, onDrop: (event) => { void onCanvasDrop(event); }, children: [_jsxs(ReactFlow, { nodes: displayNodes, edges: displayEdges, nodeTypes: nodeTypes, onInit: (rf) => { rfRef.current = rf; }, onNodesChange: onNodesChange, onEdgesChange: onEdgesChange, onNodeDragStop: onDragStop, onConnect: onConnect, onConnectStart: onConnectStart, onConnectEnd: onConnectEnd, 
                        // Left/middle/right all pan the empty canvas (right-drag = pan).
                        panOnDrag: [0, 1, 2], onNodeClick: (_, node) => {
                            const data = node.data;
                            setSelected({
                                id: node.id,
                                label: data.label,
                                kind: data.kind,
                                ...(data.content === undefined ? {} : { content: data.content }),
                            });
                            setQuestion('');
                            setMenu(null);
                        }, onPaneClick: onPaneClick, fitView: true, proOptions: { hideAttribution: true }, children: [_jsx(MiniMap, {}), _jsx(Controls, {}), _jsx(Background, {})] }), canvas.nodes.length === 0 && (_jsx("div", { className: "ldd-canvas-empty-hint", children: "\u753B\u5E03\u4E3A\u7A7A\u3002\u53CC\u51FB\u753B\u5E03\u6DFB\u52A0\u8282\u70B9\uFF0C\u6216\u5728\u5BF9\u8BDD\u4E2D\u8BA9\u667A\u80FD\u4F53\u5F80\u753B\u5E03\u6DFB\u52A0\u5185\u5BB9\u3002" })), menu !== null && (_jsxs("div", { className: "ldd-canvas-menu", style: { left: menu.x, top: menu.y }, children: [_jsx("button", { type: "button", onClick: () => { void uploadAssets(); }, children: "\u4E0A\u4F20" }), _jsx("button", { type: "button", onClick: () => { void addAssetNode('image', '新图片'); }, children: "\u56FE\u7247" }), _jsx("button", { type: "button", onClick: () => { void addAssetNode('music', '新音频'); }, children: "\u97F3\u9891" }), _jsx("button", { type: "button", onClick: () => { void addAssetNode('video', '新视频'); }, children: "\u89C6\u9891" })] })), selected !== null && (_jsxs("div", { className: "ldd-canvas-edit", children: [_jsxs("div", { className: "ldd-canvas-edit-row", children: [_jsxs("span", { className: "ldd-canvas-edit-kind", children: [kindIcon(selected.kind), _jsx("span", { children: KIND_LABEL[selected.kind] })] }), _jsx("input", { className: "ldd-canvas-edit-label", value: draftLabel, onChange: (event) => setDraftLabel(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter')
                                            saveEdit(); }, placeholder: "\u8282\u70B9\u6807\u9898" }), _jsx("button", { type: "button", className: "ldd-canvas-edit-save", onClick: saveEdit, children: "\u4FDD\u5B58" }), _jsx("button", { type: "button", className: "ldd-canvas-edit-delete", onClick: deleteSelected, children: "\u5220\u9664" })] }), (selected.kind === 'text' || selected.kind === 'note') && (_jsx("textarea", { className: "ldd-canvas-edit-content", value: draftContent, onChange: (event) => setDraftContent(event.target.value), placeholder: "\u5185\u5BB9\u2026", rows: 3 })), _jsxs("div", { className: "ldd-canvas-edit-row ldd-canvas-edit-ask", children: [_jsx("span", { className: "ldd-canvas-ask-title", children: "\u95EE agent" }), _jsx("input", { className: "ldd-canvas-ask-input", value: question, onChange: (event) => setQuestion(event.target.value), onKeyDown: (event) => { if (event.key === 'Enter')
                                            submitAsk(); }, placeholder: "\u5173\u4E8E\u8FD9\u4E2A\u8282\u70B9\u4F60\u60F3\u95EE\u4EC0\u4E48\uFF1F" }), _jsx("button", { type: "button", className: "ldd-canvas-ask-submit", onClick: submitAsk, disabled: question.trim() === '', children: "\u53D1\u9001" })] })] }))] }) }) }));
}
//# sourceMappingURL=CanvasView.js.map