import { useSyncExternalStore } from "react";
import type { SurfaceHost } from "@sefaria-social/host-contract";
import { HostLink } from "~/features/host/HostLink";
import { useStrings } from "~/features/shell/use-strings";
import { decodeCtx } from "~/lib/ctx";

/**
 * The persistent mount's content (routing rule R18): it is independent of the route and renders nothing unless the reader is
 * in a social context (`ctx=social.room.<id>` or `ctx=social.shiur.<id>`). The context comes from the address alone (R11).
 * For now it shows a link back to the room or shiur page; the mini view and follow bar arrive with the rooms specs.
 */
export function PersistentView({ host }: { host: SurfaceHost }) {
  const raw = useSyncExternalStore(
    (cb) => host.reader.context.subscribe(cb),
    () => host.reader.context.get(),
    () => null,
  );
  const t = useStrings();
  const context = decodeCtx(raw); // untrusted: decodeCtx validates the value's grammar
  if (!context) return null;
  const page = context.kind === "room" ? `/social/r/${context.id}` : `/social/s/${context.id}`;
  return (
    <div data-social-persistent={context.kind}>
      <span>{t.inRoom}</span> <HostLink to={page}>{t.backToRoom}</HostLink>
    </div>
  );
}
