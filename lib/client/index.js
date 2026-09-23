import { CanvasView } from "./CanvasView.js";
import { CanvasPanelButton } from "./CanvasPanelButton.js";
import { CanvasFooterButton } from "./CanvasFooterButton.js";
import { resolveImagePickerModels } from "./generate-models.js";
// The generated Remote contribution (TYPERT_REMOTE): a pure descriptor/codec
// value, inlined by tsdown into lib/client.js (no shared runtime identity).
import canvasRemote from '@ldd/dsh-canvas/remote';
/** Extensions mapped to the three canvas media kinds (audio is NOT in the shell's kind vocabulary). */
const IMAGE_EXTS = new Set(['.png', '.jpg', '.jpeg', '.webp', '.gif', '.bmp']);
const VIDEO_EXTS = new Set(['.mp4', '.mov', '.mkv', '.webm']);
const AUDIO_EXTS = new Set(['.mp3', '.wav', '.flac', '.m4a', '.aac', '.ogg', '.opus', '.wma']);
/** `accept` filter per media kind for the native file picker (`.bmp` excluded from
 *  images: the attachment store's `saveImage` mediaTypes whitelist is
 *  png/jpeg/webp/gif, so a picked `.bmp` would be silently skipped anyway). */
const KIND_ACCEPT = {
    image: '.png,.jpg,.jpeg,.webp,.gif',
    video: '.mp4,.mov,.mkv,.webm',
    music: '.mp3,.wav,.flac,.m4a,.aac,.ogg,.opus,.wma',
};
/** Map one uploaded file name to a canvas media kind, or undefined when unsupported. */
function mediaKindOf(fileName) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot === -1 ? '' : fileName.slice(dot).toLowerCase();
    if (IMAGE_EXTS.has(ext))
        return 'image';
    if (VIDEO_EXTS.has(ext))
        return 'video';
    if (AUDIO_EXTS.has(ext))
        return 'music';
    return undefined;
}
/** Image MIME types the attachment store's `saveImage` accepts (its mediaTypes
 *  whitelist is exactly png/jpeg/webp/gif). `.bmp` is NOT normalizable, so it
 *  maps to undefined and the upload is skipped. */
const IMAGE_MIME = {
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.webp': 'image/webp',
    '.gif': 'image/gif',
};
/** Map one image file name to its accepted MIME type, or undefined when not. */
function imageMediaTypeOf(fileName) {
    const dot = fileName.lastIndexOf('.');
    const ext = dot === -1 ? '' : fileName.slice(dot).toLowerCase();
    return IMAGE_MIME[ext];
}
/** Human-readable kind caption (shared with CanvasView's KIND_LABEL). */
const KIND_LABEL = {
    image: '图片',
    video: '视频',
    music: '音乐',
    text: '文本',
    note: '笔记',
};
/** A node's `url` is a `sha256:` attachment id. */
function isSha(url) {
    return url !== undefined && url.startsWith('sha256:');
}
/** File extension for a stored image's verified media type (for the draft's name). */
function extOf(mediaType) {
    switch (mediaType) {
        case 'image/png': return 'png';
        case 'image/jpeg': return 'jpg';
        case 'image/webp': return 'webp';
        case 'image/gif': return 'gif';
        default: return 'png';
    }
}
/** Read one File into a canonical base64 string (data-URL prefix stripped). */
function fileToBase64(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => {
            const result = reader.result;
            if (typeof result !== 'string') {
                reject(new Error('canvas: 文件读取失败'));
                return;
            }
            const comma = result.indexOf(',');
            resolve(comma === -1 ? result : result.slice(comma + 1));
        };
        reader.onerror = () => reject(reader.error ?? new Error('canvas: 文件读取失败'));
        reader.readAsDataURL(file);
    });
}
/** Open the native file picker and resolve the chosen files (empty on cancel).
 *  @param accept - optional `input.accept` filter (e.g. '.png,.jpg' for images). */
