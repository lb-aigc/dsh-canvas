/**
 * @ldd/dsh-canvas — Browser half.
 *
 * The canvas lives in ONE seat — the right Sidebar, as a page-type tab
 * (`kind: 'canvas'`) — fed by the ONE host-side truth (`useProjection('canvas')`,
 * which folds the durable `canvas/state` events). The registration uses the
 * stock public two-stage path: `ctx.sidebarRightTabs.register` declares the tab
 * type, the keyed `sidebar.right.pane.tab` seat hosts its body. That is the same
 * path `ui-sidebar-files` and `ui-sidebar-documentpreview` take, so it costs zero
 * upstream patches. It deliberately claims NO guide entry: the shipped guide
 * draws its own page whenever more than one entry is registered, which would
 * turn the strip's add control from "open Files" into "open the guide". The way
 * in is the always-mounted 「画布」 utility in the Session header below.
 *
 * The seat is session-scoped, so the framework hands the body `useProjection`
 * and `sessionId`. The injected face carries the image loader, the one-shot
 * agent prompt, the write-back verbs (the six typert Remote methods of
 * {@link CanvasService}, mounted from the generated `@ldd/dsh-canvas/remote`
 * contribution and called directly with the session id — the same direct shape
 * `session-controller` uses), AND the file-upload entry (`pickFilesAndUpload`).
 * Every write lands as a durable `canvas/state` event on the Host, so the
 * projection re-renders from the SAME mirror the `canvas_*` tools mutate.
 *
 * The right-Sidebar services are taken through `ctx.inject` rather than the
 * top-level `inject` list: the canvas has to keep working in a composition
 * without the right Sidebar, and a missing optional service must not take the
 * canvas down with it. The host half uses the same idiom for its optional
 * `sessionProjections`.
 *
 * The sessions service is read through `ctx.get('sessions')` with a minimal
 * STRUCTURAL face (not `ctx.sessions.<method>`). This package's single tsconfig
 * compiles host + client halves together, and the host half imports
 * `@deepseek-ai/dsh-session` (declaring `Context.sessions: SessionStore`) while
 * the client half imports the runtime (declaring `Context.sessions: ISessions`);
 * a direct `ctx.sessions` property access would surface that conflict as
 * TS2339. `ctx.get` sidesteps it (same idiom as generate's `SessionsLike`). The
 * `remote` service is reached the same way (`ctx.get('remote')`) with a local
 * structural shim, so this package does NOT import `@deepseek-ai/dsh-api-gateway`.
 */
import type { Context as ClientContext } from '@deepseek-ai/cordis'
import type { SessionId } from '@deepseek-ai/dsh-session/types'
// Type-only: the 'conversation.session.header.utilities' SlotMap row (declared
// by ui-conversation) must be in the program for the header-button register call.
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
// Type-only: pulls the renderer-owned slots service (ctx.slots).
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
// Type-only: pulls the Session standard useProjection/sessionId seat.
import type {} from '@deepseek-ai/dsh-client-ui-session/client'
// Type-only: pulls ctx.sidebarRight / ctx.sidebarRightTabs and the keyed
// sidebar.right.pane.tab seat declaration.
import type {} from '@deepseek-ai/dsh-client-ui-sidebar-right/client'
import type { CanvasState, CanvasNode, JsonValue } from '../model.ts'
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasReadAssetRequest, CanvasReadAssetValue, CanvasSaveAssetRequest, CanvasSaveAssetValue, CanvasUpdateNodeRequest } from '../types.ts'
import { CanvasView } from './CanvasView.tsx'
import type { CanvasUploadedAsset } from './CanvasView.tsx'
import { CanvasPanelButton } from './CanvasPanelButton.tsx'
import { CanvasFooterButton } from './CanvasFooterButton.tsx'
import { resolveImagePickerModels } from './generate-models.ts'
// The generated Remote contribution (TYPERT_REMOTE): a pure descriptor/codec
// value, inlined by tsdown into lib/client.js (no shared runtime identity).
import canvasRemote from '@ldd/dsh-canvas/remote'

