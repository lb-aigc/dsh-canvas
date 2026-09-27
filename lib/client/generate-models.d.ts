/**
 * @ldd/dsh-canvas — generation-model catalog (browser half).
 *
 * The canvas's own composer needs a "switch generation model" dropdown for
 * ALL THREE modalities (image / video / music) without importing
 * @ldd/dsh-generate (cross-plugin value imports are a bundle-purity error, and
 * the canvas is independently published). It therefore carries a
 * SELF-CONTAINED copy of the provider catalog and the picker-resolution rules,
 * and drives the switch through the SAME `/generate-model <kind> <key>` slash
 * command the generate plugin registers. The provider/model ids and labels here
 * MUST stay in sync with @ldd/dsh-generate's `src/client/presets.ts`
 * IMAGE_PRESETS / VIDEO_PRESETS / MUSIC_PRESETS.
 */
/** A suggested model/capability id for a provider's model field. */
export interface ModelSuggestion {
    readonly id: string;
    readonly label: string;
}
/** A provider preset (id + label + its selectable models). `suggestedModels`
 *  doubles as "this provider expands into N selectable models" — a provider
 *  with one suggestion is a single-model entry, one with many is a version /
 *  capability list. The image `kie` preset marks `aggregator` because one
 *  configured entry + one key reaches every model; the video/music presets
 *  are simpler (one entry = the chosen model/version). */
export interface GenerationPreset {
    readonly id: string;
    readonly label: string;
    readonly suggestedModels: readonly ModelSuggestion[];
    /** True for an aggregator (KIE image): one configured entry lists every model. */
    readonly aggregator?: boolean;
}
export declare const CUSTOM_PROVIDER_ID = "custom";
export declare const DEFAULT_PROVIDER = "mock";
/** Mirror of @ldd/dsh-generate's IMAGE_PRESETS. */
export declare const IMAGE_PRESETS: readonly GenerationPreset[];
/** Mirror of @ldd/dsh-generate's VIDEO_PRESETS. */
export declare const VIDEO_PRESETS: readonly GenerationPreset[];
/** Mirror of @ldd/dsh-generate's MUSIC_PRESETS. */
export declare const MUSIC_PRESETS: readonly GenerationPreset[];
/** One selectable generation model (routing key + label). */
export interface PickerModel {
    readonly key: string;
    readonly label: string;
    readonly isDefault: boolean;
}
/**
 * Resolve one modality's settings value into the dropdown's model list. An
 * aggregator entry (KIE image) expands into every one of its capabilities;
 * non-aggregators stay one entry = one model. Keys mirror the Host so a pick
 * routes to the exact same model the generate tool would.
 */
export declare function resolvePickerModels(value: {
    default?: string;
    models?: Array<{
        provider?: string;
        model?: string;
    }>;
} | undefined, presets: readonly GenerationPreset[]): {
    models: PickerModel[];
    defaultKey: string;
};
/** Backward-compatible alias: the image half of the old single-modality API. */
export declare function resolveImagePickerModels(value: {
    default?: string;
    models?: Array<{
        provider?: string;
        model?: string;
    }>;
} | undefined): {
    models: PickerModel[];
    defaultKey: string;
};
//# sourceMappingURL=generate-models.d.ts.map