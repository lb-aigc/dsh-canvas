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
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import type { DragEvent as ReactDragEvent, KeyboardEvent as ReactKeyboardEvent, MouseEvent as ReactMouseEvent, ReactNode } from 'react'
import {
  Background,
  Controls,
  Handle,
  MiniMap,
  Position,
  ReactFlow,
  SelectionMode,
  applyEdgeChanges,
  applyNodeChanges,
} from '@xyflow/react'
import type { Edge, FinalConnectionState, Node, NodeTypes, OnConnect, OnConnectStartParams, ReactFlowInstance } from '@xyflow/react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'
import { newId } from '../model.ts'
import type { CanvasNode, CanvasState, JsonValue } from '../model.ts'
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasReadAssetRequest, CanvasUpdateNodeRequest } from '../types.ts'
import './react-flow.css'
import './canvas.css'

/** Local-only ids for the drag-to-create ghost node + dashed edge overlay. */
const GHOST_NODE_ID = '__draft-target__'
const GHOST_EDGE_ID = '__draft-edge__'

/** The write-back verbs the seat face exposes (the client half of CanvasService). */
export interface CanvasWriteback {
  addNode(request: CanvasAddNodeRequest): Promise<CanvasState>
  removeNode(nodeId: string): Promise<CanvasState>
  updateNode(nodeId: string, patch: CanvasUpdateNodeRequest): Promise<CanvasState>
  moveNode(nodeId: string, x: number, y: number): Promise<CanvasState>
  link(request: CanvasLinkRequest): Promise<CanvasState>
}

/** Live agent-composer face: the canvas's own bottom input box drives the REAL
 *  conversation composer — same draft, same send path, same attachments. */
export interface CanvasComposer {
  /** Replace the conversation draft (persisted to the real composer). */
  setDraft(text: string): void
  /** Register image files as real composer attachments (thumbnail drafts). */
  attachImages(files: File[]): boolean
  /** Send the current draft + attachments through the normal composer path. */
  submit(): void
}

/** One selectable generation model in the canvas composer's dropdown. */
export interface CanvasModelOption {
  key: string
  label: string
  selected: boolean
}

/** Generation-model switch face (drives the `/generate-model` slash command). */
export interface CanvasModels {
  /** The configured image models for the current session's dropdown. */
  list(): CanvasModelOption[]
  /** Temporarily switch this session's image model (does not change the default). */
  select(key: string): void
}

/** Injected per-session canvas face: image loader + one-shot agent prompt + write-back. */
export interface CanvasViewInjected extends CanvasWriteback {
  loadImage: (ref: CanvasReadAssetRequest) => Promise<string>
  ask: (text: string) => Promise<void>
  /** Put a node into the agent composer input box (image → thumbnail attachment,
   *  text/note → draft text), without sending. */
  addNodeToInput: (node: CanvasNode) => Promise<void>
  /** Copy a node to the SYSTEM clipboard (image → bitmap, text/note → text). */
  copyNodeToClipboard: (node: CanvasNode) => Promise<void>
  /** Generation-model switch for the canvas composer's dropdown. */
  models: CanvasModels
  /** The canvas's own composer input (drives the real conversation composer). */
  compose: CanvasComposer
  /** Open the native file picker (menu-bar upload). */
  pickFiles: (kind?: 'image' | 'video' | 'music') => Promise<File[]>
  /** Store the given files (image → attachment, video/audio → workspace) and
   *  return the ones that map to a canvas asset kind. */
  uploadFiles: (files: File[]) => Promise<CanvasUploadedAsset[]>
}

/** One media file that was uploaded and can become a canvas node. */
export interface CanvasUploadedAsset {
  name: string
  kind: 'image' | 'video' | 'music'
  /** Content-addressed attachment id (images only; the node's `url`). */
  attachmentId?: string
  /** Normalized image width in px (images only). */
  width?: number
  /** Normalized image height in px (images only). */
  height?: number
  /** Verified media type of the stored image (images only). */
  mediaType?: string
  /** Exact encoded byte length of the stored image (images only). */
  bytes?: number
}

/**
 * What the canvas needs from a seat, spelled structurally so ONE component can
 * be registered in both the right Sidebar's tab body and the Conversation's view
 * tab: every session-scoped seat hands over the same Session standard props, and
 * both registrations inject the same `loadImage` face. The projection hook's type
 * is read off the seat that declares it instead of restated, so a seat change
 * surfaces here rather than drifting silently.
 */
export interface CanvasViewProps {
  /** Host-computed projection values; `canvas` is this plugin's projection. */
  useProjection: PropsRuntime<'sidebar.right.pane.tab'>['useProjection']
  /** Injected per-session image loader. */
  loadImage: CanvasViewInjected['loadImage']
  /** Injected one-shot agent prompt (ask about a selected node). */
  ask: CanvasViewInjected['ask']
  /** Injected composer-node injection (image → attachment, text/note → draft). */
  addNodeToInput: CanvasViewInjected['addNodeToInput']
  /** Injected clipboard copy (image → bitmap, text/note → text). */
  copyNodeToClipboard: CanvasViewInjected['copyNodeToClipboard']
  /** Injected generation-model switch. */
  models: CanvasViewInjected['models']
  /** Injected canvas composer (drives the real conversation composer). */
  compose: CanvasViewInjected['compose']
  /** Injected file picker (menu-bar upload). */
  pickFiles: CanvasViewInjected['pickFiles']
  /** Injected file store (image → attachment, video/audio → workspace). */
  uploadFiles: CanvasViewInjected['uploadFiles']
  /** Injected write-back verbs (user edits land as durable canvas/state events). */
  addNode: CanvasWriteback['addNode']
  removeNode: CanvasWriteback['removeNode']
  updateNode: CanvasWriteback['updateNode']
  moveNode: CanvasWriteback['moveNode']
  link: CanvasWriteback['link']
}

