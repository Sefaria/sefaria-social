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
 * sends the reader there with commands.go(). In standalone mode (no reader) it is a plain link to the ref's path.
 */
export function ReaderRefLink({ textRef, children }: { textRef: string; children: ReactNode }) {
  const host = useHost();
  const ws = refWorkspace(textRef);
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!host || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    void host.reader.commands.go(ws);
  };
  return (
    <a href={host ? host.reader.commands.href(ws) : `/${textRef.replace(/ /g, "_")}`} onClick={onClick}>
      {children}
    </a>
  );
}