/** Structural read face of the settings-scope binder (the `settingsScope`
 *  service the ui-settings plugin provides). Read via `ctx.get` for the same
 *  reason as `conversation`/`sessions`: the canvas must not import the settings
 *  package's value, and must keep working when it is absent. */
interface CanvasSettingsScopeBinderLike {
  bind<T>(spec: { namespace: string }): {
    getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: T | undefined }
    subscribe(listener: () => void): () => void
  }
}

/** The generate-image settings value shape (a structural copy of
 *  @ldd/dsh-generate's GenerationSettings). */
interface CanvasImageSettings {
  default?: string
  models?: Array<{ provider?: string; model?: string }>
  provider?: string
}

/** Structural read face of the runtime's `readAttachment` (brand-free). */
interface CanvasSessionLike {
  readAttachment(attachmentId: string): Promise<{
    ok: boolean
    error?: { code: string; message: string }
    value?: { attachment: { mediaType: string }; data: Uint8Array }
  }>
  /** Send one text prompt into the session's agent (queue mode). */
  prompt(content: readonly { readonly type: 'text'; readonly text: string }[], mode: 'queue' | 'steer'): Promise<unknown>
  /** Run a slash command against the session (e.g. `/generate-model image <key>`). */
  command(line: string): Promise<unknown>
}

/** Structural read face of the runtime sessions service (binding + scope lookup). */
interface CanvasSessionsLike {
  binding(id: SessionId): { session?: CanvasSessionLike } | undefined
  /** Resolve the session's Agent-scoped context (for composer-input injection). */
  scope(id: SessionId): ClientContext | undefined
}

/** Structural read face of the conversation service's input resolver, used to
 *  drop a node into the agent composer input box — as a real image attachment
 *  (thumbnail) for media, or as draft text for text/note nodes. */
interface CanvasConversationLike {
  input?: {
    for(actx: ClientContext): {
      setDraft(text: string): void
      addAttachments(ids: readonly string[]): boolean
      submit(): void
    }
  }
  /** Register browser-owned draft attachments (image → thumbnail, other → file). */
  createDrafts?(sessionId: SessionId, files: readonly File[]): readonly { id: string }[]
}

/** One Remote result, the wire shape the generated remote-client returns. */
interface CanvasRemoteResult<T> {
  ok: boolean
  error?: { code: string; message: string }
  value?: T
}

/** The `canvas` Remote namespace as this package calls it (direct, sessionId first). */
interface CanvasRemoteNamespaceLike {
  addNode(sessionId: string, request: CanvasAddNodeRequest): Promise<CanvasRemoteResult<CanvasState>>
  removeNode(sessionId: string, nodeId: string): Promise<CanvasRemoteResult<CanvasState>>
  updateNode(sessionId: string, nodeId: string, patch: CanvasUpdateNodeRequest): Promise<CanvasRemoteResult<CanvasState>>
  moveNode(sessionId: string, nodeId: string, x: number, y: number): Promise<CanvasRemoteResult<CanvasState>>
  link(sessionId: string, request: CanvasLinkRequest): Promise<CanvasRemoteResult<CanvasState>>
  inspect(sessionId: string): Promise<CanvasRemoteResult<CanvasState>>
  saveAsset(sessionId: string, request: CanvasSaveAssetRequest): Promise<CanvasRemoteResult<CanvasSaveAssetValue>>
  readAsset(sessionId: string, request: CanvasReadAssetRequest): Promise<CanvasRemoteResult<CanvasReadAssetValue>>
}

/** The Remote carrier as this package reaches it (mount + the canvas namespace). */
interface CanvasRemoteLike {
  $mount(contribution: unknown): Promise<unknown>
  canvas: CanvasRemoteNamespaceLike
  /** Session list (session-controller's remote) to resolve a session's workspace cwd. */
  session?: {
    list(request: Record<string, never>): Promise<{
      ok: boolean
      value: { items: Array<{ sessionId: SessionId; cwd?: string }> }
    }>
  }
}

