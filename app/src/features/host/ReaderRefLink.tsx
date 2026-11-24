import type { MouseEvent, ReactNode } from "react";
import type { Workspace } from "@sefaria-social/host-contract";
import { useHost } from "./host-context";

/** A one-panel workspace showing `ref`, for the reader's workspace commands. */
export function refWorkspace(ref: string): Workspace {
  return {
    panels: { p0: { id: "p0", kind: "text", ref, versions: {}, asides: [] } },
    layout: { type: "leaf", id: "p0" },
  };
}

/**
 * A link to a ref in the reader (routing rule R15): the href comes from the reader's workspace commands, and a plain click
 * sends the reader there with commands.go(). With `beside` (spec 029), a plain click opens the text beside the page instead
 * (contract 1.1 host.openBeside), so the page stays where it was; a reader without openBeside (1.0) goes there as before. A
 * modified click (new tab, new window) always follows the plain href. In standalone mode (no reader) it is a plain link to the
 * ref's path.
 */
export function ReaderRefLink({
  textRef,
  children,
  beside = false,
  className,
}: {
  textRef: string;
  children: ReactNode;
  beside?: boolean;
  className?: string;
}) {
  const host = useHost();
  const ws = refWorkspace(textRef);
  const href = host ? host.reader.commands.href(ws) : `/${textRef.replace(/ /g, "_")}`;
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!host || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    if (beside && host.openBeside) host.openBeside(href);
    else void host.reader.commands.go(ws);
  };
  return (
    <a href={href} onClick={onClick} className={className} data-opens={beside && host?.openBeside ? "beside" : undefined}>
      {children}
    </a>
  );
}
