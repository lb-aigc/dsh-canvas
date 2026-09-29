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
import { createPortal } from 'react-dom'
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
import type { CanvasEdge, CanvasImageVariant, CanvasNode, CanvasState, JsonValue } from '../model.ts'
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
  /** Remove one edge (a deliberate disconnect by double-clicking the wire). */
  unlink(edgeId: string): Promise<CanvasState>
  /** Promote one variant of a multi-variant image node to primary (surface). */
  setPrimaryVariant(nodeId: string, variantIndex: number): Promise<CanvasState>
}

/** One mirrored composer attachment (image → previewUrl, file → name only). */
export interface CanvasComposerAttachment {
  id: string
  kind: 'image' | 'file'
  name: string
  previewUrl?: string
}

/** The mirrored slice of the conversation composer the canvas input box shows:
 *  the SAME draft, attachments, reference chips, and phase as the real composer,
 *  so both views always agree and sending fires exactly one message. */
export interface CanvasComposerSnapshot {
  draft: string
  attachments: readonly CanvasComposerAttachment[]
  occurrences: readonly string[]
  phase: 'plain' | 'adjudicating' | 'claimed' | 'submitting'
  queueCount: number
}

/** Live agent-composer face: the canvas's own bottom input box is a FULL view of
 *  the real conversation composer — same draft, same send path, same attachments
 *  (bidirectionally synced via subscribe/getSnapshot). */
export interface CanvasComposer {
  /** Read the current mirrored composer state. */
  getSnapshot(): CanvasComposerSnapshot
  /** Subscribe to composer-state changes (returns an unsubscribe). */
  subscribe(cb: () => void): () => void
  /** Replace the conversation draft (persisted to the real composer). */
  setDraft(text: string): void
  /** Register files as real composer attachments (image → thumbnail, other → file). */
  attachFiles(files: File[]): boolean
  /** Remove one composer attachment. */
  removeAttachment(id: string): boolean
  /** Send the current draft + attachments through the normal composer path. */
  submit(): void
}

/** One selectable generation model in the canvas composer's dropdown. */
export interface CanvasModelOption {
  key: string
  label: string
  selected: boolean
}

/** A generation modality the composer can switch models for. */
export type CanvasGenKind = 'image' | 'video' | 'music'

/** Generation-model switch face (drives the `/generate-model` slash command). */
export interface CanvasModels {
  /** The configured models for one modality's dropdown. */
  list(kind: CanvasGenKind): CanvasModelOption[]
  /** Temporarily switch one modality's model (does not change the default). */
  select(kind: CanvasGenKind, key: string): void
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
  /** Save an image node's bytes to disk (native save dialog). */
  downloadNodeImage: (node: CanvasNode) => Promise<void>
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
  /** Injected image download (native save dialog). */
  downloadNodeImage: CanvasViewInjected['downloadNodeImage']
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
  unlink: CanvasWriteback['unlink']
  setPrimaryVariant: CanvasWriteback['setPrimaryVariant']
}

const LoadImageContext = createContext<(ref: CanvasReadAssetRequest) => Promise<string>>(
  async () => { throw new Error('canvas: no image loader injected') },
)

