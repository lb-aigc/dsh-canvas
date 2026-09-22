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
 * Geometry mirrors the Settings trigger row exactly (the two footer rows sit
 * stacked above/below each other): the wide button is a 42px rounded-rect row
 * with an icon + 「画布」 label, the rail button is a 36×36 circle with just the
 * icon. The glyph is a rounded canvas frame with four node dots, filled in the
 * same `currentColor` outline style as the shipped dsh icon set.
 */
import type { ReactNode } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/**
 * Local SlotMap declaration for the root sidebar footer-action seat. The slot
 * is declared at runtime by `ui-sidebar`; the canvas owns an identical copy so
 * it needs no `@deepseek-ai/dsh-client-ui-sidebar` dependency edge (which would
 * force a pnpm lockfile round-trip). TypeScript merges the two declarations.
 */
declare module '@deepseek-ai/dsh-client-ui-slots' {
    interface SlotMap {
        /** Root-scoped footer action, rendered beside Settings at the sidebar foot. */
        'sidebar.footer.action': {
            kind: 'list';
            scope: 'root';
            owner: SidebarFooterActionOwnerProps;
        };
    }
}
/** Owner share of a root sidebar footer action (the shell supplies its column width). */
export interface SidebarFooterActionOwnerProps {
    /** Whether the sidebar renders wide content (false = 56px rail). */
    wide: boolean;
}
/** The face this entry injects: one way in, nothing to read back. */
export interface CanvasFooterButtonInjected {
    /** Ensure a Session exists, then open (or focus) the canvas page tab. */
    readonly open: () => void;
}
/** Button props: the root footer-action owner share (`wide`) plus the injected opener. */
export type CanvasFooterButtonProps = PropsRuntime<'sidebar.footer.action'> & CanvasFooterButtonInjected;
/**
 * The root footer action itself.
 * @param props - the injected opener and the `wide` column state.
 * @returns the canvas icon + label (expanded) or icon-only rail circle.
 */
export declare function CanvasFooterButton({ open, wide }: CanvasFooterButtonProps): ReactNode;
//# sourceMappingURL=CanvasFooterButton.d.ts.map