const LoadImageContext = createContext<(ref: CanvasReadAssetRequest) => Promise<string>>(
  async () => { throw new Error('canvas: no image loader injected') },
)

/** Write-back actions reachable from deep inside a node card (the delete button). */
const CanvasActionsContext = createContext<{ removeNode: (nodeId: string) => void }>({
  removeNode: () => {},
})

/** A node's `url` is either a `sha256:` attachment id or a plain http(s) url. */
function isShaAttachment(url: string | undefined): url is string {
  return url !== undefined && url.startsWith('sha256:')
}

/** A plain, browser-loadable image URL (NOT mock:// / other placeholder schemes). */
function isHttpUrl(url: string | undefined): url is string {
  return url !== undefined && (url.startsWith('http://') || url.startsWith('https://'))
}

interface CanvasNodeData {
  label: string
  kind: CanvasNode['kind']
  content?: string
  url?: string
  meta?: Record<string, JsonValue>
}

/** Human-readable kind caption for the card head. */
const KIND_LABEL: Record<CanvasNode['kind'], string> = {
  image: '图片',
  video: '视频',
  music: '音乐',
  text: '文本',
  note: '笔记',
}

/** One inline kind glyph (16×16, stroke currentColor, consistent with the header button). */
function kindIcon(kind: CanvasNode['kind']): ReactNode {
  const common = {
    viewBox: '0 0 16 16',
    width: 14,
    height: 14,
    'aria-hidden': true,
    focusable: false,
  } as const
  switch (kind) {
    case 'image':
      return (
        <svg {...common}>
          <rect x="1.5" y="2.5" width="13" height="11" rx="2" />
          <circle cx="5" cy="6" r="1.4" />
          <path d="M2.5 12.5l3.2-3.2 2.4 2.4 2.2-2.2 3.2 3" />
        </svg>
      )
    case 'video':
      return (
        <svg {...common}>
          <rect x="1.5" y="3" width="13" height="10" rx="2" />
          <path d="M6.5 5.5l4 2.5-4 2.5z" />
        </svg>
      )
    case 'music':
      return (
        <svg {...common}>
          <path d="M6 2.5v8.2" />
          <path d="M6 10.7a1.8 1.8 0 1 1-1.8-1.8" />
          <path d="M6 5.3l6.5-1.8v6" />
          <path d="M12.5 9.5a1.8 1.8 0 1 1-1.8-1.8" />
        </svg>
      )
    case 'text':
      return (
        <svg {...common}>
          <path d="M3 4h10M3 8h10M3 12h6" />
        </svg>
      )
    case 'note':
      return (
        <svg {...common}>
          <path d="M3 2.5h8l2 2V13.5H3z" />
          <path d="M11 2.5V4.5h2" />
          <path d="M5.5 7h5M5.5 9.5h5M5.5 12h3" />
        </svg>
      )
  }
}

/** Format a seconds count as m:ss (a media node's duration meta). */
function formatDuration(seconds: number): string {
  const total = Math.round(seconds)
  const minutes = Math.floor(total / 60)
  const rest = total % 60
  return `${minutes}:${String(rest).padStart(2, '0')}`
}

/**
 * A one-line fact line for the card head, derived from a node's `meta`.
 * Returns undefined when the node carries nothing worth surfacing.
 */
function metaText(kind: CanvasNode['kind'], meta: Record<string, JsonValue> | undefined): string | undefined {
  if (meta === undefined) return undefined
  if (kind === 'image') {
    const width = meta['width']
    const height = meta['height']
    if (typeof width === 'number' && typeof height === 'number') return `${width} × ${height}`
    return undefined
  }
  if (kind === 'video' || kind === 'music') {
    const duration = meta['durationSeconds']
    if (typeof duration === 'number' && duration > 0) return formatDuration(duration)
    return undefined
  }
  return undefined
}

