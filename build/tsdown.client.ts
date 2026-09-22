/**
 * Standalone client-bundle config for @ldd/dsh-canvas — a self-contained copy of
 * the Harness monorepo's `clientBundle` preset's CLIENT face, so the plugin can
 * build lib/client.js without importing `packages/client/tsdown.client.ts`.
 *
 * The externals, defines, banner/footer, and CSS handling below are byte-for-byte
 * equivalent to what the monorepo preset emits for this package. This file is the
 * decoupled-build seed for the standalone repo; it lives here (in the monorepo
 * working copy) so we can build against the COMPLETE pnpm node_modules, then copy
 * the emitted lib/client.js into the standalone repo's pre-committed lib/.
 *
 * Two CSS files (react-flow.css, canvas.css) are global style-tag injections;
 * no CSS modules or `?inline` are used, so the lightningcss transform is omitted
 * (the raw CSS is injected verbatim — functionally identical, marginally larger).
 */
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve as resolvePath } from 'node:path'
import { fileURLToPath } from 'node:url'

const id = '@ldd/dsh-canvas'
const PACKAGE_DIR = fileURLToPath(new URL('.', import.meta.url))

/** Module-table rows the shell shares (external): platform modules + this
 *  package's peerDependencies. Everything else inlines (deps + wire layers). */
const EXTERNALS = [
  'react', 'react/jsx-runtime', 'react-dom', 'react-dom/client',
  '@deepseek-ai/cordis',
  '@deepseek-ai/dsh-client-store',
  '@deepseek-ai/dsh-client-ui-slots',
  '@deepseek-ai/dsh-client-ui-primitives',
  '@deepseek-ai/dsh-client-ui-dockkit',
  // peerDependencies
  '@deepseek-ai/dsh-client-ui-conversation',
  '@deepseek-ai/dsh-client-ui-renderer',
  '@deepseek-ai/dsh-client-ui-session',
  '@deepseek-ai/dsh-client-ui-sidebar-right',
  '@deepseek-ai/dsh-session',
  '@deepseek-ai/dsh-session-projection',
  '@deepseek-ai/dsh-tools',
  '@deepseek-ai/dsh-typert-protocol',
  '@deepseek-ai/dsh-agent',
] as const

function isExternal(specifier: string): boolean {
  return EXTERNALS.some((name) => specifier === name || specifier.startsWith(`${name}/`))
}

const CSS_VIRTUAL_PREFIX = '\0dsh-css:'
const CSS_VIRTUAL_SUFFIX = '.mjs'

function styleInjectionModule(id: string, fileId: string, css: string): string {
  const tagId = `${id}/${basename(fileId)}`
  return [
    `const css = ${JSON.stringify(css)};`,
    `const tagId = ${JSON.stringify(tagId)};`,
    `if (typeof document !== 'undefined' && document.querySelector('style[data-plugin-css=' + JSON.stringify(tagId) + ']') === null) {`,
    `  const tag = document.createElement('style');`,
    `  tag.dataset.plugin = ${JSON.stringify(id)};`,
    `  tag.dataset.pluginCss = tagId;`,
    `  tag.textContent = css;`,
    `  document.head.appendChild(tag);`,
    `}`,
    `export {};`,
  ].join('\n')
}

export default {
  name: `${id}/client`,
  entry: { client: 'src/client/index.ts' },
  outDir: 'lib',
  format: 'cjs',
  platform: 'browser',
  dts: false,
  sourcemap: true,
  clean: false,
  deps: {
    neverBundle: isExternal,
    alwaysBundle: (specifier: string) => !isExternal(specifier),
  },
  inputOptions: {
    resolve: {
      conditionNames: ['production', 'browser', 'import', 'module', 'default'],
    },
  },
  define: {
    'process.env': '{}',
    'process.env.NODE_ENV': JSON.stringify('production'),
    'import.meta.env.MODE': JSON.stringify('production'),
    'import.meta.env': JSON.stringify({ MODE: 'production' }),
  },
  plugins: [{
    name: 'self-remote-alias',
    resolveId(source: string) {
      if (source === '@ldd/dsh-canvas/remote') {
        return resolvePath(PACKAGE_DIR, 'lib/typert.remote-client.js')
      }
      return null
    },
  }, {
    name: 'dsh-css-global-inline',
    resolveId(source: string, importer: string | undefined) {
      if (!source.endsWith('.css') || source.endsWith('.module.css')) return null
      const abs = importer !== undefined ? resolvePath(dirname(importer), source) : source
      return CSS_VIRTUAL_PREFIX + abs + CSS_VIRTUAL_SUFFIX
    },
    async load(virtualId: string) {
      if (!virtualId.startsWith(CSS_VIRTUAL_PREFIX)) return null
      const fileId = virtualId.slice(CSS_VIRTUAL_PREFIX.length, -CSS_VIRTUAL_SUFFIX.length)
      const source = await readFile(fileId)
      return styleInjectionModule(id, fileId, source.toString())
    },
  }],
  outputOptions: {
    entryFileNames: 'client.js',
    sourcemapExcludeSources: false,
    banner: `window.__ModuleLoader__.load({ id: ${JSON.stringify(id)}, factory: (require) => {`,
    footer: 'return module.exports; } });',
    intro: 'var module = { exports: {} }; var exports = module.exports;',
  },
}