function openFilePicker(accept) {
    return new Promise((resolve) => {
        const input = document.createElement('input');
        input.type = 'file';
        input.multiple = true;
        if (accept !== undefined)
            input.accept = accept;
        input.hidden = true;
        let settled = false;
        input.onchange = () => {
            settled = true;
            const files = Array.from(input.files ?? []);
            input.remove();
            resolve(files);
        };
        const onFocus = () => {
            window.removeEventListener('focus', onFocus);
            window.setTimeout(() => {
                if (!settled) {
                    settled = true;
                    input.remove();
                    resolve([]);
                }
            }, 300);
        };
        window.addEventListener('focus', onFocus);
        document.body.appendChild(input);
        input.click();
    });
}
/** The right-Sidebar page kind this plugin owns; `openTab('canvas')` names it. */
export const CANVAS_KIND = 'canvas';
/** This implementation's identity in the tab system, and the key both keyed seats register under. */
const CANVAS_ID = '@ldd/dsh-canvas';
export const inject = ['slots', 'sessions'];
/** Last `$mount` failure (or null), surfaced so the canvas can explain a missing
 *  `remote.canvas` namespace instead of throwing a bare `TypeError`. */
let mountFailure = null;
/**
 * The per-session canvas face both seats share: the image loader, the
 * one-shot "ask the agent about a node" prompt, and the write-back verbs.
 * @param ctx - client root context.
 * @returns the Slot `inject` factory: session in, face out.
 */
