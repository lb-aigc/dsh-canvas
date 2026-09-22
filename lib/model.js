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
/** Find one node by id. */
export function findNode(state, nodeId) {
    return state.nodes.find((n) => n.id === nodeId);
}
//# sourceMappingURL=model.js.map