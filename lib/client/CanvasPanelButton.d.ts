/**
 * CanvasPanelButton: the always-mounted way into the right Sidebar's canvas tab.
 *
 * It rides the Session header's utilities list
 * (`conversation.session.header.utilities`, a list seat) instead of a guide
 * entry on purpose: the shipped guide opens its own page only while exactly one
 * entry is registered, so contributing one would turn the strip's add control
 * from "open Files" into "open the guide". A header utility leaves that control
 * alone AND renders for every Session, which is what this tab needs to be
 * reachable at all.
 *
 * It renders one icon button and calls `ctx.sidebarRight.openTab('canvas')`
 * through its injected face. Page tabs deduplicate within a pane, so pressing it
 * while the canvas is already open focuses that tab instead of duplicating it.
 *
 * Nothing here watches the canvas projection: the button never opens, closes or
 * focuses anything on its own. The panel moves only when the user presses it, so
 * the same prompt cannot produce a different canvas depending on panel state.
 */
import type { ReactNode } from 'react';
import type { PropsRuntime } from '@deepseek-ai/dsh-client-ui-slots';
/** The face this entry injects: one way in, nothing to read back. */
export interface CanvasPanelButtonInjected {
    /** Open the canvas page tab in the active pane, or focus it when already open. */
    readonly open: () => void;
}
/** Button props: the standard Session props plus the injected opener. */
export type CanvasPanelButtonProps = PropsRuntime<'conversation.session.header.utilities'> & CanvasPanelButtonInjected;
/**
 * The header utility itself.
 * @param props - the injected opener; the standard Session props go unused.
 * @returns the canvas icon button.
 */
export declare function CanvasPanelButton({ open }: CanvasPanelButtonProps): ReactNode;
//# sourceMappingURL=CanvasPanelButton.d.ts.map