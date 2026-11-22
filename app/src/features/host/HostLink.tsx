import type { MouseEvent, ReactNode } from "react";
import { useHost } from "./host-context";

/**
 * A link to a page outside social, a ref or a library page for example (routing rule R15). It is a real <a href> built by the
 * host (so it respects the host and the language, and never points at the legacy client) and a plain click is handed to
 * host.navigate(). Links inside social use the router's <Link>, whose history is the host-bridged one.
 */
export function HostLink({ to, children, className }: { to: string; children: ReactNode; className?: string }) {
  const host = useHost();
  const onClick = (e: MouseEvent<HTMLAnchorElement>) => {
    if (!host || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    e.preventDefault();
    host.navigate(to);
  };
  return (
    <a href={host ? host.href(to) : to} onClick={onClick} className={className}>
      {children}
    </a>
  );
}
