/**
 * @ldd/dsh-canvas — image generation-model catalog (browser half).
 *
 * The canvas's own composer needs a "switch generation model" dropdown without
 * importing @ldd/dsh-generate (cross-plugin value imports are a bundle-purity
 * error, and the canvas is independently published). It therefore carries a
 * SELF-CONTAINED copy of the image provider catalog and the picker-resolution
 * rules, and drives the switch through the SAME `/generate-model image <key>`
 * slash command the generate plugin registers. The provider/model ids and
 * labels here MUST stay in sync with @ldd/dsh-generate's
 * `src/client/presets.ts` IMAGE_PRESETS.
 */
/** A suggested model/capability id for a provider's model field. */
export interface ModelSuggestion {
    readonly id: string;
    readonly label: string;
}
export interface ImagePreset {
    readonly id: string;
    readonly label: string;
    readonly suggestedModels: readonly ModelSuggestion[];
    /** True for an aggregator (KIE): one configured entry lists every model. */
    readonly aggregator?: boolean;
}
export declare const CUSTOM_PROVIDER_ID = "custom";
export declare const DEFAULT_PROVIDER = "mock";
/** Mirror of @ldd/dsh-generate's IMAGE_PRESETS (image half only). */
export declare const IMAGE_PRESETS: readonly ImagePreset[];
/** One selectable generation model (routing key + label). */
export interface PickerModel {
    readonly key: string;
    readonly label: string;
    readonly isDefault: boolean;
}
/**
 * Resolve the generate-image settings value into the dropdown's model list.
 * An aggregator entry (KIE) expands into every one of its capabilities;
 * non-aggregators stay one entry = one model. Keys mirror the Host so a pick
 * routes to the exact same model the generate tool would.
 */
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