/** Local structural copy of the main-process import result (no apps/desktop edge). */
interface ImportFileResultLike {
  readonly imported: boolean
  readonly relativePath: string
  readonly kind: 'video' | 'image' | 'document' | 'text' | 'other'
}

declare global {
  interface Window {
    readonly ldd?: {
      importFile(data: ArrayBuffer, fileName: string, workspacePath: string): Promise<ImportFileResultLike>
    }
  }
}

/** Extensions mapped to the three canvas media kinds (audio is NOT in the shell's kind vocabulary). */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp'])
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm'])
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma'])

/** `accept` filter per media kind for the native file picker (`.bmp` excluded from
 *  images: the attachment store's `saveImage` mediaTypes whitelist is
 *  png/jpeg/webp/gif, so a picked `.bmp` would be silently skipped anyway). */
const KIND_ACCEPT: Record<'image' | 'video' | 'music', string> = {
  image: '.png,.jpg,.jpeg,.webp,.gif',
  video: '.mp4,.mov,.mkv,.webm',
  music: '.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.wma',
}

/** Map one uploaded file name to a canvas media kind, or undefined when unsupported. */
function mediaKindOf(fileName: string): 'image' | 'video' | 'music' | undefined {
  const dot = fileName.lastIndexOf('.')
  const ext = dot === -1 ? '' : fileName.slice(dot).toLowerCase()
  if (IMAGE_EXTS.has(ext)) return 'image'
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (AUDIO_EXTS.has(ext)) return 'music'
  return undefined
}

/** Image MIME types the attachment store's `saveImage` accepts (its mediaTypes
 *  whitelist is exactly png/jpeg/webp/gif). `.bmp` is NOT normalizable, so it
 *  maps to undefined and the upload is skipped. */
const IMAGE_MIME: Record<string, string> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Map one image file name to its accepted MIME type, or undefined when not. */
function imageMediaTypeOf(fileName: string): string | undefined {
  const dot = fileName.lastIndexOf('.')
  const ext = dot === -1 ? '' : fileName.slice(dot).toLowerCase()
  return IMAGE_MIME[ext]
}

/** Human-readable kind caption (shared with CanvasView's KIND_LABEL). */
const KIND_LABEL: Record<CanvasNode['kind'], string> = {
  image: '图片',
  video: '视频',
  music: '音乐',
  text: '文本',
  note: '笔记',
}

/** A node's `url` is a `sha256:` attachment id. */
function isSha(url: string | undefined): url is string {
  return url !== undefined && url.startsWith('sha256:')
}

/** File extension for a stored image's verified media type (for the draft's name). */
function extOf(mediaType: string): string {
  switch (mediaType) {
    case 'image/png': return 'png'
    case 'image/jpeg': return 'jpg'
    case 'image/webp': return 'webp'
    case 'image/gif': return 'gif'
    default: return 'png'
  }
}

/** Read one File into a canonical base64 string (data-URL prefix stripped). */
function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result
      if (typeof result !== 'string') {
        reject(new Error('canvas: 文件读取失败'))
        return
      }
      const comma = result.indexOf(',')
      resolve(comma === -1 ? result : result.slice(comma + 1))
    }
    reader.onerror = () => reject(reader.error ?? new Error('canvas: 文件读取失败'))
    reader.readAsDataURL(file)
  })
}

/** Open the native file picker and resolve the chosen files (empty on cancel).
 *  @param accept - optional `input.accept` filter (e.g. '.png,.jpg' for images). */
function openFilePicker(accept?: string): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.multiple = true
    if (accept !== undefined) input.accept = accept
    input.hidden = true
    let settled = false
    input.onchange = () => {
      settled = true
      const files = Array.from(input.files ?? [])
      input.remove()
      resolve(files)
    }
    const onFocus = (): void => {
      window.removeEventListener('focus', onFocus)
      window.setTimeout(() => {
        if (!settled) {
          settled = true
          input.remove()
          resolve([])
        }
      }, 300)
    }
    window.addEventListener('focus', onFocus)
    document.body.appendChild(input)
    input.click()
  })
}