/** Write-back actions reachable from deep inside a node card (the delete button). */
const CanvasActionsContext = createContext<{ removeNode: (nodeId: string) => void; downloadNodeImage: (node: CanvasNode) => void; setPrimaryVariant: (nodeId: string, variantIndex: number) => void }>({
  removeNode: () => {},
  downloadNodeImage: () => {},
  setPrimaryVariant: () => {},
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
  variants?: CanvasImageVariant[]
  primaryIndex?: number
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

/** One image card inside a multi-variant node's expanded grid: loads the
 *  variant's thumbnail through the canvas read channel and carries a
 *  "设为主图" action (the primary variant shows a "主图" badge instead). */
function VariantGridItem({ variant, index, isPrimary, onSetPrimary }: {
  variant: CanvasImageVariant
  index: number
  isPrimary: boolean
  onSetPrimary: (index: number) => void
}) {
  const loadImage = useContext(LoadImageContext)
  const [src, setSrc] = useState<string | null>(null)
  useEffect(() => {
    const mediaType = variant.mediaType
    const bytes = variant.bytes
    const width = variant.width
    const height = variant.height
    if (mediaType === undefined || bytes === undefined || width === undefined || height === undefined) {
      setSrc(null)
      return
    }
    let cancelled = false
    loadImage({ attachmentId: variant.attachmentId, mediaType, bytes, width, height })
      .then((url) => { if (!cancelled) setSrc(url) })
      .catch(() => { if (!cancelled) setSrc(null) })
    return () => { cancelled = true }
  }, [variant, loadImage])
  // Keep each variant at its own aspect ratio so the expanded grid shows the
  // FULL frame (no square crop); the container reserves that ratio pre-load so
  // the grid doesn't reflow once the image arrives.
  const w = typeof variant.width === 'number' && variant.width > 0 ? variant.width : undefined
  const h = typeof variant.height === 'number' && variant.height > 0 ? variant.height : undefined
  const ratio = w !== undefined && h !== undefined ? `${w} / ${h}` : '1 / 1'
  return (
    <div className="ldd-canvas-image-grid-item">
      {src !== null
        ? <img className="ldd-canvas-image-grid-img" src={src} alt={`变体 ${index + 1}`} style={{ aspectRatio: ratio }} />
        : <div className="ldd-canvas-image-grid-placeholder" style={{ aspectRatio: ratio }}>{kindIcon('image')}</div>}
      <button
        type="button"
        className={isPrimary ? 'ldd-canvas-image-set-primary ldd-canvas-image-set-primary--active nodrag' : 'ldd-canvas-image-set-primary nodrag'}
        onClick={(event) => { event.stopPropagation(); onSetPrimary(index) }}
      >
        {isPrimary ? '主图' : '设为主图'}
      </button>
    </div>
  )
}

/** One node card: a head row (kind glyph + caption + meta fact) over a kind body. */
function CanvasNodeCard({ id, data }: { id: string; data: CanvasNodeData }) {
  const loadImage = useContext(LoadImageContext)
  const { downloadNodeImage, setPrimaryVariant } = useContext(CanvasActionsContext)
  const [resolved, setResolved] = useState<string | null>(null)
  const [previewOpen, setPreviewOpen] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const sha = isShaAttachment(data.url)
  const fact = metaText(data.kind, data.meta)
  // A pending node is the pre-drawn blank card awaiting a generated image
  // (host auto-mirror hangs one per submit); it renders a "生成中…" treatment
  // until the generated result fills it in place.
  const isPending = data.meta?.pending === true
  // A multi-variant node collapses N generated images into one card: a primary
  // surface image + an expandable grid of siblings. Single-image nodes keep the
  // plain `url` shape (no variants array, or a one-element one).
  const variants = data.variants ?? []
  const isMulti = data.kind === 'image' && variants.length > 1
  const primaryIndex = typeof data.primaryIndex === 'number' && data.primaryIndex >= 0 ? data.primaryIndex : 0

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

  // A resolved image node renders borderless (image fills the card) with
  // hover-revealed preview/download actions; everything else keeps the
  // three-part card (head / body / label).
  const isImage = data.kind === 'image' && src !== null
  const fullNode = (): CanvasNode => ({
    id,
    kind: data.kind,
    label: data.label,
    x: 0,
    y: 0,
    ...(data.content !== undefined ? { content: data.content } : {}),
    ...(data.url !== undefined ? { url: data.url } : {}),
    ...(data.meta !== undefined ? { meta: data.meta } : {}),
  })

  // Promote a variant to the surface image, then collapse back to the stack
  // (the reference / download / copy channels all follow `url`, so the surface
  // image is the one a downstream edge resolves to).
  const handleSetPrimary = (variantIndex: number): void => {
    setPrimaryVariant(id, variantIndex)
    setExpanded(false)
  }

  // Hover-revealed preview/download actions, shared by single-image and
  // multi-variant (stacked) surfaces.
  const imageActions = (
    <div className="ldd-canvas-node-image-actions nodrag">
      <button
        type="button"
        title="预览"
        aria-label={`预览「${data.label}」`}
        onClick={() => { setPreviewOpen(true) }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="M1.5 8s2.4-4.5 6.5-4.5S14.5 8 14.5 8 12.1 12.5 8 12.5 1.5 8 1.5 8z" />
          <circle cx="8" cy="8" r="2" />
        </svg>
      </button>
      <button
        type="button"
        title="下载"
        aria-label={`下载「${data.label}」`}
        onClick={() => {
          downloadNodeImage(fullNode())
        }}
      >
        <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
          <path d="M8 2.5v7M5 6.5l3 3 3-3M3 12.5h10" />
        </svg>
      </button>
    </div>
  )

  return (
    <>
    <div className={isImage ? 'ldd-canvas-node ldd-canvas-node--image' : 'ldd-canvas-node'} data-kind={data.kind}>

      {isImage
        ? (
          isMulti
            ? (
              expanded
                ? (
                  <div className="ldd-canvas-image-grid nodrag">
                    <div className="ldd-canvas-image-grid-head">
                      <span className="ldd-canvas-image-grid-title">{variants.length} 张变体</span>
                      <button type="button" className="ldd-canvas-image-count" title="收起" onClick={() => setExpanded(false)}>
                        {variants.length}
                        <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false"><path d="M3 10l5-5 5 5" /></svg>
                      </button>
                    </div>
                    <div className="ldd-canvas-image-grid-body">
                      {variants.map((v, i) => (
                        <VariantGridItem
                          key={v.attachmentId}
                          variant={v}
                          index={i}
                          isPrimary={i === primaryIndex}
                          onSetPrimary={handleSetPrimary}
                        />
                      ))}
                    </div>
                  </div>
                )
                : (
                  <div className="ldd-canvas-image-stack">
                    <div className="ldd-canvas-image-stack-layers" aria-hidden="true">
                      <span style={{ width: displayW, height: displayH }} />
                      <span style={{ width: displayW, height: displayH }} />
                    </div>
                    <img
                      className="ldd-canvas-node-image ldd-canvas-node-image--full"
                      src={src}
                      alt={data.label}
                      style={{ width: displayW, height: displayH }}
                    />
                    <button type="button" className="ldd-canvas-image-count nodrag" title={`${variants.length} 张变体，点击展开`} onClick={() => setExpanded(true)}>
                      {variants.length}
                      <svg viewBox="0 0 16 16" width="10" height="10" aria-hidden="true" focusable="false"><path d="M3 6l5 5 5-5" /></svg>
                    </button>
                    {imageActions}
                  </div>
                )
            )
            : (
              <>
                <img
                  className="ldd-canvas-node-image ldd-canvas-node-image--full"
                  src={src}
                  alt={data.label}
                  style={{ width: displayW, height: displayH }}
                />
                {imageActions}
              </>
            )
        )
        : (
          <>
            <div className="ldd-canvas-node-head">
              <span className="ldd-canvas-node-kind">{kindIcon(data.kind)}<span>{KIND_LABEL[data.kind]}</span></span>
              {fact !== undefined && <span className="ldd-canvas-node-fact">{fact}</span>}
            </div>

            {data.kind === 'image' && (
              <div
                className={isPending ? 'ldd-canvas-node-image ldd-canvas-image-placeholder ldd-canvas-image-pending' : 'ldd-canvas-node-image ldd-canvas-image-placeholder'}
                style={{ width: 240, height: 180 }}
              >
                {isPending
                  ? <><span className="ldd-canvas-pending-spinner" aria-hidden="true" />生成中…</>
                  : <>{kindIcon('image')}图片</>}
              </div>
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
          </>
        )}
    </div>
    {previewOpen && isImage && createPortal(
      <div className="ldd-canvas-lightbox" role="dialog" aria-modal="true" aria-label={`预览「${data.label}」`} onClick={() => { setPreviewOpen(false) }}>
        <img className="ldd-canvas-lightbox-image" src={src} alt={data.label} onClick={(event) => { event.stopPropagation() }} />
        <button type="button" className="ldd-canvas-lightbox-close" aria-label="关闭预览" onClick={() => { setPreviewOpen(false) }}>×</button>
      </div>,
      document.body,
    )}
    {/* Connection ports float OUTSIDE the card frame (siblings, not children),
        so the card's rounded-corner `overflow: hidden` clip can't cut them off;
        they sit a gap away from the side, ComfyUI-style. */}
    <Handle type="target" position={Position.Left} className="ldd-canvas-handle">
      <span className="ldd-canvas-handle-ring">
        <svg className="ldd-canvas-handle-plus" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </span>
    </Handle>
    <Handle type="source" position={Position.Right} className="ldd-canvas-handle">
      <span className="ldd-canvas-handle-ring">
        <svg className="ldd-canvas-handle-plus" viewBox="0 0 16 16" aria-hidden="true" focusable="false">
          <path d="M8 3.5v9M3.5 8h9" />
        </svg>
      </span>
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
    data: { label: n.label, kind: n.kind, content: n.content, url: n.url, variants: n.variants, primaryIndex: n.primaryIndex, meta: n.meta },
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

export function CanvasView({ useProjection, loadImage, addNodeToInput, copyNodeToClipboard, downloadNodeImage, models, compose, pickFiles, uploadFiles, addNode, removeNode, updateNode, moveNode, link, unlink, setPrimaryVariant }: CanvasViewProps) {
  const canvas = useProjection('canvas')

  // Local, RESPONSIVE flow state: the projection is the authoritative mirror,
  // but dragging must feel immediate, so React Flow's `applyNodeChanges` mutates
  // a local copy on every drag frame; the projection refresh reconciles it.
  const [flowNodes, setFlowNodes] = useState<Node[]>([])
  const [flowEdges, setFlowEdges] = useState<Edge[]>([])

  // The canvas's own agent composer mirrors the real conversation composer's
  // ATTACHMENTS + reference chips live (they don't steal focus). The DRAFT TEXT
  // is a local buffer: typing here only updates the local state, NOT the
  // underlying Lexical editor — because SessionInput.setDraft() runs
  // `root.clear() + root.selectEnd()`, which yanks the DOM focus into the
  // conversation composer on every keystroke. The local draft is flushed into
  // the real composer only on submit (and mirrored back only when the canvas
  // textarea is NOT focused, so conversation-side typing still reaches it).
  const [composerSnap, setComposerSnap] = useState<CanvasComposerSnapshot>(() => compose.getSnapshot())
  const [localDraft, setLocalDraft] = useState<string>(() => compose.getSnapshot().draft)
  const composerFocusedRef = useRef(false)
  useEffect(() => {
    const sync = (): void => {
      const next = compose.getSnapshot()
      setComposerSnap(next)
      if (!composerFocusedRef.current) setLocalDraft(next.draft)
    }
    sync()
    return compose.subscribe(sync)
  }, [compose])
  // Per-modality model dropdown state (re-read from the face on open; holds the
  // picked value for each controlled <select>).
  const [modelOptions, setModelOptions] = useState<Record<CanvasGenKind, CanvasModelOption[]>>({ image: [], video: [], music: [] })
  const [selectedModels, setSelectedModels] = useState<Record<CanvasGenKind, string>>({ image: '', video: '', music: '' })
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
  // `imageIds` carries every currently-selected image node when the right-click
  // lands on a multi-selected group, so "添加至输入框" can batch-add them all.
  const [nodeMenu, setNodeMenu] = useState<{ x: number; y: number; nodeId: string; imageIds: string[] } | null>(null)
  // Optimistic edge targets: nodes whose solid link is still in-flight (the
  // node is written, the edge not yet confirmed by the Host). The reconcile
  // below keeps their optimistic edge until the authoritative state connects them.
  const pendingLinkTargets = useRef<Set<string>>(new Set())
  // Source→target pairs whose link write-back is currently in flight. Guards
  // against a re-connect (or the optimistic edge + authoritative edge racing)
  // double-mirroring the source image into the composer. Keyed synchronously via
  // a ref — a setState updater runs deferred, so it can't gate this reliably.
  const linkingPairs = useRef<Set<string>>(new Set())
  // Live selected-node ids, fed by React Flow's onSelectionChange. The context
  // menu reads this (not rfRef.getNodes()) — getNodes() returns the store
  // snapshot whose `selected` flag can lag one frame behind a box-select, which
  // made the batch "添加 N 张图片" menu miss its targets.
  const selectedNodeIdsRef = useRef<Set<string>>(new Set())
  // Nodes deleted locally whose removeNode write-back is still in flight. The
  // projection reconcile must NOT resurrect them while the Host is catching up
  // (that resurrection is the "press Backspace several times to delete" bug).
  const pendingRemovalsRef = useRef<Set<string>>(new Set())
  // Undo stack for accidental deletions: each entry snapshots the node(s) and
  // their touching edges at delete time, so Ctrl+Z restores them (addNode back,
  // then re-link the edges). Pushed on every delete entry-point; Ctrl+Z pops
  // the most recent one.
  const undoStack = useRef<Array<{ nodes: CanvasNode[]; edges: CanvasEdge[] }>>([])
  // Latest projection, for the undo/delete capture (which runs inside
  // useCallback closures that would otherwise hold a stale `canvas`).
  const canvasRef = useRef<CanvasState | undefined>(undefined)

  // Reconcile local flow state from the projection (authoritative) on every change.
  useEffect(() => {
    if (canvas !== undefined) {
      canvasRef.current = canvas
      const removals = pendingRemovalsRef.current
      setFlowNodes(toFlowNodes(canvas).filter((n) => !removals.has(n.id)))
      setFlowEdges((prev) => {
        const authoritative = toFlowEdges(canvas)
        const confirmed = new Set(authoritative.map((e) => e.target))
        // Keep optimistic edges whose link is still in-flight: the target node
        // exists but the Host has not written the edge yet. Once the authority
        // connects that target, the optimistic edge is dropped for the real one.
        const optimistic = prev.filter((e) => pendingLinkTargets.current.has(e.target) && !confirmed.has(e.target))
        return [...authoritative, ...optimistic]
      })
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

  // Snapshot the given node ids (+ their touching edges) onto the undo stack
  // BEFORE they are deleted, so Ctrl+Z can restore them. Reads the latest
  // projection via canvasRef (safe from useCallback stale-closure).
  const captureUndo = useCallback((nodeIds: Set<string>): void => {
    const state = canvasRef.current
    if (state === undefined || nodeIds.size === 0) return
    const nodes = state.nodes.filter((n: CanvasNode) => nodeIds.has(n.id))
    if (nodes.length === 0) return
    const edges = state.edges.filter((e: CanvasEdge) => nodeIds.has(e.source) || nodeIds.has(e.target))
    undoStack.current.push({ nodes, edges })
    // Bound the stack so a long editing session can't grow it unboundedly.
    if (undoStack.current.length > 100) undoStack.current.shift()
  }, [])

  // Restore the most recent deletion: addNode each captured node back (with its
  // original id), then re-link the captured edges. Fire-and-forget; the
  // projection refresh reconciles (and a failure surfaces in the error banner).
  const undoDelete = useCallback((): void => {
    const item = undoStack.current.pop()
    if (item === undefined) return
    void (async () => {
      try {
        for (const node of item.nodes) {
          await addNode({
            id: node.id,
            kind: node.kind,
            label: node.label,
            x: node.x,
            y: node.y,
            ...(node.content === undefined ? {} : { content: node.content }),
            ...(node.url === undefined ? {} : { url: node.url }),
            ...(node.variants === undefined ? {} : { variants: node.variants }),
            ...(node.primaryIndex === undefined ? {} : { primaryIndex: node.primaryIndex }),
            ...(node.meta === undefined ? {} : { meta: node.meta }),
          })
        }
        for (const edge of item.edges) {
          await link({ source: edge.source, target: edge.target, ...(edge.label === undefined || edge.label === '' ? {} : { label: edge.label }) }).catch(() => {})
        }
        setWritebackError(null)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[ldd-canvas] undo delete failed:', error)
        setWritebackError(`撤销删除失败: ${msg}`)
      }
    })()
  }, [addNode, link])

  // Ctrl/Cmd+Z restores the most recent deletion, but only when the keyboard
  // focus is NOT in a text field (the composer textarea / contenteditable owns
  // its own text undo there). Reads document.activeElement to disambiguate.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && (event.key === 'z' || event.key === 'Z')) {
        const active = document.activeElement
        const tag = active === null ? '' : (active.tagName ?? '').toLowerCase()
        const editable = tag === 'textarea' || tag === 'input' || (active as HTMLElement | null)?.isContentEditable === true
        if (editable) return
        event.preventDefault()
        undoDelete()
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [undoDelete])

  const onNodesChange = useCallback((changes: Parameters<typeof applyNodeChanges>[0]) => {
    // React Flow's keyboard delete (Backspace/Delete on a selected node) lands
    // here as a `remove` change — it does NOT go through the × button / edit-bar
    // write-back path. Persist the remove so the projection mirror stays
    // authoritative; otherwise the node only vanishes locally, then resurrects on
    // the next projection refresh (e.g. a moveNode), and its url still trips
    // placeAssets' dedup → the same image can't be dropped back in.
    const removeIds = new Set<string>()
    for (const change of changes) {
      if (change.type === 'remove') removeIds.add(change.id)
    }
    if (removeIds.size > 0) {
      // Snapshot for Ctrl+Z BEFORE the delete lands.
      captureUndo(removeIds)
      for (const id of removeIds) {
        // Mark it in-flight so the projection reconcile (which can fire from an
        // unrelated Host append BEFORE this removeNode lands) does not resurrect
        // the node mid-delete — that round-trip lag is the "delete has delay and
        // needs several Backspace presses" symptom.
        pendingRemovalsRef.current.add(id)
        void removeNode(id)
          .catch((error: unknown) => {
            const msg = error instanceof Error ? error.message : String(error)
            console.error('[ldd-canvas] removeNode failed:', error)
            setWritebackError(`removeNode: ${msg}`)
          })
          .finally(() => { pendingRemovalsRef.current.delete(id) })
      }
    }
    setFlowNodes((nds) => applyNodeChanges(changes, nds))
  }, [removeNode, captureUndo])

  const onEdgesChange = useCallback((changes: Parameters<typeof applyEdgeChanges>[0]) => {
    setFlowEdges((eds) => applyEdgeChanges(changes, eds))
  }, [])

  // Double-click a wire → deliberate disconnect. Remove the edge locally for
  // instant feedback and persist the unlink (the projection refresh reconciles
  // the authoritative state). This pairs with `edgesReconnectable`/`edgesFocusable`
  // left at their defaults so hovering a wire shows the "cut" (scissors) affordance.
  const onEdgeDoubleClick = useCallback((_event: ReactMouseEvent, edge: Edge): void => {
    setFlowEdges((eds) => eds.filter((e) => e.id !== edge.id))
    run('unlink', unlink(edge.id))
  }, [unlink, run])

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
    const pairKey = `${source}->${target}`
    // Guard synchronously (a setState updater runs deferred, so it can't gate
    // this): a re-connect of an already-linked pair must not double-mirror the
    // source image into the composer.
    if (linkingPairs.current.has(pairKey)) return
    linkingPairs.current.add(pairKey)
    // Optimistic edge: paint the wire IMMEDIATELY, then persist. Without this the
    // edge only appears after the Host writes back and the projection refreshes —
    // the multi-second lag the user noticed. The pending-target set keeps this
    // local edge alive until the authoritative state confirms it (reconcile below).
    const optimisticId = `opt-${source}-${target}`
    setFlowEdges((eds) => {
      if (eds.some((e) => e.source === source && e.target === target)) return eds
      return [...eds, { id: optimisticId, source, target, type: 'default' }]
    })
    pendingLinkTargets.current.add(target)
    void link({ source, target }).then(() => {
      linkingPairs.current.delete(pairKey)
      pendingLinkTargets.current.delete(target)
      setWritebackError(null)
    }).catch((error: unknown) => {
      linkingPairs.current.delete(pairKey)
      pendingLinkTargets.current.delete(target)
      setFlowEdges((eds) => eds.filter((e) => e.id !== optimisticId))
      const msg = error instanceof Error ? error.message : String(error)
      console.error('[ldd-canvas] link failed:', error)
      setWritebackError(`连接失败: ${msg}`)
    })
    // Manually wiring an image node into a downstream card is an explicit
    // "use this as a reference" gesture. Mirror it into the composer input as a
    // reference attachment, so the user does not have to right-click each source
    // and pick 添加至输入框 one by one — the chain already says what to do.
    const sourceNode = canvas?.nodes.find((n: CanvasNode) => n.id === source)
    if (sourceNode !== undefined && sourceNode.kind === 'image') {
      void addNodeToInput(sourceNode)
    }
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
  const addDownstream = (kind: 'image' | 'video'): void => {
    if (menu === null || menu.sourceNodeId === undefined) return
    const { flowX, flowY, sourceNodeId } = menu
    const id = newId()
    const label = kind === 'image' ? '图片' : '视频'
    // Mirror the source into the composer as a reference — creating a blank
    // downstream node off an image is the same explicit "use this as reference"
    // gesture as wiring directly to one, and it's the root cause behind "only
    // the LAST wired image lands in the input" (the first image was wired here,
    // during node creation, where the mirror was missing).
    const sourceNode = canvas?.nodes.find((n: CanvasNode) => n.id === sourceNodeId)
    if (sourceNode !== undefined && sourceNode.kind === 'image') {
      void addNodeToInput(sourceNode).then(() => {
        setComposerSnap(compose.getSnapshot())
      }).catch((error: unknown) => {
        const msg = error instanceof Error ? error.message : String(error)
        setWritebackError(`添加到输入框失败: ${msg}`)
      })
    }
    // Optimistic: close the menu + dashed ghost IMMEDIATELY and paint the node
    // + solid edge on the very next frame. The two write-backs each round-trip
    // to the Host (~1s combined); awaiting them before clearing the menu is
    // exactly the lag the user sees. The projection refresh reconciles after.
    setMenu(null)
    setFlowNodes((nds) => [...nds, {
      id,
      type: kind,
      position: { x: flowX, y: flowY },
      data: { label, kind },
    }])
    setFlowEdges((eds) => [...eds, {
      id: `opt-${id}`,
      source: sourceNodeId,
      target: id,
      type: 'default',
    }])
    pendingLinkTargets.current.add(id)
    // Persist in order (the target node must exist before the edge lands).
    void (async () => {
      try {
        await addNode({ id, kind, label, x: flowX, y: flowY })
        await link({ source: sourceNodeId, target: id })
        pendingLinkTargets.current.delete(id)
        setWritebackError(null)
      } catch (error) {
        pendingLinkTargets.current.delete(id)
        // Roll back the optimistic node + edge: the write never landed, so the
        // local-only draft must not linger (the projection refresh won't have it).
        setFlowNodes((nds) => nds.filter((n) => n.id !== id))
        setFlowEdges((eds) => eds.filter((e) => e.target !== id))
        const msg = error instanceof Error ? error.message : String(error)
        console.error('[ldd-canvas] add downstream failed:', error)
        setWritebackError(`创建节点失败: ${msg}`)
      }
    })()
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

  // The canvas's own agent composer — flush the LOCAL draft into the real
  // composer, then submit that exact single message. (Attachments already live
  // in the underlying SessionInput via addNodeToInput / attachFiles.)
  const doComposeSubmit = (): void => {
    const text = localDraft.trim()
    if (text === '' && composerSnap.attachments.length === 0) return
    try {
      composerFocusedRef.current = false
      if (localDraft !== composerSnap.draft) compose.setDraft(localDraft)
      compose.submit()
      setWritebackError(null)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      setWritebackError(`发送失败: ${msg}`)
    }
  }

  const pickComposeFiles = async (): Promise<void> => {
    // Any file kind: images become thumbnails, everything else uploads as a
    // file draft — the same intake the conversation composer's attach button
    // performs.
    const files = await pickFiles().catch(() => [] as File[])
    if (files.length > 0) compose.attachFiles(files)
  }

  const onComposeChange = (text: string): void => {
    // Local buffer only — do NOT setDraft on every keystroke (its selectEnd()
    // steals focus into the conversation composer).
    setLocalDraft(text)
  }

  const onComposeKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault()
      doComposeSubmit()
    }
  }

  // Paste an image straight from the clipboard into the composer as a real
  // attachment (the same intake as the attach button / drag-drop). Text paste
  // falls through to the textarea's default behaviour.
  const onComposePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>): void => {
    const items = Array.from(event.clipboardData?.items ?? [])
    const files: File[] = []
    for (const item of items) {
      if (item.kind === 'file' && item.type.startsWith('image/')) {
        const file = item.getAsFile()
        if (file !== null) files.push(file)
      }
    }
    if (files.length > 0) {
      event.preventDefault()
      try {
        compose.attachFiles(files)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        setWritebackError(`粘贴图片失败: ${msg}`)
      }
    }
  }

  // Load the generation-model dropdown options (and the current selection) for
  // all three modalities from the injected face. Re-read on open so a settings
  // change or an external `/generate-model` pick is reflected.
  const refreshModels = useCallback(() => {
    const next: Record<CanvasGenKind, CanvasModelOption[]> = { image: [], video: [], music: [] }
    for (const kind of ['image', 'video', 'music'] as const) {
      next[kind] = models.list(kind)
    }
    setModelOptions(next)
    setSelectedModels({
      image: next.image.find((o) => o.selected)?.key ?? next.image[0]?.key ?? '',
      video: next.video.find((o) => o.selected)?.key ?? next.video[0]?.key ?? '',
      music: next.music.find((o) => o.selected)?.key ?? next.music[0]?.key ?? '',
    })
  }, [models])

  useEffect(() => { refreshModels() }, [refreshModels])

  // Re-read the model dropdowns whenever a model switch is broadcast anywhere —
  // the conversation composer's picker dispatches `dsh:generate-model-changed`
  // (sessionId/kind/key) right after issuing `/generate-model`, and the face's
  // override mirror is updated by its own `ctx.effect` listener. Without this,
  // the canvas composer's DISPLAYED model only refreshed when its dropdown
  // gained focus, so an agent-composer pick showed stale here until clicked.
  useEffect(() => {
    const onModelChanged = (): void => { refreshModels() }
    window.addEventListener('dsh:generate-model-changed', onModelChanged)
    return () => window.removeEventListener('dsh:generate-model-changed', onModelChanged)
  }, [refreshModels])

  const actions = useMemo(() => ({
    removeNode: (nodeId: string) => {
      captureUndo(new Set([nodeId]))
      run('removeNode', removeNode(nodeId))
    },
    downloadNodeImage: (node: CanvasNode) => {
      run('downloadNodeImage', downloadNodeImage(node))
    },
    setPrimaryVariant: (nodeId: string, variantIndex: number) => {
      run('setPrimaryVariant', setPrimaryVariant(nodeId, variantIndex))
    },
  }), [removeNode, run, downloadNodeImage, setPrimaryVariant, captureUndo])

  // Right-click a node → context menu (删除 / 复制 / 添加至输入框). The browser's
  // native context menu is suppressed so our menu owns the right-click. When the
  // right-click lands on a multi-selected group of images, remember all of them
  // so 添加至输入框 batches the whole selection.
  const onNodeContextMenu = useCallback((event: ReactMouseEvent, node: Node): void => {
    event.preventDefault()
    setMenu(null)
    // Batch target = every selected image node. The right-click itself selects
    // the node under the cursor, so if the clicked node is NOT yet part of the
    // selection (a lone right-click), the batch is just that one node.
    const selected = selectedNodeIdsRef.current
    const selectedImages = (canvas?.nodes ?? [])
      .filter((n: CanvasNode) => selected.has(n.id) && n.kind === 'image')
      .map((n: CanvasNode) => n.id)
    const imageIds = selectedImages.length > 0
      ? selectedImages
      : (node.type === 'image' ? [node.id] : [])
    setNodeMenu({ x: event.clientX, y: event.clientY, nodeId: node.id, imageIds })
  }, [canvas])

  // Right-click on the box-selection rect (when multiple nodes are selected)
  // fires React Flow's onSelectionContextMenu — NOT onNodeContextMenu. Wire it
  // to the same batch menu so "box-select several images → right-click → 添加 N
  // 张图片至输入框" works.
  const onSelectionContextMenu = useCallback((event: ReactMouseEvent, nodes: Node[]): void => {
    event.preventDefault()
    setMenu(null)
    const imageIds = nodes
      .filter((n: Node) => n.type === 'image')
      .map((n: Node) => n.id)
    if (imageIds.length === 0) return
    const nodeId = imageIds[0]!
    setNodeMenu({ x: event.clientX, y: event.clientY, nodeId, imageIds })
  }, [])

  // Delete a node from the context menu (same write-back as the × button).
  const deleteNodeById = (nodeId: string): void => {
    captureUndo(new Set([nodeId]))
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

  // Put one node into the agent composer input box (image → thumbnail attachment,
  // text/note → draft text; media → `[类型] 标题`), without sending.
  const handleAddToInput = (nodeId: string): void => {
    const node: CanvasNode | undefined = canvas?.nodes.find((n: CanvasNode) => n.id === nodeId)
    if (node === undefined) return
    setNodeMenu(null)
    void addNodeToInput(node).then(() => {
      // Force a composer refresh so the canvas input box shows the new reference
      // thumbnail immediately (belt-and-braces on top of compose.subscribe).
      setComposerSnap(compose.getSnapshot())
      setLocalDraft(compose.getSnapshot().draft)
    }).catch((error: unknown) => {
      const msg = error instanceof Error ? error.message : String(error)
      setWritebackError(`添加到输入框失败: ${msg}`)
    })
  }

  // Batch-add every selected image to the composer as a reference (multi-image
  // reference). Fires one addNodeToInput per node; each appends its attachment,
  // so the whole selection lands in the input rail for a single many-to-one
  // generation submit.
  const handleAddSelectionToInput = (imageIds: string[]): void => {
    setNodeMenu(null)
    const nodes = (canvas?.nodes ?? []).filter((n: CanvasNode) => imageIds.includes(n.id) && n.kind === 'image')
    if (nodes.length === 0) return
    void Promise.all(nodes.map((node: CanvasNode) => addNodeToInput(node))).then(() => {
      setComposerSnap(compose.getSnapshot())
      setLocalDraft(compose.getSnapshot().draft)
    }).catch((error: unknown) => {
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
            onSelectionContextMenu={onSelectionContextMenu}
            onSelectionChange={({ nodes }) => {
              selectedNodeIdsRef.current = new Set(nodes.map((n: Node) => n.id))
            }}
            // Wider connection hit radius: a link can start anywhere within this
            // many screen px of a handle, so the user need not land dead-center.
            connectionRadius={36}
            // Edges are NOT reconnectable: React Flow's reconnect anchors (two
            // transparent circles at the wire ends) intercept pointer events and
            // make a fresh link land on the anchor instead of the handle — the
            // "must connect twice" bug — and their cursor is `move`, not scissors.
            // We deliberately disconnect via DOUBLE-CLICK instead (onEdgeDoubleClick
            // removes the wire AND persists the unlink), and draw our OWN scissors
            // cursor on edge hover (see canvas.css) so the cut affordance is clear
            // without the reconnect machinery getting in the way.
            edgesReconnectable={false}
            onEdgeDoubleClick={onEdgeDoubleClick}
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
              {nodeMenu.imageIds.length > 1
                ? (
                  <button type="button" onClick={() => { handleAddSelectionToInput(nodeMenu.imageIds) }}>
                    添加 {nodeMenu.imageIds.length} 张图片至输入框
                  </button>
                )
                : (
                  <button type="button" onClick={() => { handleAddToInput(nodeMenu.nodeId) }}>添加至输入框</button>
                )}
            </div>
          )}

          {/* Persistent agent composer dock — a FULL view of the real
              conversation composer: it mirrors the same draft / attachments /
              reference chips, so typing here = typing in the conversation and
              sending fires exactly one message. */}
          <div className="ldd-canvas-composer">
            {(modelOptions.image.length > 0 || modelOptions.video.length > 0 || modelOptions.music.length > 0) && (
              <div className="ldd-canvas-composer-toolbar">
                {(['image', 'video', 'music'] as const).map((kind) => {
                  if (modelOptions[kind].length === 0) return null
                  return (
                    <span key={kind} className="ldd-canvas-composer-model-group">
                      <span className="ldd-canvas-composer-model-label">{kind === 'image' ? '生图' : kind === 'video' ? '生视频' : '生音乐'}</span>
                      <select
                        className="ldd-canvas-composer-model"
                        value={selectedModels[kind]}
                        onFocus={refreshModels}
                        onChange={(event) => {
                          const key = event.target.value
                          setSelectedModels((prev) => ({ ...prev, [kind]: key }))
                          models.select(kind, key)
                        }}
                      >
                        {modelOptions[kind].map((m) => (
                          <option key={m.key} value={m.key}>{m.label}</option>
                        ))}
                      </select>
                    </span>
                  )
                })}
              </div>
            )}
            {(composerSnap.occurrences.length > 0 || composerSnap.attachments.length > 0) && (
              <div className="ldd-canvas-composer-attachments">
                {composerSnap.occurrences.map((label, index) => (
                  <span key={`ref-${index}`} className="ldd-canvas-composer-chip ldd-canvas-composer-chip-ref" title={label}>
                    {label}
                  </span>
                ))}
                {composerSnap.attachments.map((att) => (
                  <span key={att.id} className="ldd-canvas-composer-chip" title={att.name}>
                    {att.previewUrl !== undefined
                      ? <img className="ldd-canvas-composer-thumb" src={att.previewUrl} alt={att.name} />
                      : null}
                    <span className="ldd-canvas-composer-chip-label">{att.name}</span>
                    <button
                      type="button"
                      className="ldd-canvas-composer-chip-remove"
                      aria-label={`移除 ${att.name}`}
                      onClick={() => { compose.removeAttachment(att.id) }}
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
                title="添加附件"
                aria-label="添加附件"
                onClick={() => { void pickComposeFiles() }}
              >
                <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true" focusable="false">
                  <path d="M8 3.5v9M3.5 8h9" />
                </svg>
              </button>
              <textarea
                className="ldd-canvas-composer-input"
                value={localDraft}
                onChange={(event) => onComposeChange(event.target.value)}
                onFocus={() => { composerFocusedRef.current = true }}
                onBlur={() => { composerFocusedRef.current = false }}
                onKeyDown={onComposeKeyDown}
                onPaste={onComposePaste}
                placeholder="给 agent 发送消息…（Enter 发送，Shift+Enter 换行）"
                rows={1}
              />
              <button
                type="button"
                className="ldd-canvas-composer-send"
                onClick={doComposeSubmit}
                disabled={localDraft.trim() === '' && composerSnap.attachments.length === 0}
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