/** One node card: a head row (kind glyph + caption + meta fact) over a kind body. */
function CanvasNodeCard({ id, data }: { id: string; data: CanvasNodeData }) {
  const loadImage = useContext(LoadImageContext)
  const { removeNode } = useContext(CanvasActionsContext)
  const [resolved, setResolved] = useState<string | null>(null)
  const sha = isShaAttachment(data.url)
  const fact = metaText(data.kind, data.meta)

  useEffect(() => {
    const url = data.url
    if (data.kind !== 'image' || !isShaAttachment(url)) {
      setResolved(null)
      return
    }
    // Rebuild the full durable reference from the node's meta. A canvas image
    // carries its media type / byte length / size in `meta` (written at upload
    // time) so `loadImage` can read it back through the canvas's own channel.
    const meta = data.meta
    const mediaType = typeof meta?.mediaType === 'string' ? meta.mediaType : undefined
    const bytes = typeof meta?.bytes === 'number' ? meta.bytes : undefined
    const width = typeof meta?.width === 'number' ? meta.width : undefined
    const height = typeof meta?.height === 'number' ? meta.height : undefined
    if (mediaType === undefined || bytes === undefined || width === undefined || height === undefined) {
      setResolved(null)
      return
    }
    let cancelled = false
    loadImage({ attachmentId: url, mediaType, bytes, width, height })
      .then((resolvedUrl) => { if (!cancelled) setResolved(resolvedUrl) })
      .catch(() => { if (!cancelled) setResolved(null) })
    return () => { cancelled = true }
  }, [data.kind, data.url, data.meta, loadImage])

  // Resolve an image node's <img> src. `sha256:` → loaded blob; http(s) → verbatim;
  // anything else (mock-image://, empty) → null → render a friendly placeholder
  // instead of a broken image.
  const src: string | null = sha
    ? resolved
    : (isHttpUrl(data.url) ? data.url : null)

  const hasTextBody = data.kind === 'text' || data.kind === 'note'

  // Image cards size to the picture's aspect ratio (short edge 200px, long edge
  // capped at 360px) so the image is fully shown — no `object-fit: cover` crop.
  const metaWidth = data.meta?.['width']
  const metaHeight = data.meta?.['height']
  const imageW = typeof metaWidth === 'number' && metaWidth > 0 ? metaWidth : undefined
  const imageH = typeof metaHeight === 'number' && metaHeight > 0 ? metaHeight : undefined
  let displayW = 240
  let displayH = 180
  if (imageW !== undefined && imageH !== undefined) {
    const ratio = imageW / imageH
    const short = 200
    const long = Math.min(360, short * Math.max(ratio, 1 / ratio))
    if (ratio >= 1) { displayW = long; displayH = long / ratio }
    else { displayW = long * ratio; displayH = long }
  }

  return (
    <>
    <div className="ldd-canvas-node" data-kind={data.kind}>
      <button
        type="button"
        className="ldd-canvas-node-delete nodrag"
        title="删除节点"
        aria-label={`删除「${data.label}」`}
        onClick={(event) => {
          event.stopPropagation()
          removeNode(id)
        }}
      >
        <svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false">
          <path d="M3.5 4.5h9M6.5 4.5V3h3v1.5M4.5 4.5l.7 9h5.6l.7-9M6.5 6.5v5M9.5 6.5v5" />
        </svg>
      </button>

      <div className="ldd-canvas-node-head">
        <span className="ldd-canvas-node-kind">{kindIcon(data.kind)}<span>{KIND_LABEL[data.kind]}</span></span>
        {fact !== undefined && <span className="ldd-canvas-node-fact">{fact}</span>}
      </div>

      {data.kind === 'image' && (
        src !== null
          ? <img className="ldd-canvas-node-image" src={src} alt={data.label} style={{ width: displayW, height: displayH }} />
          : <div className="ldd-canvas-node-image ldd-canvas-image-placeholder" style={{ width: 240, height: 180 }}>{kindIcon('image')}图片</div>
      )}

      {data.kind === 'video' && (
        <div className="ldd-canvas-node-image ldd-canvas-image-placeholder" style={{ width: 240, height: 180 }}>{kindIcon('video')}视频</div>
      )}

      {data.kind === 'music' && (
        <div className="ldd-canvas-node-media">
          <span className="ldd-canvas-node-media-glyph">{kindIcon('music')}</span>
          <span className="ldd-canvas-node-media-caption">音频素材</span>
        </div>
      )}

      {hasTextBody && (
        <div className="ldd-canvas-node-text">
          {data.content === undefined || data.content === ''
            ? <span className="ldd-canvas-node-text-empty">（无内容）</span>
            : data.content}
        </div>
      )}

      <div className="ldd-canvas-node-label">{data.label}</div>
    </div>
    {/* Connection ports float OUTSIDE the card frame (siblings, not children),
        so the card's rounded-corner `overflow: hidden` clip can't cut them off;
        they sit a gap away from the side, ComfyUI-style. */}
    <Handle type="target" position={Position.Left} className="ldd-canvas-handle">
      <svg className="ldd-canvas-handle-plus" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </Handle>
    <Handle type="source" position={Position.Right} className="ldd-canvas-handle">
      <svg className="ldd-canvas-handle-plus" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
        <path d="M8 3.5v9M3.5 8h9" />
      </svg>
    </Handle>
    </>
  )
}

/** The drop target shown while a dragged connection awaits its new node:
 *  a dashed "＋" marker at the release point. The ghost node + dashed edge are
 *  local-only (never written back) — picking a menu item replaces them with the
 *  real node + a solid edge. */
function DraftTargetNode() {
  return (
    <div className="ldd-canvas-draft-target">
      {/* The ghost needs a target Handle so the dashed ghost edge has a real
          endpoint to anchor to: React Flow's getEdgePosition returns null (and
          silently drops the edge) when the target node has no handle bounds. */}
      <Handle type="target" position={Position.Left} className="ldd-canvas-draft-handle" />
      <span className="ldd-canvas-draft-plus">＋</span>
    </div>
  )
}

const nodeTypes: NodeTypes = {
  image: CanvasNodeCard,
  video: CanvasNodeCard,
  music: CanvasNodeCard,
  text: CanvasNodeCard,
  note: CanvasNodeCard,
  draft: DraftTargetNode,
}