declare module '@deepseek-ai/dsh-session-projection/types' {
  interface SessionProjectionMap {
    /** Whole per-session canvas (nodes + edges). */
    canvas: CanvasState
  }
}

/** The right-Sidebar page kind this plugin owns; `openTab('canvas')` names it. */
export const CANVAS_KIND = 'canvas'

/** This implementation's identity in the tab system, and the key both keyed seats register under. */
const CANVAS_ID = '@ldd/dsh-canvas'

export const inject = ['slots', 'sessions']

/** Last `$mount` failure (or null), surfaced so the canvas can explain a missing
 *  `remote.canvas` namespace instead of throwing a bare `TypeError`. */
let mountFailure: string | null = null

/**
 * The per-session canvas face both seats share: the image loader, the
 * one-shot "ask the agent about a node" prompt, and the write-back verbs.
 * @param ctx - client root context.
 * @returns the Slot `inject` factory: session in, face out.
 */
function createCanvasFace(ctx: ClientContext) {
  // Bound once per plugin apply (settingsScope is a root service): the
  // generate-image scope feeding the canvas composer's model dropdown, plus a
  // per-session override mirror so the dropdown's check mark tracks the canvas's
  // own `/generate-model` picks across turns.
  let imageScope: { getSnapshot(): { status: 'loading' | 'ready' | 'unavailable'; value: CanvasImageSettings | undefined } } | undefined
  const imageOverrides = new Map<string, string>()
  const imageModelsOf = (): { models: Array<{ key: string; label: string; isDefault: boolean }>; defaultKey: string } => {
    if (imageScope === undefined) {
      const binder = ctx.get('settingsScope') as CanvasSettingsScopeBinderLike | undefined
      imageScope = binder?.bind<CanvasImageSettings>({ namespace: 'generate-image' })
    }
    const snapshot = imageScope?.getSnapshot()
    if (snapshot === undefined || snapshot.status !== 'ready' || snapshot.value === undefined) {
      return { models: [], defaultKey: '' }
    }
    return resolveImagePickerModels(snapshot.value)
  }
  // Fold external model switches (the conversation composer's picker issues the
  // same `/generate-model` command and broadcasts this event) into the canvas
  // dropdown's override mirror, so the two pickers stay in sync.
  ctx.effect(() => {
    const handler = (event: Event): void => {
      const detail = (event as CustomEvent<{ sessionId: string; kind: string; key: string }>).detail
      if (detail === undefined || typeof detail.sessionId !== 'string') return
      if (detail.kind === 'image') imageOverrides.set(detail.sessionId, detail.key)
    }
    window.addEventListener('dsh:generate-model-changed', handler)
    return () => window.removeEventListener('dsh:generate-model-changed', handler)
  }, 'canvas: generate-model sync')
  return (sessionId: SessionId) => {
    const sessionOf = (): CanvasSessionLike => {
      // Resolve lazily per call so a view mounted before the session bound
      // still loads once the binding is live. The structural face keeps this
      // independent of the host/client `Context.sessions` declaration split.
      const sessions = ctx.get('sessions') as CanvasSessionsLike | undefined
      const session = sessions?.binding(sessionId)?.session
      if (session === undefined) throw new Error('canvas: 会话不可用')
      return session
    }
    const remoteOf = (): CanvasRemoteNamespaceLike => {
      // Read the namespace through ctx.get('remote.canvas') — a reflect.get
      // (isolation-keyed store lookup) that does NOT run the proxy's inject
      // check. Reading `remote.canvas` as a property would instead be re-routed
      // by the traceable proxy to ctx['remote.canvas'] and throw
      // "cannot get property remote.canvas without inject", because this
      // package $mounts its own namespace (so it cannot declare the service in
      // the static `inject` list — that would dead-lock apply).
      const canvas = ctx.get('remote.canvas') as CanvasRemoteNamespaceLike | undefined
      if (canvas === undefined) {
        throw new Error(`canvas: 写回通道不可用（remote.canvas 命名空间未挂载${mountFailure === null ? '' : `，mount 失败：${mountFailure}`}）`)
      }
      return canvas
    }
    const unwrap = <T>(result: CanvasRemoteResult<T>, verb: string): T => {
      if (!result.ok) throw new Error(result.error?.message ?? `canvas: ${verb} 失败`)
      return result.value!
    }
    // Resolve the conversation composer input on demand (the session may not be
    // bound yet when the view first mounts). Returns the per-session SessionInput
    // (setDraft / addAttachments / submit) that the canvas composer drives.
    const composerInputOf = (): {
      setDraft(text: string): void
      addAttachments(ids: readonly string[]): boolean
      submit(): void
    } => {
      const conversation = ctx.get('conversation') as CanvasConversationLike | undefined
      const actx = (ctx.get('sessions') as CanvasSessionsLike | undefined)?.scope(sessionId)
      if (conversation?.input === undefined || actx === undefined) {
        throw new Error('canvas: 当前环境不支持 agent 输入框')
      }
      return conversation.input.for(actx)
    }
    return {
      loadImage: async (ref: CanvasReadAssetRequest): Promise<string> => {
        // Read through the canvas's own read channel (not session.readAttachment):
        // the latter requires the image to be a prompt image block in the session
        // log, but a canvas image is only referenced by its node url/meta.
        const saved = unwrap(await remoteOf().readAsset(sessionId, ref), 'readAsset')
        const binary = atob(saved.dataBase64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i)
        return URL.createObjectURL(new Blob([bytes.buffer], { type: saved.mediaType }))
      },
      ask: async (text: string): Promise<void> => {
        const session = sessionOf()
        await session.prompt([{ type: 'text', text }], 'queue')
      },
      addNodeToInput: async (node: CanvasNode): Promise<void> => {
        // Put a node into the agent composer input box WITHOUT sending:
        // - text/note → its content (or label) as draft text;
        // - image    → a real image attachment (thumbnail), read back through
        //              the canvas's own read channel and registered as a
        //              browser draft attachment;
        // - video/music → a `[类型] 标题` text reference (they are workspace
        //              files, not prompt image blocks).
        const conversation = ctx.get('conversation') as CanvasConversationLike | undefined
        const actx = (ctx.get('sessions') as CanvasSessionsLike | undefined)?.scope(sessionId)
        if (conversation?.input === undefined || actx === undefined) {
          throw new Error('canvas: 当前环境不支持添加到输入框')
        }
        const input = conversation.input.for(actx)
        const isImage = node.kind === 'image' && isSha(node.url) && node.meta !== undefined
        if (isImage) {
          const mediaType = typeof node.meta?.['mediaType'] === 'string' ? node.meta.mediaType : undefined
          const bytes = typeof node.meta?.['bytes'] === 'number' ? node.meta.bytes : undefined
          const width = typeof node.meta?.['width'] === 'number' ? node.meta.width : undefined
          const height = typeof node.meta?.['height'] === 'number' ? node.meta.height : undefined
          if (mediaType === undefined || bytes === undefined || width === undefined || height === undefined) {
            input.setDraft(`[图片] ${node.label}`)
            return
          }
          if (conversation.createDrafts === undefined) {
            input.setDraft(`[图片] ${node.label}`)
            return
          }
          const saved = unwrap(await remoteOf().readAsset(sessionId, {
            attachmentId: node.url!,
            mediaType, bytes, width, height,
          }), 'readAsset')
          const binary = atob(saved.dataBase64)
          const raw = new Uint8Array(binary.length)
          for (let i = 0; i < binary.length; i += 1) raw[i] = binary.charCodeAt(i)
          const blob = new Blob([raw.buffer], { type: saved.mediaType })
          const file = new File([blob], `${node.label}.${extOf(saved.mediaType)}`, { type: saved.mediaType })
          const drafts = conversation.createDrafts(sessionId, [file])
          if (drafts.length === 0) return
          input.addAttachments(drafts.map((d) => d.id))
          return
        }
        const text = node.kind === 'text' || node.kind === 'note'
          ? (node.content ?? node.label)
          : `[${KIND_LABEL[node.kind]}] ${node.label}`
        input.setDraft(text)
      },
      copyNodeToClipboard: async (node: CanvasNode): Promise<void> => {
        // Copy an image to the SYSTEM clipboard (paste into other apps), a
        // text/note as plain text, and media as a `[类型] 标题` text fallback.
        const writeText = async (text: string): Promise<void> => {
          if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
            await navigator.clipboard.writeText(text)
            return
          }
          throw new Error('canvas: 当前环境不支持剪贴板')
        }
        if (node.kind === 'text' || node.kind === 'note') {
          await writeText(node.content ?? node.label)
          return
        }
        if (node.kind !== 'image' || !isSha(node.url) || node.meta === undefined) {
          await writeText(`[${KIND_LABEL[node.kind]}] ${node.label}`)
          return
        }
        const mediaType = typeof node.meta.mediaType === 'string' ? node.meta.mediaType : undefined
        const bytes = typeof node.meta.bytes === 'number' ? node.meta.bytes : undefined
        const width = typeof node.meta.width === 'number' ? node.meta.width : undefined
        const height = typeof node.meta.height === 'number' ? node.meta.height : undefined
        if (mediaType === undefined || bytes === undefined || width === undefined || height === undefined) {
          await writeText(`[图片] ${node.label}`)
          return
        }
        const saved = unwrap(await remoteOf().readAsset(sessionId, {
          attachmentId: node.url!, mediaType, bytes, width, height,
        }), 'readAsset')
        const binary = atob(saved.dataBase64)
        const raw = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i += 1) raw[i] = binary.charCodeAt(i)
        const blob = new Blob([raw.buffer], { type: saved.mediaType })
        if (typeof navigator === 'undefined' || navigator.clipboard?.write === undefined || typeof ClipboardItem === 'undefined') {
          await writeText(`[图片] ${node.label}`)
          return
        }
        await navigator.clipboard.write([new ClipboardItem({ [saved.mediaType]: blob })])
      },
      models: {
        list: (): Array<{ key: string; label: string; selected: boolean }> => {
          const { models, defaultKey } = imageModelsOf()
          const override = imageOverrides.get(String(sessionId))
          return models.map((m) => ({
            key: m.key,
            label: m.label,
            selected: override !== undefined ? m.key === override : (m.isDefault || m.key === defaultKey),
          }))
        },
        select: (key: string): void => {
          imageOverrides.set(String(sessionId), key)
          if (typeof window !== 'undefined') {
            window.dispatchEvent(new CustomEvent('dsh:generate-model-changed', {
              detail: { sessionId: String(sessionId), kind: 'image', key },
            }))
          }
          void sessionOf().command(`/generate-model image ${key}`).catch(() => {})
        },
      },
      compose: {
        setDraft: (text: string): void => {
          composerInputOf().setDraft(text)
        },
        attachImages: (files: File[]): boolean => {
          const conversation = ctx.get('conversation') as CanvasConversationLike | undefined
          if (conversation?.createDrafts === undefined) {
            throw new Error('canvas: 当前环境不支持附件上传')
          }
          const drafts = conversation.createDrafts(sessionId, files)
          if (drafts.length === 0) return false
          return composerInputOf().addAttachments(drafts.map((d) => d.id))
        },
        submit: (): void => {
          composerInputOf().submit()
        },
      },
      addNode: async (request: CanvasAddNodeRequest): Promise<CanvasState> =>
        unwrap(await remoteOf().addNode(sessionId, request), 'addNode'),
      removeNode: async (nodeId: string): Promise<CanvasState> => {
        console.error(`[ldd-canvas] client removeNode CALLED nodeId=${nodeId} sessionId=${String(sessionId)}`)
        const result = await remoteOf().removeNode(sessionId, nodeId)
        console.error(`[ldd-canvas] client removeNode RESULT ok=${result.ok} error=${result.error?.message ?? ''}`)
        return unwrap(result, 'removeNode')
      },
      updateNode: async (nodeId: string, patch: CanvasUpdateNodeRequest): Promise<CanvasState> =>
        unwrap(await remoteOf().updateNode(sessionId, nodeId, patch), 'updateNode'),
      moveNode: async (nodeId: string, x: number, y: number): Promise<CanvasState> =>
        unwrap(await remoteOf().moveNode(sessionId, nodeId, x, y), 'moveNode'),
      link: async (request: CanvasLinkRequest): Promise<CanvasState> =>
        unwrap(await remoteOf().link(sessionId, request), 'link'),
      pickFiles: async (kind?: 'image' | 'video' | 'music'): Promise<File[]> =>
        openFilePicker(kind === undefined ? undefined : KIND_ACCEPT[kind]),
      uploadFiles: async (files: File[]): Promise<CanvasUploadedAsset[]> => {
        if (files.length === 0) return []
        // Resolve the session workspace cwd once (needed for verbatim video/audio
        // import so the agent's tools can read them by path). Read through
        // ctx.get('remote.session') for the same reason as remoteOf(): the
        // session namespace is a cordis service, and property access would trip
        // the proxy's inject check.
        let cwd: string | undefined
        const sessionRemote = ctx.get('remote.session') as {
          list(request: Record<string, never>): Promise<{
            ok: boolean
            value: { items: Array<{ sessionId: SessionId; cwd?: string }> }
          }>
        } | undefined
        const listed = await sessionRemote?.list({})
        cwd = listed?.ok === true
          ? listed.value.items.find((item) => item.sessionId === sessionId)?.cwd
          : undefined
        const assets: CanvasUploadedAsset[] = []
        for (const file of files) {
          const kind = mediaKindOf(file.name)
          if (kind === undefined) continue
          if (kind === 'image') {
            // Image → durable normalized attachment (renders on the card).
            const mediaType = imageMediaTypeOf(file.name)
            if (mediaType === undefined) continue
            const dataBase64 = await fileToBase64(file)
            const saved = unwrap(await remoteOf().saveAsset(sessionId, {
              kind: 'image', name: file.name, mediaType, dataBase64,
            }), 'saveAsset')
            assets.push({
              name: file.name, kind, attachmentId: saved.attachmentId,
              ...(saved.width === undefined ? {} : { width: saved.width }),
              ...(saved.height === undefined ? {} : { height: saved.height }),
              ...(saved.mediaType === undefined ? {} : { mediaType: saved.mediaType }),
              ...(saved.bytes === undefined ? {} : { bytes: saved.bytes }),
            })
            continue
          }
          // video/audio → verbatim workspace file (agent tools read the path).
          const ldd = window.ldd
          if (ldd === undefined) throw new Error('canvas: 当前环境不支持文件上传')
          if (cwd === undefined) throw new Error('canvas: 当前会话无工作区目录，无法上传文件')
          const data = await file.arrayBuffer()
          const res = await ldd.importFile(data, file.name, cwd)
          if (res.imported) assets.push({ name: file.name, kind })
        }
        return assets
      },
    }
  }
}

