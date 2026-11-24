// The Share button and its menu (spec 027): copy the link, WhatsApp, e-mail, and the browser's own share sheet where there is
// one. Escape or a click outside closes it and focus returns to the button; "Link copied" is announced politely.
import { useCallback, useEffect, useId, useRef, useState } from "react";
import { useHost } from "~/features/host/host-context";
import { useStrings } from "~/features/shell/use-strings";
import { Icon } from "~/ui/Icon";
import kit from "~/ui/kit.module.css";
import { absoluteLink, emailLink, opening, whatsappLink } from "./share";
import styles from "./share.module.css";

export function ShareMenu({ path, text }: { path: string; text: string }) {
  const t = useStrings();
  const host = useHost();
  const [open, setOpen] = useState(false);
  const [said, setSaid] = useState("");
  const button = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const menuId = useId();
  const link = absoluteLink(host, path);
  const words = opening(text);
  const canNative = typeof navigator !== "undefined" && typeof navigator.share === "function";

  const close = useCallback((refocus: boolean) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  useEffect(() => {
    if (!open) return;
    menu.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close(true);
    };
    const onDown = (e: PointerEvent) => {
      if (!menu.current?.contains(e.target as Node) && !button.current?.contains(e.target as Node)) close(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("pointerdown", onDown);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("pointerdown", onDown);
    };
  }, [open, close]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(link);
      setSaid(t.linkCopied);
    } catch {
      setSaid("");
    }
    close(true);
  };

  return (
    <div className={styles.share} data-share="">
      <button
        ref={button}
        type="button"
        className={kit.iconButton}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => setOpen((o) => !o)}
        data-action="share"
      >
        <Icon name="share" size={18} />
        <span className={styles.label}>{t.share}</span>
      </button>
      {open ? (
        <div ref={menu} id={menuId} role="menu" className={styles.menu} data-share-menu="">
          <button type="button" role="menuitem" className={styles.item} onClick={() => void copy()} data-share-item="copy">
            <Icon name="link" size={18} />
            {t.copyLink}
          </button>
          <a
            role="menuitem"
            className={styles.item}
            href={whatsappLink(words, link)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={() => close(true)}
            data-share-item="whatsapp"
          >
            <Icon name="chat" size={18} />
            {t.whatsapp}
          </a>
          <a
            role="menuitem"
            className={styles.item}
            href={emailLink(t.shareSubject, words, link)}
            onClick={() => close(true)}
            data-share-item="email"
          >
            <Icon name="mail" size={18} />
            {t.email}
          </a>
          {canNative ? (
            <button
              type="button"
              role="menuitem"
              className={styles.item}
              onClick={() => {
                close(true);
                void navigator.share({ title: t.shareSubject, text: words, url: link }).catch(() => undefined);
              }}
              data-share-item="native"
            >
              <Icon name="share" size={18} />
              {t.shareNative}
            </button>
          ) : null}
        </div>
      ) : null}
      <span role="status" aria-live="polite" className={kit.visuallyHidden} data-share-status="">
        {said}
      </span>
    </div>
  );
}