function toFlowNodes(state: CanvasState): Node[] {
  return state.nodes.map((n) => ({
    id: n.id,
    type: n.kind,
    position: { x: n.x, y: n.y },
    data: { label: n.label, kind: n.kind, content: n.content, url: n.url, meta: n.meta },
  }))
}

function toFlowEdges(state: CanvasState): Edge[] {
  return state.edges.map((e) => ({
    id: e.id,
    source: e.source,
    target: e.target,
    // 'default' = bezier (smooth curve); 'smoothstep' was the angular fold.
    type: 'default',
    ...(e.label === undefined || e.label === '' ? {} : { label: e.label }),
  }))
}

export function CanvasView({ useProjection, loadImage, addNodeToInput, copyNodeToClipboard, models, compose, pickFiles, uploadFiles, addNode, removeNode, updateNode, moveNode, link }: CanvasViewProps) {
  const canvas = useProjection('canvas')

  // Local, RESPONSIVE flow state: the projection is the authoritative mirror,
  // but dragging must feel immediate, so React Flow's `applyNodeChanges` mutates
  // a local copy on every drag frame; the projection refresh reconciles it.
  const [flowNodes, setFlowNodes] = useState<Node[]>([])
  const [flowEdges, setFlowEdges] = useState<Edge[]>([])

  // The canvas's own agent composer: draft text + pending image attachments,
  // flushed into the real conversation composer on send.
  const [composeText, setComposeText] = useState('')
  const [composeFiles, setComposeFiles] = useState<File[]>([])
  // The selected generation model key for the composer dropdown (re-read from
  // the face on open; this holds the picked value for the controlled <select>).
  const [modelOptions, setModelOptions] = useState<CanvasModelOption[]>([])
  const [selectedModel, setSelectedModel] = useState<string>('')
  const [modelsOpen, setModelsOpen] = useState(false)
  // Last write-back failure, surfaced in a dismissible banner (the user has no
  // DevTools, so console-only errors were invisible). Cleared on any success.
  const [writebackError, setWritebackError] = useState<string | null>(null)

  // The React Flow instance, captured on init so a pane double-click can map a
  // viewport (screen) coordinate into flow-space for placing a new node.
  const rfRef = useRef<ReactFlowInstance | null>(null)
  // The canvas root element, for measuring the live viewport center when
  // re-anchoring host-mirrored (autoPlace) node clusters.
  const rootRef = useRef<HTMLDivElement | null>(null)
  // The add-node menu, opened by double-clicking empty canvas OR by dropping a
  // dragged connection on empty canvas: screen position (for the floating menu)
  // + flow position (where the new node lands) + optional source node (a
  // drag-to-create, so the new node gets wired to that source).
  const [menu, setMenu] = useState<{ x: number; y: number; flowX: number; flowY: number; sourceNodeId?: string } | null>(null)
  const lastPaneClick = useRef<{ time: number; x: number; y: number } | null>(null)
  // The node a dragged connection left from (set onConnectStart, read+cleared onConnectEnd).
  const connectSourceRef = useRef<string | null>(null)
  // Right-click node context menu (删除 / 复制 / 添加至输入框), in screen px.
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string } | null>(null)

  // Reconcile local flow state from the projection (authoritative) on every change.
  useEffect(() => {
    if (canvas !== undefined) {
      setFlowNodes(toFlowNodes(canvas))
      setFlowEdges(toFlowEdges(canvas))
    }
  }, [canvas])

  // Re-anchor host-mirrored reference-image clusters (meta.autoPlace) into the
  // LIVE viewport. The host mirrors external uploads at a placeholder origin
  // (it has no viewport); the client knows where the user is looking, so it
  // stacks the newly-mirrored source images vertically on the left and the
  // downstream placeholder to the right — the whole cluster centered on the
  // current view — then clears `autoPlace` so this runs exactly once per cluster.
  // A placeholder that arrived without newly-mirrored sources (references that
  // were already on the canvas) keeps its host-computed position; only the flag
  // is cleared.
  useEffect(() => {
    if (canvas === undefined) return
    const autoNodes = canvas.nodes.filter((n: CanvasNode) => n.meta?.autoPlace === true)
    if (autoNodes.length === 0) return
    const rf = rfRef.current
    const rootEl = rootRef.current
    if (rf === null || rootEl === null) return
    const strip = (meta: Record<string, JsonValue>): Record<string, JsonValue> => {
      const rest: Record<string, JsonValue> = { ...meta }
      delete rest['autoPlace']
      return rest
    }
    const sources = autoNodes.filter((n: CanvasNode) => n.meta?.pending !== true)
    const pendings = autoNodes.filter((n: CanvasNode) => n.meta?.pending === true)
    const rect = rootEl.getBoundingClientRect()
    const center = rf.screenToFlowPosition({ x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 })
    const colX = center.x - 220
    // Stack vertically with a PER-NODE height (not a fixed gap): image cards
    // size to their aspect ratio (short edge 200px, long edge ≤360px) plus the
    // head/label rows, so a fixed 280px gap overlaps tall (portrait / near-square)
    // cards. Sum the real heights + a 36px gutter so nothing ever collides.
    const nodeHeightOf = (node: CanvasNode): number => {
      const w = node.meta?.['width']
      const h = node.meta?.['height']
      if (typeof w === 'number' && typeof h === 'number' && w > 0 && h > 0) {
        const ratio = w / h
        const short = 200
        const long = Math.min(360, short * Math.max(ratio, 1 / ratio))
        const body = ratio >= 1 ? long / ratio : long
        return body + 52
      }
      return 232 // video 4:3 placeholder / unknown
    }
    if (sources.length > 0) {
      const heights = sources.map(nodeHeightOf)
      const total = heights.reduce((a: number, b: number) => a + b, 0) + (sources.length - 1) * 36
      let y = center.y - total / 2
      for (let i = 0; i < sources.length; i += 1) {
        const node = sources[i]!
        void updateNode(node.id, { x: colX, y, meta: strip(node.meta ?? {}) }).catch(() => {})
        y += heights[i]! + 36
      }
    }
    for (const node of pendings) {
      if (sources.length > 0) {
        void updateNode(node.id, { x: center.x + 220, y: center.y, meta: strip(node.meta ?? {}) }).catch(() => {})
      } else {
        void updateNode(node.id, { meta: strip(node.meta ?? {}) }).catch(() => {})
      }
    }
  }, [canvas, updateNode])

  // While a dragged connection awaits its new node, overlay a local ghost node +
  // a dashed edge so the user sees the pending link (the release point + the
  // line that turns solid once a menu item is picked). Local-only: picking an
  // item writes the real node + edge, and the projection reconcile drops the
  // ghost. A double-click menu (no source) renders no overlay.
  const displayNodes = useMemo<Node[]>(() => {
    if (menu === null || menu.sourceNodeId === undefined) return flowNodes
    const ghost: Node = {
      id: GHOST_NODE_ID,
      type: 'draft',
      position: { x: menu.flowX, y: menu.flowY },
      data: {},
      draggable: false,
      selectable: false,
      connectable: false,
      // Fixed size so React Flow can initialize the node (and its handle
      // bounds) without waiting on a ResizeObserver tick — the dashed edge
      // then anchors immediately.
      width: 36,
      height: 36,
    }
    return [...flowNodes, ghost]
  }, [flowNodes, menu])

  const displayEdges = useMemo<Edge[]>(() => {
    if (menu === null || menu.sourceNodeId === undefined) return flowEdges
    const dashed: Edge = {
      id: GHOST_EDGE_ID,
      source: menu.sourceNodeId,
      target: GHOST_NODE_ID,
      type: 'default',
      // Dashed line (no `animated` — its CSS animation would fight the static
      // stroke-dasharray); it turns solid once the real node+edge are written.
      style: { strokeDasharray: '6 6' },
    }
    return [...flowEdges, dashed]
  }, [flowEdges, menu])

  // Fire-and-forget write-back: log (not throw) so a transient failure never
  // takes the React tree down; the projection refresh is the reconcile.
  const run = useCallback((op: string, p: Promise<unknown>) => {
    void p.then(() => { setWritebackError(null) }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      console.error(`[ldd-canvas] ${op} failed:`, error)
      setWritebackError(`${op}: ${msg}`)
    })
  }, [])

  const onNodesChange = useCallback((changes: Parameters<typeof applyNodeChanges>[0]) => {
    // React Flow's keyboard delete (Backspace/Delete on a selected node) lands
    // here as a `remove` change — it does NOT go through the × button / edit-bar
    // write-back path. Persist the remove so the projection mirror stays
    // authoritative; otherwise the node only vanishes locally, then resurrects on
    // the next projection refresh (e.g. a moveNode), and its url still trips
    // placeAssets' dedup → the same image can't be dropped back in.
    for (const change of changes) {
      if (change.type === 'remove') run('removeNode', removeNode(change.id))
    }
    setFlowNodes((nds) => applyNodeChanges(changes, nds))
  }, [removeNode, run])

  const onEdgesChange = useCallback((changes: Parameters<typeof applyEdgeChanges>[0]) => {
    setFlowEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  if (canvas === undefined) {
    return <div className="ldd-canvas-empty">画布不可用（canvas 插件未挂载）。</div>
  }

  const onDragStop = (_: unknown, node: Node): void => {
    run('moveNode', moveNode(node.id, node.position.x, node.position.y))
  }

  const onConnect: OnConnect = (connection) => {
    const source = connection.source
    const target = connection.target
    if (source === null || target === null) return
    run('link', link({ source, target }))
  }

  // Start of a dragged connection: remember the source node, so a release on
  // empty canvas can offer "create a node here" wired back to that source.
  const onConnectStart = useCallback((_event: MouseEvent | TouchEvent, params: OnConnectStartParams) => {
    connectSourceRef.current = params.nodeId
  }, [])

  // End of a dragged connection. A valid drop already went through onConnect;
  // an empty-canvas release opens the add-node menu (the dashed ghost edge
  // stays on screen until a menu item is picked).
  const onConnectEnd = useCallback((event: MouseEvent | TouchEvent, connectionState: FinalConnectionState) => {
    const source = connectSourceRef.current
    connectSourceRef.current = null
    if (source === null) return
    if (connectionState.isValid) return
    // MouseEvent carries clientX/Y directly; TouchEvent keeps them under `touches`.
    const point = event instanceof MouseEvent
      ? { x: event.clientX, y: event.clientY }
      : { x: event.touches[0]?.clientX ?? event.changedTouches[0]?.clientX ?? 0, y: event.touches[0]?.clientY ?? event.changedTouches[0]?.clientY ?? 0 }
    const flow = rfRef.current?.screenToFlowPosition({ x: point.x, y: point.y })
    if (flow === undefined) return
    setMenu({ x: point.x, y: point.y, flowX: flow.x, flowY: flow.y, sourceNodeId: source })
  }, [])

  // Double-click empty canvas → open the add-node menu at that spot. A single
  // click just clears selection (and closes the menu). The viewport coordinate
  // maps through the React Flow instance so the node lands under the cursor.
  const onPaneClick = (event: { clientX: number; clientY: number }): void => {
    setNodeMenu(null)
    const now = Date.now()
    const last = lastPaneClick.current
    const near = last !== null && now - last.time < 350
      && Math.hypot(event.clientX - last.x, event.clientY - last.y) < 40
    if (near) {
      lastPaneClick.current = null
      const flow = rfRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
      setMenu({ x: event.clientX, y: event.clientY, flowX: flow?.x ?? 0, flowY: flow?.y ?? 0 })
    } else {
      lastPaneClick.current = { time: now, x: event.clientX, y: event.clientY }
      setMenu(null)
    }
  }

  // Place a new asset node at the double-click / connection-drop spot. For a
  // drag-to-create (a sourceNodeId), mint the id up front and wire the new node
  // to that source in the same breath, so the dashed ghost becomes a solid edge.
  // Await addNode BEFORE link — the write-back is fire-and-forget otherwise and
  // a concurrent link could reach the host before the target node exists.
  const placeAssets = async (assets: CanvasUploadedAsset[], flowX: number, flowY: number, sourceNodeId?: string): Promise<void> => {
    // Dedup by attachment id: a generated image may already be on the canvas
    // (auto-mirror added it when the agent produced it), and re-dropping the
    // same file re-saves the same content-addressed bytes → same attachmentId.
    // Without this, dropping one image twice piles up duplicate cards.
    const seenUrls = new Set<string>()
    for (const node of canvas?.nodes ?? []) {
      if (typeof node.url === 'string' && node.url !== '') seenUrls.add(node.url)
    }
    for (let index = 0; index < assets.length; index += 1) {
      const asset = assets[index]!
      if (asset.attachmentId !== undefined) {
        if (seenUrls.has(asset.attachmentId)) continue
        seenUrls.add(asset.attachmentId)
      }
      const col = index % 3
      const row = Math.floor(index / 3)
      const id = newId()
      const meta = asset.width !== undefined && asset.height !== undefined
        ? {
          width: asset.width,
          height: asset.height,
          ...(asset.mediaType === undefined ? {} : { mediaType: asset.mediaType }),
          ...(asset.bytes === undefined ? {} : { bytes: asset.bytes }),
        }
        : undefined
      try {
        await addNode({
          id, kind: asset.kind, label: asset.name, x: flowX + col * 40, y: flowY + row * 40,
          ...(asset.attachmentId === undefined ? {} : { url: asset.attachmentId }),
          ...(meta === undefined ? {} : { meta }),
        })
        if (sourceNodeId !== undefined && index === 0) await link({ source: sourceNodeId, target: id })
      } catch (error) {
        console.error('[ldd-canvas] upload node failed:', error)
        setWritebackError(`节点落图失败: ${error instanceof Error ? error.message : String(error)}`)
      }
    }
  }

  // Menu-bar upload: open the type-filtered picker, store the files, place the
  // cards at the menu spot. `kind` pre-filters the picker to that media type
  // (the three menu buttons pass image/music/video respectively).
  const uploadAssets = async (kind: 'image' | 'video' | 'music'): Promise<void> => {
    if (menu === null) return
    const { flowX, flowY, sourceNodeId } = menu
    const files = await pickFiles(kind)
    if (files.length === 0) { setMenu(null); return }
    const assets = await uploadFiles(files).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ldd-canvas] upload failed:', error)
      setWritebackError(`上传失败: ${msg}`)
      return []
    })
    await placeAssets(assets, flowX, flowY, sourceNodeId)
    setMenu(null)
  }

  // Drag-to-create downstream: a connection dragged from a node's source handle
  // and released on empty canvas opens the menu; picking 图片/视频 creates a
  // BLANK downstream node (no upload) and wires it to the source with a solid
  // edge — the ComfyUI-style "chain a next step" flow.
  const addDownstream = async (kind: 'image' | 'video'): Promise<void> => {
    if (menu === null || menu.sourceNodeId === undefined) return
    const { flowX, flowY, sourceNodeId } = menu
    const id = newId()
    const label = kind === 'image' ? '图片' : '视频'
    try {
      await addNode({ id, kind, label, x: flowX, y: flowY })
      await link({ source: sourceNodeId, target: id })
      setWritebackError(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ldd-canvas] add downstream failed:', error)
      setWritebackError(`创建节点失败: ${msg}`)
    }
    setMenu(null)
  }

  // Drag-and-drop upload: files dropped on the canvas become cards at the drop
  // spot (images store + render; video/audio write to the workspace).
  const onCanvasDrop = async (event: ReactDragEvent<HTMLDivElement>): Promise<void> => {
    event.preventDefault()
    // stopPropagation is REQUIRED: the composer (conversation input) registers
    // document-level dragenter/dragover/drop listeners that would otherwise also
    // consume the same drop and add the files to the input attachment rail
    // instead of the canvas. Keeping the drop from bubbling to document means
    // the canvas owns files dropped over it.
    event.stopPropagation()
    const files = Array.from(event.dataTransfer?.files ?? [])
    if (files.length === 0) return
    const flow = rfRef.current?.screenToFlowPosition({ x: event.clientX, y: event.clientY })
    const assets = await uploadFiles(files).catch((error: unknown) => {
      console.error('[ldd-canvas] upload failed:', error)
      setWritebackError(`上传失败: ${error instanceof Error ? error.message : String(error)}`)
      return []
    })
    await placeAssets(assets, flow?.x ?? 0, flow?.y ?? 0)
  }

  const onCanvasDragOver = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    // Same reason as onDrop: don't let the composer's document-level dragover
    // (which flips its dropEffect and shows the global drop overlay) override
    // the canvas's own handling.
    event.stopPropagation()
    if (event.dataTransfer !== null) event.dataTransfer.dropEffect = 'copy'
  }

  // dragenter/dragleave MUST also stopPropagation. The composer (conversation
  // input) tracks a document-level dragenter/dragleave depth to show its
  // full-screen DropOverlay. Without these, dragging a file over the canvas
  // fires the composer's dragenter (overlay pops up), then onCanvasDrop's
  // stopPropagation swallows the composer's drop — so its depth never resets,
  // the drop source is the external file manager (no dragend in this window),
  // and the overlay sticks forever, blocking the canvas. Stopping the enter/
  // leave here keeps the canvas an isolated drop zone: the overlay only ever
  // appears when files are dragged over the composer area itself.
  const onCanvasDragEnter = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  const onCanvasDragLeave = (event: ReactDragEvent<HTMLDivElement>): void => {
    event.preventDefault()
    event.stopPropagation()
  }

  // The canvas's own agent composer — flush into the real conversation composer
  // (setDraft + submit), sharing its exact draft and send path.
  const doComposeSubmit = (): void => {
    const text = composeText.trim()
    if (text === '' && composeFiles.length === 0) return
    try {
      if (composeFiles.length > 0) {
        compose.attachImages(composeFiles)
        setComposeFiles([])
      }
      if (text !== '') compose.setDraft(text)
      compose.submit()
      setComposeText('')
      setWritebackError(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setWritebackError(`发送失败: ${msg}`)
    }
  }

  const pickComposeImages = async (): Promise<void> => {
    const files = await pickFiles('image').catch(() => [] as File[])
    if (files.length > 0) setComposeFiles((prev) => [...prev, ...files])
  }

  const onComposeKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      doComposeSubmit()
    }
  }

  // Load the generation-model dropdown options (and the current selection) from
  // the injected face. Re-read on open so a settings change or an external
  // `/generate-model` pick is reflected.
  const refreshModels = useCallback(() => {
    const opts = models.list()
    setModelOptions(opts)
    const sel = opts.find((o) => o.selected) ?? opts[0]
    if (sel !== undefined) setSelectedModel(sel.key)
  }, [models])

  useEffect(() => { refreshModels() }, [refreshModels])

  const actions = useMemo(() => ({
    removeNode: (nodeId: string) => {
      run('removeNode', removeNode(nodeId))
    },
  }), [removeNode, run])

  // Right-click a node → context menu (删除 / 复制 / 添加至输入框). The browser's
  // native context menu is suppressed so our menu owns the right-click.
  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node): void => {
    event.preventDefault()
    setMenu(null)
    setNodeMenu({ x: event.clientX, y: event.clientY, nodeId: node.id })
  }, [])

  // Delete a node from the context menu (same write-back as the × button).
  const deleteNodeById = (nodeId: string): void => {
    run('removeNode', removeNode(nodeId))
    setNodeMenu(null)
  }

  // Copy a node to the SYSTEM clipboard (image → bitmap, text/note → text), so
  // it can be pasted into any other input box / app.
  const copyNode = (nodeId: string): void => {
    const node: CanvasNode | undefined = canvas?.nodes.find((n: CanvasNode) => n.id === nodeId)
    if (node === undefined) return
    setNodeMenu(null)
    void copyNodeToClipboard(node).then(() => {
      setWritebackError(null)
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      setWritebackError(`复制失败: ${msg}`)
    })
  }

  // Put a node into the agent composer input box (image → thumbnail attachment,
  // text/note → draft text; media → `[类型] 标题`), without sending.
  const handleAddToInput = (nodeId: string): void => {
    const node: CanvasNode | undefined = canvas?.nodes.find((n: CanvasNode) => n.id === nodeId)
    if (node === undefined) return
    setNodeMenu(null)
    void addNodeToInput(node).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      setWritebackError(`添加到输入框失败: ${msg}`)
    })
  }

  return (
    <LoadImageContext.Provider value={loadImage}>
      <CanvasActionsContext.Provider value={actions}>
        <div
          className="ldd-canvas-root"
          ref={rootRef}
          onDragEnter={onCanvasDragEnter}
          onDragOver={onCanvasDragOver}
          onDragLeave={onCanvasDragLeave}
          onDrop={(event) => { void onCanvasDrop(event) }}
        >
          <ReactFlow
            nodes={displayNodes}
            edges={displayEdges}
            nodeTypes={nodeTypes}
            onInit={(rf) => { rfRef.current = rf }}
            onNodesChange={onNodesChange}
            onEdgesChange={onEdgesChange}
            onNodeDragStop={onDragStop}
            onConnect={onConnect}
            onConnectStart={onConnectStart}
            onConnectEnd={onConnectEnd}
            onNodeContextMenu={onNodeContextMenu}
            // Wider connection hit radius: a link can start anywhere within this
            // many screen px of a handle, so the user need not land dead-center.
            connectionRadius={36}
            // Right-button drag pans the canvas; left-button drag on empty canvas
            // box-selects (normal pointer, not the grab hand), and left-dragging a
            // selected node moves the whole selection.
            panOnDrag={[2]}
            selectionOnDrag
            selectionMode={SelectionMode.Full}
            onNodeClick={() => {
              setMenu(null)
              setNodeMenu(null)
            }}
            onPaneClick={onPaneClick}
            fitView
            proOptions={{ hideAttribution: true }}
          >
            <MiniMap />
            <Controls />
            <Background />
          </ReactFlow>

          {writebackError !== null && (
            <div
              className="ldd-canvas-error"
              style={{
                position: 'absolute', top: 8, left: 8, right: 8, zIndex: 20,
                background: '#b3261e', color: '#fff', borderRadius: 8,
                padding: '8px 12px', fontSize: 12, lineHeight: 1.4,
                display: 'flex', alignItems: 'center', gap: 8,
                boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
              }}
            >
              <span style={{ flex: 1, wordBreak: 'break-all' }}>画布写回失败：{writebackError}</span>
              <button
                type="button"
                onClick={() => setWritebackError(null)}
                style={{ background: 'transparent', border: 'none', color: '#fff', cursor: 'pointer', fontSize: 16, lineHeight: 1 }}
              >
                ×
              </button>
            </div>
          )}

          {canvas.nodes.length === 0 && (
            <div className="ldd-canvas-empty-hint">
              画布为空。双击画布上传图片/音频/视频，或在对话中让智能体往画布添加内容。
            </div>
          )}

          {menu !== null && (
            <div className="ldd-canvas-menu" style={{ left: menu.x, top: menu.y }}>
              {menu.sourceNodeId === undefined
                ? (
                  <>
                    <button type="button" onClick={() => { void uploadAssets('image') }}>上传图片</button>
                    <button type="button" onClick={() => { void uploadAssets('music') }}>上传音频</button>
                    <button type="button" onClick={() => { void uploadAssets('video') }}>上传视频</button>
                  </>
                )
                : (
                  <>
                    <button type="button" onClick={() => { void addDownstream('image') }}>图片</button>
                    <button type="button" onClick={() => { void addDownstream('video') }}>视频</button>
                  </>
                )}
            </div>
          )}

          {nodeMenu !== null && (
            <div className="ldd-canvas-menu ldd-canvas-node-menu" style={{ left: nodeMenu.x, top: nodeMenu.y }}>
              <button type="button" onClick={() => { deleteNodeById(nodeMenu.nodeId) }}>删除</button>
              <button type="button" onClick={() => { copyNode(nodeMenu.nodeId) }}>复制</button>
              <button type="button" onClick={() => { handleAddToInput(nodeMenu.nodeId) }}>添加至输入框</button>
            </div>
          )}

          {/* Persistent agent composer dock — the canvas's own input box, wired
              to the real conversation composer so typing here = typing in the
              conversation. Lets the user work fullscreen without the chat. */}
          <div className="ldd-canvas-composer">
            {modelOptions.length > 0 && (
              <div className="ldd-canvas-composer-toolbar">
                <span className="ldd-canvas-composer-model-label">生图模型</span>
                <select
                  className="ldd-canvas-composer-model"
                  value={selectedModel}
                  onFocus={refreshModels}
                  onChange={(event) => {
                    const key = event.target.value
                    setSelectedModel(key)
                    models.select(key)
                  }}
                >
                  {modelOptions.map((m) => (
                    <option key={m.key} value={m.key}>{m.label}</option>
                  ))}
                </select>
              </div>
            )}
            {composeFiles.length > 0 && (
              <div className="ldd-canvas-composer-attachments">
                {composeFiles.map((file, index) => (
                  <span key={index} className="ldd-canvas-composer-chip" title={file.name}>
                    {file.name}
                    <button
                      type="button"
                      className="ldd-canvas-composer-chip-remove"
                      aria-label={`移除 ${file.name}`}
                      onClick={() => setComposeFiles((prev) => prev.filter((_, i) => i !== index))}
                    >
                      ×
                    </button>
                  </span>
                ))}
              </div>
            )}
            <div className="ldd-canvas-composer-row">
              <button
                type="button"
                className="ldd-canvas-composer-attach"
                title="添加图片"
                aria-label="添加图片"
                onClick={() => { void pickComposeImages() }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M8 3.5v9M3.5 8h9" />
                </svg>
              </button>
              <textarea
                className="ldd-canvas-composer-input"
                value={composeText}
                onChange={(event) => setComposeText(event.target.value)}
                onKeyDown={onComposeKeyDown}
                placeholder="给 agent 发送消息…（Enter 发送，Shift+Enter 换行）"
                rows={1}
              />
              <button
                type="button"
                className="ldd-canvas-composer-send"
                onClick={doComposeSubmit}
                disabled={composeText.trim() === '' && composeFiles.length === 0}
              >
                发送
              </button>
            </div>
          </div>
        </div>
      </CanvasActionsContext.Provider>
    </LoadImageContext.Provider>
  )
}
