// `/social/s/$shiurId`: a shiur (R6). Spec 063 AC-007: an unlisted or public shiur shows its title and owner, its recordings,
// and its Claude assets at the versions the shiur pins; assets open in a new tab from the content origin (the reader's own
// asset panel is reader-next's). While it loads, and for an id that is not a shiur, the page stays the placeholder of spec
// 002 (its id and a link into the reader), saying when the shiur is private or does not exist.
import { useEffect, useState } from "react";
import { SocialApiError, useSocialApi, type Shiur } from "~/features/api/social-api";
import { HostLink } from "~/features/host/HostLink";
import { ReaderRefLink } from "~/features/host/ReaderRefLink";
import { AssetItem } from "~/features/profile/ClaudeAssets";
import assetStyles from "~/features/profile/claude-assets.module.css";
import { useStrings } from "~/features/shell/use-strings";

type State = { kind: "loading" } | { kind: "ready"; shiur: Shiur } | { kind: "missing" } | { kind: "error" };

export function ShiurPage({ shiurId }: { shiurId: string }) {
  const t = useStrings();
  const api = useSocialApi();
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    if (!api) return;
    let live = true;
    setState({ kind: "loading" });
    api.shiur(shiurId).then(
      (shiur) => live && setState({ kind: "ready", shiur }),
      (e: unknown) => live && setState({ kind: e instanceof SocialApiError && e.status === 404 ? "missing" : "error" }),
    );
    return () => {
      live = false;
    };
  }, [api, shiurId]);

  if (state.kind !== "ready")
    return (
      <main data-social-page="shiur">
        <h1>{t.shiur}</h1>
        <p>
          {t.shiurId}: <bdi>{shiurId}</bdi>
        </p>
        <p>{t.placeholder}</p>
        <p>
          <ReaderRefLink textRef="Genesis 1">{t.openText}</ReaderRefLink>
        </p>
        {state.kind === "missing" ? <p data-shiur-missing="">{t.shiurNotFound}</p> : null}
      </main>
    );

  const { shiur } = state;
  return (
    <main data-social-page="shiur" data-shiur={shiur.id}>
      <h1 dir="auto">{shiur.title}</h1>
      <p className={assetStyles.muted} dir="auto">
        {t.assetBy(shiur.owner.name)}
      </p>
      {shiur.recordings.length ? (
        <section aria-labelledby="shiur-recordings" className={assetStyles.section}>
          <h2 id="shiur-recordings" className={assetStyles.heading}>
            {t.shiurRecordings}
          </h2>
          <ul className={assetStyles.list}>
            {shiur.recordings.map((r) => (
              <li key={r.id} data-shiur-recording={r.id}>
                <HostLink to={`/social/rec/${r.id}`}>{r.title ?? shiur.title}</HostLink>
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {shiur.assets.length ? (
        <section aria-labelledby="shiur-assets" className={assetStyles.section} data-shiur-assets="">
          <h2 id="shiur-assets" className={assetStyles.heading}>
            {t.shiurAssets}
          </h2>
          <ul className={assetStyles.list}>
            {shiur.assets.map((a) => (
              <AssetItem
                key={a.assetId}
                item={{
                  key: a.assetId,
                  title: a.title,
                  description: a.description,
                  firstRef: a.firstRef || null,
                  // Inside a shiur anything is allowed (D7): the signed shiur URL when the server gives one.
                  contentUrl: a.shiurUrl ?? a.contentUrl,
                  note: t.assetVersion(a.n),
                }}
              />
            ))}
          </ul>
        </section>
      ) : null}
    </main>
  );
}