function createCanvasFace(ctx) {
    // Bound once per plugin apply (settingsScope is a root service): the
    // generate-image scope feeding the canvas composer's model dropdown, plus a
    // per-session override mirror so the dropdown's check mark tracks the canvas's
    // own `/generate-model` picks across turns.
    let imageScope;
    const imageOverrides = new Map();
    const imageModelsOf = () => {
        if (imageScope === undefined) {
            const binder = ctx.get('settingsScope');
            imageScope = binder?.bind({ namespace: 'generate-image' });
        }
        const snapshot = imageScope?.getSnapshot();
        if (snapshot === undefined || snapshot.status !== 'ready' || snapshot.value === undefined) {
            return { models: [], defaultKey: '' };
        }
        return resolveImagePickerModels(snapshot.value);
    };
    return (sessionId) => {
        const sessionOf = () => {
            // Resolve lazily per call so a view mounted before the session bound
            // still loads once the binding is live. The structural face keeps this
            // independent of the host/client `Context.sessions` declaration split.
            const sessions = ctx.get('sessions');
            const session = sessions?.binding(sessionId)?.session;
            if (session === undefined)
                throw new Error('canvas: 会话不可用');
            return session;
        };
        const remoteOf = () => {
            // Read the namespace through ctx.get('remote.canvas') — a reflect.get
            // (isolation-keyed store lookup) that does NOT run the proxy's inject
            // check. Reading `remote.canvas` as a property would instead be re-routed
            // by the traceable proxy to ctx['remote.canvas'] and throw
            // "cannot get property remote.canvas without inject", because this
            // package $mounts its own namespace (so it cannot declare the service in
            // the static `inject` list — that would dead-lock apply).
            const canvas = ctx.get('remote.canvas');
            if (canvas === undefined) {
                throw new Error(`canvas: 写回通道不可用（remote.canvas 命名空间未挂载${mountFailure === null ? '' : `，mount 失败：${mountFailure}`}）`);
            }
            return canvas;
        };
        const unwrap = (result, verb) => {
            if (!result.ok)
                throw new Error(result.error?.message ?? `canvas: ${verb} 失败`);
            return result.value;
        };
        // Resolve the conversation composer input on demand (the session may not be
        // bound yet when the view first mounts). Returns the per-session SessionInput
        // (setDraft / addAttachments / submit) that the canvas composer drives.
        const composerInputOf = () => {
            const conversation = ctx.get('conversation');
            const actx = ctx.get('sessions')?.scope(sessionId);
            if (conversation?.input === undefined || actx === undefined) {
                throw new Error('canvas: 当前环境不支持 agent 输入框');
            }
            return conversation.input.for(actx);
        };
        return {
            loadImage: async (ref) => {
                // Read through the canvas's own read channel (not session.readAttachment):
                // the latter requires the image to be a prompt image block in the session
                // log, but a canvas image is only referenced by its node url/meta.
                const saved = unwrap(await remoteOf().readAsset(sessionId, ref), 'readAsset');
                const binary = atob(saved.dataBase64);
                const bytes = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i += 1)
                    bytes[i] = binary.charCodeAt(i);
                return URL.createObjectURL(new Blob([bytes.buffer], { type: saved.mediaType }));
            },
            ask: async (text) => {
                const session = sessionOf();
                await session.prompt([{ type: 'text', text }], 'queue');
            },
            addNodeToInput: async (node) => {
                // Put a node into the agent composer input box WITHOUT sending:
                // - text/note → its content (or label) as draft text;
                // - image    → a real image attachment (thumbnail), read back through
                //              the canvas's own read channel and registered as a
                //              browser draft attachment;
                // - video/music → a `[类型] 标题` text reference (they are workspace
                //              files, not prompt image blocks).
                const conversation = ctx.get('conversation');
                const actx = ctx.get('sessions')?.scope(sessionId);
                if (conversation?.input === undefined || actx === undefined) {
                    throw new Error('canvas: 当前环境不支持添加到输入框');
                }
                const input = conversation.input.for(actx);
                const isImage = node.kind === 'image' && isSha(node.url) && node.meta !== undefined;
                if (isImage) {
                    const mediaType = typeof node.meta?.['mediaType'] === 'string' ? node.meta.mediaType : undefined;
                    const bytes = typeof node.meta?.['bytes'] === 'number' ? node.meta.bytes : undefined;
                    const width = typeof node.meta?.['width'] === 'number' ? node.meta.width : undefined;
                    const height = typeof node.meta?.['height'] === 'number' ? node.meta.height : undefined;
                    if (mediaType === undefined || bytes === undefined || width === undefined || height === undefined) {
                        input.setDraft(`[图片] ${node.label}`);
                        return;
                    }
                    if (conversation.createDrafts === undefined) {
                        input.setDraft(`[图片] ${node.label}`);
                        return;
                    }
                    const saved = unwrap(await remoteOf().readAsset(sessionId, {
                        attachmentId: node.url,
                        mediaType, bytes, width, height,
                    }), 'readAsset');
                    const binary = atob(saved.dataBase64);
                    const raw = new Uint8Array(binary.length);
                    for (let i = 0; i < binary.length; i += 1)
                        raw[i] = binary.charCodeAt(i);
                    const blob = new Blob([raw.buffer], { type: saved.mediaType });
                    const file = new File([blob], `${node.label}.${extOf(saved.mediaType)}`, { type: saved.mediaType });
                    const drafts = conversation.createDrafts(sessionId, [file]);
                    if (drafts.length === 0)
                        return;
                    input.addAttachments(drafts.map((d) => d.id));
                    return;
                }
                const text = node.kind === 'text' || node.kind === 'note'
                    ? (node.content ?? node.label)
                    : `[${KIND_LABEL[node.kind]}] ${node.label}`;
                input.setDraft(text);
            },
            copyNodeToClipboard: async (node) => {
                // Copy an image to the SYSTEM clipboard (paste into other apps), a
                // text/note as plain text, and media as a `[类型] 标题` text fallback.
                const writeText = async (text) => {
                    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText !== undefined) {
                        await navigator.clipboard.writeText(text);
                        return;
                    }
                    throw new Error('canvas: 当前环境不支持剪贴板');
                };
                if (node.kind === 'text' || node.kind === 'note') {
                    await writeText(node.content ?? node.label);
                    return;
                }
                if (node.kind !== 'image' || !isSha(node.url) || node.meta === undefined) {
                    await writeText(`[${KIND_LABEL[node.kind]}] ${node.label}`);
                    return;
                }
                const mediaType = typeof node.meta.mediaType === 'string' ? node.meta.mediaType : undefined;
                const bytes = typeof node.meta.bytes === 'number' ? node.meta.bytes : undefined;
                const width = typeof node.meta.width === 'number' ? node.meta.width : undefined;
                const height = typeof node.meta.height === 'number' ? node.meta.height : undefined;
                if (mediaType === undefined || bytes === undefined || width === undefined || height === undefined) {
                    await writeText(`[图片] ${node.label}`);
                    return;
                }
                const saved = unwrap(await remoteOf().readAsset(sessionId, {
                    attachmentId: node.url, mediaType, bytes, width, height,
                }), 'readAsset');
                const binary = atob(saved.dataBase64);
                const raw = new Uint8Array(binary.length);
                for (let i = 0; i < binary.length; i += 1)
                    raw[i] = binary.charCodeAt(i);
                const blob = new Blob([raw.buffer], { type: saved.mediaType });
                if (typeof navigator === 'undefined' || navigator.clipboard?.write === undefined || typeof ClipboardItem === 'undefined') {
                    await writeText(`[图片] ${node.label}`);
                    return;
                }
                await navigator.clipboard.write([new ClipboardItem({ [saved.mediaType]: blob })]);
            },
            models: {
                list: () => {
                    const { models, defaultKey } = imageModelsOf();
                    const override = imageOverrides.get(String(sessionId));
                    return models.map((m) => ({
                        key: m.key,
                        label: m.label,
                        selected: override !== undefined ? m.key === override : (m.isDefault || m.key === defaultKey),
                    }));
                },
                select: (key) => {
                    imageOverrides.set(String(sessionId), key);
                    void sessionOf().command(`/generate-model image ${key}`).catch(() => { });
                },
            },
            compose: {
                setDraft: (text) => {
                    composerInputOf().setDraft(text);
                },
                attachImages: (files) => {
                    const conversation = ctx.get('conversation');
                    if (conversation?.createDrafts === undefined) {
                        throw new Error('canvas: 当前环境不支持附件上传');
                    }
                    const drafts = conversation.createDrafts(sessionId, files);
                    if (drafts.length === 0)
                        return false;
                    return composerInputOf().addAttachments(drafts.map((d) => d.id));
                },
                submit: () => {
                    composerInputOf().submit();
                },
            },
            addNode: async (request) => unwrap(await remoteOf().addNode(sessionId, request), 'addNode'),
            removeNode: async (nodeId) => {
                console.error(`[ldd-canvas] client removeNode CALLED nodeId=${nodeId} sessionId=${String(sessionId)}`);
                const result = await remoteOf().removeNode(sessionId, nodeId);
                console.error(`[ldd-canvas] client removeNode RESULT ok=${result.ok} error=${result.error?.message ?? ''}`);
                return unwrap(result, 'removeNode');
            },
            updateNode: async (nodeId, patch) => unwrap(await remoteOf().updateNode(sessionId, nodeId, patch), 'updateNode'),
            moveNode: async (nodeId, x, y) => unwrap(await remoteOf().moveNode(sessionId, nodeId, x, y), 'moveNode'),
            link: async (request) => unwrap(await remoteOf().link(sessionId, request), 'link'),
            pickFiles: async (kind) => openFilePicker(kind === undefined ? undefined : KIND_ACCEPT[kind]),
            uploadFiles: async (files) => {
                if (files.length === 0)
                    return [];
                // Resolve the session workspace cwd once (needed for verbatim video/audio
                // import so the agent's tools can read them by path). Read through
                // ctx.get('remote.session') for the same reason as remoteOf(): the
                // session namespace is a cordis service, and property access would trip
                // the proxy's inject check.
                let cwd;
                const sessionRemote = ctx.get('remote.session');
                const listed = await sessionRemote?.list({});
                cwd = listed?.ok === true
                    ? listed.value.items.find((item) => item.sessionId === sessionId)?.cwd
                    : undefined;
                const assets = [];
                for (const file of files) {
                    const kind = mediaKindOf(file.name);
                    if (kind === undefined)
                        continue;
                    if (kind === 'image') {
                        // Image → durable normalized attachment (renders on the card).
                        const mediaType = imageMediaTypeOf(file.name);
                        if (mediaType === undefined)
                            continue;
                        const dataBase64 = await fileToBase64(file);
                        const saved = unwrap(await remoteOf().saveAsset(sessionId, {
                            kind: 'image', name: file.name, mediaType, dataBase64,
                        }), 'saveAsset');
                        assets.push({
                            name: file.name, kind, attachmentId: saved.attachmentId,
                            ...(saved.width === undefined ? {} : { width: saved.width }),
                            ...(saved.height === undefined ? {} : { height: saved.height }),
                            ...(saved.mediaType === undefined ? {} : { mediaType: saved.mediaType }),
                            ...(saved.bytes === undefined ? {} : { bytes: saved.bytes }),
                        });
                        continue;
                    }
                    // video/audio → verbatim workspace file (agent tools read the path).
                    const ldd = window.ldd;
                    if (ldd === undefined)
                        throw new Error('canvas: 当前环境不支持文件上传');
                    if (cwd === undefined)
                        throw new Error('canvas: 当前会话无工作区目录，无法上传文件');
                    const data = await file.arrayBuffer();
                    const res = await ldd.importFile(data, file.name, cwd);
                    if (res.imported)
                        assets.push({ name: file.name, kind });
                }
                return assets;
            },
        };
    };
}
/**
 * Register the browser half: the right-Sidebar tab type and its body, the
 * Session-header way in, and the write-back Remote mount (the generated
 * `canvas` namespace contribution).
 * @param ctx - client root context carrying the slots and the Session seat.
 */
