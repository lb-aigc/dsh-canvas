/**
 * Canvas data model + pure state transitions. Kept dependency-light (no
 * cordis / dsh-tools / react) so `tests/model.verify.ts` can exercise it
 * directly under the Node strip-only verify harness, and so the Host half and
 * the Client half share ONE source of truth for node/edge shape.
 */
/** Empty canvas. */
export function emptyCanvas() {
    return { nodes: [], edges: [] };
}
/** New node id. `crypto.randomUUID` exists in Node ≥ 16 and all browsers. */
export function newId() {
    return crypto.randomUUID();
}
/**
 * Add a node. Returns the new state and the added node (with its generated id).
 * Ids are de-duped: a caller-supplied id that collides is re-minted.
 */
export function addNode(state, node) {
    const id = node.id !== undefined && node.id !== '' && !state.nodes.some((n) => n.id === node.id)
        ? node.id
        : newId();
    const added = { ...node, id };
    return { state: { ...state, nodes: [...state.nodes, added] }, node: added };
}
/**
 * Remove a node and every edge touching it. Idempotent: a missing id is a
 * no-op returning the same state.
 */
export function removeNode(state, nodeId) {
    if (!state.nodes.some((n) => n.id === nodeId))
        return state;
    return {
        nodes: state.nodes.filter((n) => n.id !== nodeId),
        edges: state.edges.filter((e) => e.source !== nodeId && e.target !== nodeId),
    };
}
/** Add a directed edge. Both endpoints must exist, else it throws. */
export function addEdge(state, edge) {
    const sourceExists = state.nodes.some((n) => n.id === edge.source);
    const targetExists = state.nodes.some((n) => n.id === edge.target);
    if (!sourceExists || !targetExists) {
        throw new Error(`canvas_link 需要两个已存在的节点（source=${edge.source} target=${edge.target}）`);
    }
    const id = edge.id !== undefined && edge.id !== '' ? edge.id : newId();
    const added = { ...edge, id };
    return { state: { ...state, edges: [...state.edges, added] }, edge: added };
}
/** Patch one node's mutable fields. Missing id is a no-op. */
export function updateNode(state, nodeId, patch) {
    return {
        ...state,
        nodes: state.nodes.map((n) => (n.id === nodeId ? { ...n, ...patch } : n)),
    };
}
/** Promote one variant of a multi-variant node to primary. Updates the node's
 *  `url` (to the variant's attachment id), `primaryIndex`, and the image
 *  geometry meta (width/height/mediaType/bytes) so the read-back / reference /
 *  download channels — which all key off `url` + `meta` — follow the new
 *  surface image. A missing node or out-of-range index is a no-op. */
export function setPrimaryVariant(state, nodeId, variantIndex) {
    return {
        ...state,
        nodes: state.nodes.map((n) => {
            if (n.id !== nodeId)
                return n;
            const variants = n.variants ?? [];
            const variant = variants[variantIndex];
            if (variant === undefined)
                return n;
            return {
                ...n,
                url: variant.attachmentId,
                primaryIndex: variantIndex,
                meta: {
                    ...(n.meta ?? {}),
                    ...(variant.mediaType === undefined ? {} : { mediaType: variant.mediaType }),
                    ...(variant.bytes === undefined ? {} : { bytes: variant.bytes }),
                    ...(variant.width === undefined ? {} : { width: variant.width }),
                    ...(variant.height === undefined ? {} : { height: variant.height }),
                },
            };
        }),
    };
}
/** The node's primary (surface) image variant, or undefined when it has none.
 *  A single-image node exposes its `url`/`meta` as a one-element variant, so
 *  callers that only need "the image to use as reference / download / copy"
 *  always resolve through this without branching on multi vs single. */
export function primaryVariantOf(node) {
    const variants = node.variants ?? [];
    const idx = typeof node.primaryIndex === 'number' && node.primaryIndex >= 0 ? node.primaryIndex : 0;
    const variant = variants[idx];
    if (variant !== undefined)
        return variant;
    if (node.url !== undefined && node.url !== '') {
        return {
            attachmentId: node.url,
            ...(typeof node.meta?.['mediaType'] === 'string' ? { mediaType: node.meta['mediaType'] } : {}),
            ...(typeof node.meta?.['bytes'] === 'number' ? { bytes: node.meta['bytes'] } : {}),
            ...(typeof node.meta?.['width'] === 'number' ? { width: node.meta['width'] } : {}),
            ...(typeof node.meta?.['height'] === 'number' ? { height: node.meta['height'] } : {}),
        };
    }
    return undefined;
}
/** Find one node by id. */
export function findNode(state, nodeId) {
    return state.nodes.find((n) => n.id === nodeId);
}
//# sourceMappingURL=model.js.map