/**
 * Register the browser half: the right-Sidebar tab type and its body, the
 * Session-header way in, and the write-back Remote mount (the generated
 * `canvas` namespace contribution).
 * @param ctx - client root context carrying the slots and the Session seat.
 */
export function apply(ctx: ClientContext): void {
  const face = createCanvasFace(ctx)

  // --- write-back Remote mount -------------------------------------------------
  // Optional by construction: if the Gateway's `remote` carrier is not mounted
  // (a composition without api-gateway), the canvas stays read-only instead of
  // hanging the whole plugin. The generated contribution is a pure value, so
  // mounting it here wires `ctx.remote.canvas` for every subsequent caller.
  ctx.inject(['remote'], (remoteCtx) => {
    const remote = remoteCtx.get('remote') as CanvasRemoteLike | undefined
    if (remote !== undefined) {
      void remote.$mount(canvasRemote).then(() => {
        mountFailure = null
      }).catch((error: unknown) => {
        mountFailure = error instanceof Error ? error.message : String(error)
        console.error('[ldd-canvas] Remote mount failed:', error)
      })
    } else {
      mountFailure = 'remote 服务未就绪（api-gateway client 未装配）'
    }
  })

  // --- right Sidebar: the canvas as a page-type tab (the only seat) --------
  // Optional by construction: `ctx.inject` waits only for this slice, so a
  // composition without the right Sidebar simply has no canvas tab.
  ctx.inject(['sidebarRightTabs', 'sidebarRight'], (sidebarCtx) => {
    // No `patterns` = a page type, opened by kind. No `guide` entry on purpose —
    // see this module's header comment.
    sidebarCtx.effect(
      () => sidebarCtx.sidebarRightTabs.register({
        id: CANVAS_ID,
        kind: CANVAS_KIND,
        title: () => '画布',
      }),
      'ldd-canvas: right-sidebar tab type',
    )

    sidebarCtx.slots.inject('sidebar.right.pane.tab', () => sidebarCtx.slots.register({
      name: 'sidebar.right.pane.tab',
      key: CANVAS_ID,
      inject: face,
    }, CanvasView))

    // The always-mounted way in: one utility button in the Session header.
    sidebarCtx.slots.inject('conversation.session.header.utilities', () => sidebarCtx.slots.register({
      name: 'conversation.session.header.utilities',
      id: 'canvas-panel',
      order: 30,
      inject: () => ({ open: () => { sidebarCtx.sidebarRight.openTab(CANVAS_KIND) } }),
    }, CanvasPanelButton))
  })

  // --- root sidebar footer: the always-visible entry (no Session needed) -----
  // The canvas is plugin-owned end to end: this root-scoped footer action is
  // what makes the entry appear the moment the plugin is installed and vanish
  // when it is removed — the client itself ships no canvas entry. On click it
  // ensures a Session exists, then opens the canvas tab, waiting for the
  // sidebar-right binding (published only once a Session surface is mounted).
  ctx.slots.inject('sidebar.footer.action', () => ctx.slots.register({
    name: 'sidebar.footer.action',
    id: 'canvas-panel',
    order: 10,
    inject: () => ({ open: () => openCanvasRoot(ctx) }),
  }, CanvasFooterButton))
}

