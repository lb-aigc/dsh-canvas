import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CanvasNode, CanvasState } from '../model.ts';
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasReadAssetRequest, CanvasUpdateNodeRequest } from '../types.ts';
import './react-flow.css';
import './canvas.css';
/** The write-back verbs the seat face exposes (the client half of CanvasService). */
export interface CanvasWriteback {
    addNode(request: CanvasAddNodeRequest): Promise<CanvasState>;
    removeNode(nodeId: string): Promise<CanvasState>;
    updateNode(nodeId: string, patch: CanvasUpdateNodeRequest): Promise<CanvasState>;
    moveNode(nodeId: string, x: number, y: number): Promise<CanvasState>;
    link(request: CanvasLinkRequest): Promise<CanvasState>;
}
/** Live agent-composer face: the canvas's own bottom input box drives the REAL
 *  conversation composer — same draft, same send path, same attachments. */
export interface CanvasComposer {
    /** Replace the conversation draft (persisted to the real composer). */
    setDraft(text: string): void;
    /** Register image files as real composer attachments (thumbnail drafts). */
    attachImages(files: File[]): boolean;
    /** Send the current draft + attachments through the normal composer path. */
    submit(): void;
}
/** Injected per-session canvas face: image loader + one-shot agent prompt + write-back. */
export interface CanvasViewInjected extends CanvasWriteback {
    loadImage: (ref: CanvasReadAssetRequest) => Promise<string>;
    ask: (text: string) => Promise<void>;
    /** Put a node into the agent composer input box (image → thumbnail attachment,
     *  text/note → draft text), without sending. */
    addNodeToInput: (node: CanvasNode) => Promise<void>;
    /** The canvas's own composer input (drives the real conversation composer). */
    compose: CanvasComposer;
    /** Open the native file picker (menu-bar upload). */
    pickFiles: (kind?: 'image' | 'video' | 'music') => Promise<File[]>;
    /** Store the given files (image → attachment, video/audio → workspace) and
     *  return the ones that map to a canvas asset kind. */
    uploadFiles: (files: File[]) => Promise<CanvasUploadedAsset[]>;
}
/** One media file that was uploaded and can become a canvas node. */
export interface CanvasUploadedAsset {
    name: string;
    kind: 'image' | 'video' | 'music';
    /** Content-addressed attachment id (images only; the node's `url`). */
    attachmentId?: string;
    /** Normalized image width in px (images only). */
    width?: number;
    /** Normalized image height in px (images only). */
    height?: number;
    /** Verified media type of the stored image (images only). */
    mediaType?: string;
    /** Exact encoded byte length of the stored image (images only). */
    bytes?: number;
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
    useProjection: PropsRuntime<'sidebar.right.pane.tab'>['useProjection'];
    /** Injected per-session image loader. */
    loadImage: CanvasViewInjected['loadImage'];
    /** Injected one-shot agent prompt (ask about a selected node). */
    ask: CanvasViewInjected['ask'];
    /** Injected composer-node injection (image → attachment, text/note → draft). */
    addNodeToInput: CanvasViewInjected['addNodeToInput'];
    /** Injected canvas composer (drives the real conversation composer). */
    compose: CanvasViewInjected['compose'];
    /** Injected file picker (menu-bar upload). */
    pickFiles: CanvasViewInjected['pickFiles'];
    /** Injected file store (image → attachment, video/audio → workspace). */
    uploadFiles: CanvasViewInjected['uploadFiles'];
    /** Injected write-back verbs (user edits land as durable canvas/state events). */
    addNode: CanvasWriteback['addNode'];
    removeNode: CanvasWriteback['removeNode'];
    updateNode: CanvasWriteback['updateNode'];
    moveNode: CanvasWriteback['moveNode'];
    link: CanvasWriteback['link'];
}
export declare function CanvasView({ useProjection, loadImage, addNodeToInput, compose, pickFiles, uploadFiles, addNode, removeNode, updateNode, moveNode, link }: CanvasViewProps): import("react").JSX.Element;
//# sourceMappingURL=CanvasView.d.ts.map