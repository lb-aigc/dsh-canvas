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
  readonly id: string
  readonly label: string
}

export interface ImagePreset {
  readonly id: string
  readonly label: string
  readonly suggestedModels: readonly ModelSuggestion[]
  /** True for an aggregator (KIE): one configured entry lists every model. */
  readonly aggregator?: boolean
}

export const CUSTOM_PROVIDER_ID = 'custom'
export const DEFAULT_PROVIDER = 'mock'

/** Mirror of @ldd/dsh-generate's IMAGE_PRESETS (image half only). */
export const IMAGE_PRESETS: readonly ImagePreset[] = [
  { id: 'mock', label: 'Mock（占位）', suggestedModels: [] },
  {
    id: 'gpt-image',
    label: 'GPT Image',
    suggestedModels: [
      { id: 'gpt-image-2', label: 'GPT Image 2' },
      { id: 'gpt-image-1.5', label: 'GPT Image 1.5' },
    ],
  },
  {
    id: 'nano-banana',
    label: 'Nano Banana（Gemini 2.5 Flash Image）',
    suggestedModels: [{ id: 'gemini-2.5-flash-image', label: 'Gemini 2.5 Flash Image' }],
  },
  { id: 'midjourney', label: 'Midjourney', suggestedModels: [] },
  { id: 'seedream', label: 'Seedream（火山方舟）', suggestedModels: [] },
  {
    id: 'kie',
    label: 'KIE（聚合中转）',
    aggregator: true,
    suggestedModels: [
      { id: 'gpt-image-2-text-to-image', label: 'GPT Image 2' },
      { id: 'gpt-image-2-5-flare-text-to-image', label: 'GPT Image 2.5 Flare' },
      { id: 'gpt-image-2-5-sunburst-text-to-image', label: 'GPT Image 2.5 Sunburst' },
      { id: 'nano-banana-pro', label: 'Nano Banana Pro' },
      { id: 'nano-banana-2', label: 'Nano Banana 2' },
      { id: 'nano-banana-2-lite', label: 'Nano Banana 2 Lite' },
      { id: 'bytedance/seedream', label: 'Seedream 4.0' },
      { id: 'seedream/5-pro-text-to-image', label: 'Seedream 5.0 Pro' },
      { id: 'seedream/5-lite-text-to-image', label: 'Seedream 5.0 Lite' },
      { id: 'flux-2/pro-text-to-image', label: 'Flux-2 Pro' },
      { id: 'flux-2/flex-text-to-image', label: 'Flux-2' },
      { id: 'z-image', label: 'Z-image' },
      { id: 'grok-imagine/text-to-image', label: 'Grok Imagine' },
    ],
  },
  {
    id: 'legnext',
    label: 'Legnext（MJ 中转）',
    suggestedModels: [
      { id: '8.2', label: 'MJ V8.2' },
      { id: '8.1', label: 'MJ V8.1' },
      { id: '7', label: 'MJ V7' },
    ],
  },
]

/** One selectable generation model (routing key + label). */
export interface PickerModel {
  readonly key: string
  readonly label: string
  readonly isDefault: boolean
}

/** Stable routing key for one list entry (mirrors the Host/generate rule). */
function routeKeyOf(
  models: readonly { provider?: string; model?: string }[],
  index: number,
  presets: readonly ImagePreset[],
): string {
  const provider = models[index]?.provider || DEFAULT_PROVIDER
  const preset = presets.find((p) => p.id === provider)
  if (preset !== undefined && preset.suggestedModels.length > 0 && provider !== CUSTOM_PROVIDER_ID) {
    const modelId = models[index]?.model || preset.suggestedModels[0]!.id
    return `${provider}:${modelId}`
  }
  const prior = models
    .slice(0, index)
    .filter((m) => (m.provider || DEFAULT_PROVIDER) === provider).length
  return prior === 0 ? provider : `${provider}#${prior + 1}`
}

/** Normalize a stored `default` key into the current routing-key form. */
function normalizeDefaultKey(
  rawDefault: string,
  entries: readonly { provider?: string; model?: string }[],
  presets: readonly ImagePreset[],
): string {
  if (rawDefault === '') return rawDefault
  if (rawDefault.includes(':')) return rawDefault
  const hit = entries.find((e) => (e.provider || DEFAULT_PROVIDER) === rawDefault)
  if (hit === undefined) return rawDefault
  const preset = presets.find((p) => p.id === (hit.provider || DEFAULT_PROVIDER))
  if (preset !== undefined && preset.suggestedModels.length > 0 && hit.provider !== CUSTOM_PROVIDER_ID) {
    const modelId = hit.model || preset.suggestedModels[0]!.id
    return `${hit.provider}:${modelId}`
  }
  return rawDefault
}

/**
 * Resolve the generate-image settings value into the dropdown's model list.
 * An aggregator entry (KIE) expands into every one of its capabilities;
 * non-aggregators stay one entry = one model. Keys mirror the Host so a pick
 * routes to the exact same model the generate tool would.
 */
export function resolveImagePickerModels(value: {
  default?: string
  models?: Array<{ provider?: string; model?: string }>
} | undefined): { models: PickerModel[]; defaultKey: string } {
  const v = (value ?? {}) as Record<string, unknown>
  const rawModels = Array.isArray(v.models) && (v.models as unknown[]).length > 0
    ? v.models as Array<Record<string, unknown>>
    : [{ provider: typeof v.provider === 'string' ? v.provider : DEFAULT_PROVIDER }]
  const keyed = rawModels.map((entry) => ({
    provider: typeof entry.provider === 'string' && entry.provider !== '' ? entry.provider : DEFAULT_PROVIDER,
    model: typeof entry.model === 'string' ? entry.model : '',
  }))
  const models: PickerModel[] = []
  const seenKeys = new Set<string>()
  rawModels.forEach((entry, index) => {
    const provider = keyed[index]?.provider ?? DEFAULT_PROVIDER
    const preset = IMAGE_PRESETS.find((p) => p.id === provider)
    if (preset !== undefined && preset.suggestedModels.length > 0 && provider !== CUSTOM_PROVIDER_ID) {
      for (const suggestion of preset.suggestedModels) {
        const key = `${provider}:${suggestion.id}`
        if (seenKeys.has(key)) continue
        seenKeys.add(key)
        models.push({ key, label: suggestion.label, isDefault: false })
      }
    } else {
      const key = routeKeyOf(keyed, index, IMAGE_PRESETS)
      if (seenKeys.has(key)) return
      seenKeys.add(key)
      const modelId = keyed[index]?.model ?? ''
      const suggestion = preset?.suggestedModels.find((s) => s.id === modelId)
      const label = suggestion?.label ?? preset?.label ?? provider
      models.push({ key, label, isDefault: false })
    }
  })
  const defaultKey = normalizeDefaultKey(
    typeof v.default === 'string' ? v.default : '',
    keyed,
    IMAGE_PRESETS,
  ) || models[0]?.key || DEFAULT_PROVIDER
  return {
    models: models.map((m) => ({ ...m, isDefault: m.key === defaultKey })),
    defaultKey,
  }
}