/**
 * Open the canvas from the root sidebar entry: ensure a Session exists, then
 * open (or focus) the canvas page tab.
 *
 * `sidebarRight.openTab` fails loudly with no mounted session surface, so when
 * the client has no current Session we first mint/reuse one via the workspace
 * UI's shared `startSession` action. The sidebar-right binding that `openTab`
 * reads is published by the session-scoped seat on the next React commit, so we
 * retry across animation frames until it lands (bounded) rather than assuming
 * it is ready synchronously.
 * @param ctx - client root context.
 */
function openCanvasRoot(ctx: ClientContext): void {
  const sessions = ctx.get('sessions') as {
    list: { getSnapshot(): { current: SessionId | undefined } }
  } | undefined
  const uiWorkspace = ctx.get('uiWorkspace') as {
    startSession(workspaceId?: unknown): void
  } | undefined
  const sidebarRight = ctx.get('sidebarRight') as {
    openTab(kind: string): void
  } | undefined

  if (sidebarRight === undefined) return

  if (sessions?.list.getSnapshot().current === undefined && uiWorkspace !== undefined) {
    uiWorkspace.startSession()
  }

  const tryOpen = (attempt: number): void => {
    try {
      sidebarRight.openTab(CANVAS_KIND)
    } catch (error) {
      if (attempt < 15) {
        requestAnimationFrame(() => tryOpen(attempt + 1))
      } else {
        console.error('[ldd-canvas] 打开画布失败：', error)
      }
    }
  }
  tryOpen(0)
}