export function apply(ctx) {
    const face = createCanvasFace(ctx);
    // --- write-back Remote mount -------------------------------------------------
    // Optional by construction: if the Gateway's `remote` carrier is not mounted
    // (a composition without api-gateway), the canvas stays read-only instead of
    // hanging the whole plugin. The generated contribution is a pure value, so
    // mounting it here wires `ctx.remote.canvas` for every subsequent caller.
    ctx.inject(['remote'], (remoteCtx) => {
        const remote = remoteCtx.get('remote');
        if (remote !== undefined) {
            void remote.$mount(canvasRemote).then(() => {
                mountFailure = null;
            }).catch((error) => {
                mountFailure = error instanceof Error ? error.message : String(error);
                console.error('[ldd-canvas] Remote mount failed:', error);
            });
        }
        else {
            mountFailure = 'remote 服务未就绪（api-gateway client 未装配）';
        }
    });
    // --- right Sidebar: the canvas as a page-type tab (the only seat) --------
    // Optional by construction: `ctx.inject` waits only for this slice, so a
    // composition without the right Sidebar simply has no canvas tab.
    ctx.inject(['sidebarRightTabs', 'sidebarRight'], (sidebarCtx) => {
        // No `patterns` = a page type, opened by kind. No `guide` entry on purpose —
        // see this module's header comment.
        sidebarCtx.effect(() => sidebarCtx.sidebarRightTabs.register({
            id: CANVAS_ID,
            kind: CANVAS_KIND,
            title: () => '画布',
        }), 'ldd-canvas: right-sidebar tab type');
        sidebarCtx.slots.inject('sidebar.right.pane.tab', () => sidebarCtx.slots.register({
            name: 'sidebar.right.pane.tab',
            key: CANVAS_ID,
            inject: face,
        }, CanvasView));
        // The always-mounted way in: one utility button in the Session header.
        sidebarCtx.slots.inject('conversation.session.header.utilities', () => sidebarCtx.slots.register({
            name: 'conversation.session.header.utilities',
            id: 'canvas-panel',
            order: 30,
            inject: () => ({ open: () => { sidebarCtx.sidebarRight.openTab(CANVAS_KIND); } }),
        }, CanvasPanelButton));
    });
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
    }, CanvasFooterButton));
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
function openCanvasRoot(ctx) {
    const sessions = ctx.get('sessions');
    const uiWorkspace = ctx.get('uiWorkspace');
    const sidebarRight = ctx.get('sidebarRight');
    if (sidebarRight === undefined)
        return;
    if (sessions?.list.getSnapshot().current === undefined && uiWorkspace !== undefined) {
        uiWorkspace.startSession();
    }
    const tryOpen = (attempt) => {
        try {
            sidebarRight.openTab(CANVAS_KIND);
        }
        catch (error) {
            if (attempt < 15) {
                requestAnimationFrame(() => tryOpen(attempt + 1));
            }
            else {
                console.error('[ldd-canvas] 打开画布失败：', error);
            }
        }
    };
    tryOpen(0);
}
//# sourceMappingURL=index.js.map