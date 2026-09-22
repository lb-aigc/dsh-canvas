/**
 * CanvasFooterButton: the always-visible root entry into the canvas.
 *
 * Unlike the Session-header utility (which only renders once a Session is
 * open), this button rides the LEFT sidebar's root-scoped footer action seat
 * (`sidebar.footer.action`, `scope: 'root'`) — so it is on screen the moment
 * the client opens, without any Session. It is what makes the canvas a
 * plugin-owned, always-reachable entry: install the plugin and the button
 * appears; uninstall it and the button disappears. The client itself ships no
 * canvas entry.
 *
 * It renders an icon in the collapsed rail, and icon + 「画布」 label when the
 * sidebar is expanded, mirroring the shell's own New Session row.
 */
import type { ReactNode } from 'react'
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots'

/**
 * Local SlotMap declaration for the root sidebar footer-action seat. The slot
 * is declared at runtime by `ui-sidebar`; the canvas owns an identical copy so
 * it needs no `@deepseek-ai/dsh-client-ui-sidebar` dependency edge (which would
 * force a pnpm lockfile round-trip). TypeScript merges the two declarations.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface SlotMap {
    /** Root-scoped footer action, rendered beside Settings at the sidebar foot. */
    'sidebar.footer.action': { kind: 'list'; scope: 'root'; owner: SidebarFooterActionOwnerProps }
  }
}

/** Owner share of a root sidebar footer action (the shell supplies its column width). */
export interface SidebarFooterActionOwnerProps {
  /** Whether the sidebar renders wide content (false = 56px rail). */
  wide: boolean
}

/** The face this entry injects: one way in, nothing to read back. */
export interface CanvasFooterButtonInjected {
  /** Ensure a Session exists, then open (or focus) the canvas page tab. */
  readonly open: () => void
}

/** Button props: the root footer-action owner share (`wide`) plus the injected opener. */
export type CanvasFooterButtonProps = PropsRuntime<'sidebar.footer.action'> & CanvasFooterButtonInjected

/**
 * The root footer action itself.
 * @param props - the injected opener and the `wide` column state.
 * @returns the canvas icon (rail) or icon + label (expanded).
 */
export function CanvasFooterButton({ open, wide }: CanvasFooterButtonProps): ReactNode {
  return (
    <button
      type="button"
      className={wide ? 'ldd-canvas-footer-button ldd-canvas-footer-button--wide' : 'ldd-canvas-footer-button'}
      title="画布"
      aria-label="画布"
      onClick={open}
    >
      <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true" focusable="false">
        <rect x="1.5" y="2.5" width="5.5" height="4.5" rx="1" />
        <rect x="9" y="2.5" width="5.5" height="2.5" rx="1" />
        <rect x="9" y="6.5" width="5.5" height="7" rx="1" />
        <rect x="1.5" y="8.5" width="5.5" height="5" rx="1" />
      </svg>
      {wide && <span className="ldd-canvas-footer-button__label">画布</span>}
    </button>
  )
}
