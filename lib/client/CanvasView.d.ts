import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
import type { CanvasState } from '../model.ts';
import type { CanvasAddNodeRequest, CanvasLinkRequest, CanvasUpdateNodeRequest } from '../types.ts';
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
/** Injected per-session canvas face: image loader + one-shot agent prompt + write-back. */
export interface CanvasViewInjected extends CanvasWriteback {
    loadImage: (attachmentId: string) => Promise<string>;
    ask: (text: string) => Promise<void>;
    /** Open the native file picker (menu-bar upload). */
    pickFiles: () => Promise<File[]>;
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
export declare function CanvasView({ useProjection, loadImage, ask, pickFiles, uploadFiles, addNode, removeNode, updateNode, moveNode, link }: CanvasViewProps): import("react").JSX.Element;
//# sourceMappingURL=CanvasView.d.ts.map