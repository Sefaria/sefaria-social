// Claude assets in the interface (spec 063 AC-007): a person's public assets on their profile, the viewer's own assets with
// upload, Publish and Unpublish on their own profile, and the list a shiur page shows. Open is a plain link to the asset's
// sandboxed file on the content origin, in a new tab: the file never loads in this page (docs/runbooks/security.md).
import { useEffect, useId, useState, type ChangeEvent } from "react";
import {
  SocialApiError,
  useSocialApi,
  type ClaudeAssetProblem,
  type MyClaudeAsset,
  type PublicClaudeAsset,
} from "~/features/api/social-api";
import { ReaderRefLink } from "~/features/host/ReaderRefLink";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./claude-assets.module.css";

export interface AssetItemData {
  key: string;
  title: string;
  description: string;
  firstRef: string | null;
  contentUrl: string;
  note?: string;
}

/** One asset: title, description, its first ref in the reader, and Open in a new tab. */
export function AssetItem({ item }: { item: AssetItemData }) {
  const t = useStrings();
  const titleId = useId();
  return (
    <li className={styles.item} data-claude-asset={item.key}>
      <p id={titleId} className={styles.title} dir="auto">
        {item.title}
        {item.note ? <span className={styles.note}> · {item.note}</span> : null}
      </p>
      {item.description ? (
        <p className={styles.description} dir="auto">
          {item.description}
        </p>
      ) : null}
      <div className={styles.actions}>
        <a
          className={`${kit.button} ${kit.primary} ${kit.small}`}
          href={item.contentUrl}
          target="_blank"
          rel="noopener noreferrer"
          aria-label={t.assetOpenLabel(item.title)}
          data-action="open-asset"
        >
          {t.assetOpen}
        </a>
        {item.firstRef ? <ReaderRefLink textRef={item.firstRef}>{item.firstRef}</ReaderRefLink> : null}
      </div>
    </li>
  );
}

const publicItem = (a: PublicClaudeAsset): AssetItemData => ({
  key: a.id,
  title: a.title,
  description: a.description,
  firstRef: a.refs[0] ?? null,
  contentUrl: a.contentUrl,
});

/** A person's published assets (spec 063 AC-005, AC-007); nothing while loading or when the read fails. */
export function ProfileAssets({ profileId }: { profileId: string }) {
  const t = useStrings();
  const api = useSocialApi();
  const [assets, setAssets] = useState<PublicClaudeAsset[] | null>(null);
  useEffect(() => {
    if (!api) return;
    let live = true;
    api.profileAssets(profileId).then(
      (list) => live && setAssets(list),
      () => live && setAssets(null),
    );
    return () => {
      live = false;
    };
  }, [api, profileId]);
  if (assets === null) return null;
  return (
    <section aria-labelledby="profile-assets" className={styles.section} data-profile-assets="">
      <h2 id="profile-assets" className={styles.heading}>
        {t.assetsHeading}
      </h2>
      {assets.length === 0 ? (
        <p className={styles.muted}>{t.assetsNone}</p>
      ) : (
        <ul className={styles.list}>
          {assets.map((a) => (
            <AssetItem key={a.id} item={publicItem(a)} />
          ))}
        </ul>
      )}
    </section>
  );
}

type Message = { kind: "status" | "alert"; text: string; problems?: ClaudeAssetProblem[] };

/** A file's text, read with FileReader (as UTF-8). */
const readText = (file: Blob) =>
  new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result ?? ""));
    reader.onerror = () => reject(reader.error ?? new Error("read failed"));
    reader.readAsText(file);
  });

/** The viewer's own assets with upload, Publish and Unpublish (spec 063 AC-007), on their own profile. */
export function OwnAssets() {
  const t = useStrings();
  const api = useSocialApi();
  const inputId = useId();
  const [assets, setAssets] = useState<MyClaudeAsset[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);

  const reload = () => api?.myAssets().then(setAssets, () => setAssets([]));
  useEffect(() => {
    if (!api) return;
    let live = true;
    api.myAssets().then(
      (list) => live && setAssets(list),
      () => live && setAssets([]),
    );
    return () => {
      live = false;
    };
  }, [api]);

  const upload = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!api || !file) return;
    setBusy(true);
    setMessage({ kind: "status", text: t.assetUploading });
    try {
      const r = await api.saveAsset(await readText(file));
      if (r.ok) {
        setMessage({ kind: "status", text: t.assetSaved(r.asset.title) });
        await reload();
      } else setMessage({ kind: "alert", text: t.assetNotSaved, problems: r.problems });
    } catch {
      setMessage({ kind: "alert", text: t.assetSaveFailed });
    } finally {
      setBusy(false);
    }
  };

  const publish = async (asset: MyClaudeAsset, on: boolean) => {
    if (!api) return;
    setBusy(true);
    try {
      await api.publishAsset(asset.id, on);
      setMessage(null);
      await reload();
    } catch (e) {
      const notVerified = e instanceof SocialApiError && e.code === "asset.not_verified";
      setMessage({ kind: "alert", text: notVerified ? t.assetNeedsVerified : t.assetPublishFailed });
    } finally {
      setBusy(false);
    }
  };

  return (
    <section aria-labelledby="own-assets" className={styles.section} data-own-assets="">
      <h2 id="own-assets" className={styles.heading}>
        {t.myAssetsHeading}
      </h2>
      <div className={kit.field}>
        <label className={kit.label} htmlFor={inputId}>
          {t.assetUpload}
        </label>
        <input
          id={inputId}
          type="file"
          accept=".html,.htm,text/html"
          disabled={busy}
          onChange={(e) => void upload(e)}
          data-action="upload-asset"
        />
      </div>
      {message ? (
        <div role={message.kind} className={message.kind === "alert" ? styles.problem : styles.muted} data-asset-message="">
          <p>{message.text}</p>
          {message.problems?.length ? (
            <ul>
              {message.problems.map((p, i) => (
                <li key={i} dir="auto" data-asset-problem={p.code}>
                  {p.message}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}
      {assets === null ? null : assets.length === 0 ? (
        <p className={styles.muted}>{t.myAssetsNone}</p>
      ) : (
        <ul className={styles.list}>
          {assets.map((a) => {
            const current = a.versions.find((v) => v.id === a.currentVersionId);
            const published = a.versions.find((v) => v.id === a.publishedVersionId);
            return (
              <li key={a.id} className={styles.item} data-own-asset={a.id}>
                <p className={styles.title} dir="auto">
                  {a.title}
                  <span className={styles.note}>
                    {" "}
                    · {a.hidden ? t.assetHidden : t.assetVersionLine(current?.n ?? 0, published?.n ?? null)}
                  </span>
                </p>
                <div className={styles.actions}>
                  {current ? (
                    <a
                      className={`${kit.button} ${kit.secondary} ${kit.small}`}
                      href={current.contentUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      aria-label={t.assetOpenLabel(a.title)}
                    >
                      {t.assetOpen}
                    </a>
                  ) : null}
                  {current && current.id !== a.publishedVersionId && !a.hidden ? (
                    <button
                      type="button"
                      className={`${kit.button} ${kit.primary} ${kit.small}`}
                      disabled={busy}
                      onClick={() => void publish(a, true)}
                      data-action="publish-asset"
                    >
                      {t.assetPublish(current.n)}
                    </button>
                  ) : null}
                  {a.publishedVersionId ? (
                    <button
                      type="button"
                      className={`${kit.button} ${kit.ghost} ${kit.small}`}
                      disabled={busy}
                      onClick={() => void publish(a, false)}
                      data-action="unpublish-asset"
                    >
                      {t.assetUnpublish}
                    </button>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
