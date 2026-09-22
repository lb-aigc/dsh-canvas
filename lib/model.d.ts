/**
 * Canvas data model + pure state transitions. Kept dependency-light (no
 * cordis / dsh-tools / react) so `tests/model.verify.ts` can exercise it
 * directly under the Node strip-only verify harness, and so the Host half and
 * the Client half share ONE source of truth for node/edge shape.
 */
/** Lossless JSON value — the ceiling for anything the canvas persists. */
export type JsonValue = null | boolean | number | string | JsonValue[] | {
    [key: string]: JsonValue;
};
/** What a canvas node holds. Assets (image/video/music) reference an attachment
 *  or URL; text/note nodes carry inline content. */
export type CanvasNodeKind = 'image' | 'video' | 'music' | 'text' | 'note';
/** One node on the canvas. Stable across a session; persisted whole. */
export interface CanvasNode {
    /** Stable id (uuid). */
    id: string;
    kind: CanvasNodeKind;
    /** Display title. */
    label: string;
    /** Canvas coordinates (flow-space, not screen px). */
    x: number;
    y: number;
    /** Content-addressed attachment id (`sha256:...`), for asset nodes. */
    attachmentId?: string;
    /** Transient URL (not persisted — regenerated per session). */
    url?: string;
    /** Per-kind metadata: width/height for image, duration/aspect for video, … */
    meta?: Record<string, JsonValue>;
    /** Inline content for text/note nodes. */
    content?: string;
}
/** One directed relation between two nodes. */
export interface CanvasEdge {
    id: string;
    source: string;
    target: string;
    /** Human relation label, e.g. "参考", "依赖". */
    label?: string;
}
/** The whole canvas for one session. */
export interface CanvasState {
    nodes: CanvasNode[];
    edges: CanvasEdge[];
}
/** Empty canvas. */
export declare function emptyCanvas(): CanvasState;
/** New node id. `crypto.randomUUID` exists in Node ≥ 16 and all browsers. */
export declare function newId(): string;
/**
 * Add a node. Returns the new state and the added node (with its generated id).
 * Ids are de-duped: a caller-supplied id that collides is re-minted.
 */
export declare function addNode(state: CanvasState, node: Omit<CanvasNode, 'id'> & {
    id?: string;
}): {
    state: CanvasState;
    node: CanvasNode;
};
/**
 * Remove a node and every edge touching it. Idempotent: a missing id is a
 * no-op returning the same state.
 */
export declare function removeNode(state: CanvasState, nodeId: string): CanvasState;
/** Add a directed edge. Both endpoints must exist, else it throws. */
export declare function addEdge(state: CanvasState, edge: Omit<CanvasEdge, 'id'> & {
    id?: string;
}): {
    state: CanvasState;
    edge: CanvasEdge;
};
/** Patch one node's mutable fields. Missing id is a no-op. */
export declare function updateNode(state: CanvasState, nodeId: string, patch: Partial<Pick<CanvasNode, 'label' | 'x' | 'y' | 'content' | 'meta' | 'url'>>): CanvasState;
/** Find one node by id. */
export declare function findNode(state: CanvasState, nodeId: string): CanvasNode | undefined;
//# sourceMappingURL=model.d.ts.map