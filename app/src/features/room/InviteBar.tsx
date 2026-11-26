// The invite bar (spec 058 AC-005; spec 059 for email): under the room's link, a field labelled "Invite by @handle or email".
// Typing offers matching people (a combobox with a listbox: arrow keys and Enter, or a click); Enter, comma or space turns the
// text into a chip; Send invites sends the chips and says, on each, what happened. An entry that was not sent stays as a chip
// marked with its reason; sent ones go after a moment. Rooms stay link-open: this only tells people.
import { useEffect, useId, useRef, useState, type KeyboardEvent } from "react";
import { useRoomsApi, type InviteStatus, type Person } from "~/features/api/rooms-api";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import styles from "./lobby.module.css";

const MAX_CHIPS = 20;
const SUGGEST_DELAY_MS = 200;

interface Chip {
  text: string;
  status: InviteStatus | null;
}

const done = (s: InviteStatus | null) => s === "invited" || s === "member";

export function InviteBar({ roomId }: { roomId: string }) {
  const t = useStrings();
  const api = useRoomsApi();
  const ids = { input: useId(), list: useId(), hint: useId() };
  const [text, setText] = useState("");
  const [chips, setChips] = useState<Chip[]>([]);
  const [people, setPeople] = useState<Person[]>([]);
  const [active, setActive] = useState(-1);
  const [sending, setSending] = useState(false);
  const [notice, setNotice] = useState<string>("");
  const asked = useRef(0);

  // Suggestions for what is being typed (not for an email address), a moment after the last key.
  useEffect(() => {
    const q = text.trim();
    if (!api?.people || q.replace(/^@/, "").length < 1 || q.includes(" ") || /.@/.test(q)) {
      setPeople([]);
      return;
    }
    const mine = ++asked.current;
    const timer = setTimeout(() => {
      void api.people!(q.slice(0, 30))
        .then((found) => {
          if (mine !== asked.current) return;
          setPeople(found);
          setActive(found.length ? 0 : -1);
        })
        .catch(() => undefined);
    }, SUGGEST_DELAY_MS);
    return () => clearTimeout(timer);
  }, [api, text]);

  if (!api?.invite) return null;

  const add = (raw: string) => {
    const value = raw.trim().replace(/,+$/, "");
    if (!value) return;
    setChips((cs) => {
      if (cs.some((c) => c.text.toLowerCase() === value.toLowerCase()) || cs.length >= MAX_CHIPS) return cs;
      return [...cs, { text: value, status: null }];
    });
    setText("");
    setPeople([]);
    setActive(-1);
  };

  const choose = (p: Person) => add(`@${p.handle}`);

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "ArrowDown" && people.length) {
      e.preventDefault();
      setActive((i) => (i + 1) % people.length);
    } else if (e.key === "ArrowUp" && people.length) {
      e.preventDefault();
      setActive((i) => (i <= 0 ? people.length - 1 : i - 1));
    } else if (e.key === "Escape" && people.length) {
      e.preventDefault();
      setPeople([]);
      setActive(-1);
    } else if (e.key === "Enter" || e.key === "," || (e.key === " " && text.trim())) {
      if (e.key === "Enter" && !text.trim() && chips.length) {
        e.preventDefault();
        void send();
        return;
      }
      e.preventDefault();
      if (e.key === "Enter" && active >= 0 && people[active]) choose(people[active]!);
      else add(text);
    } else if (e.key === "Backspace" && !text && chips.length) {
      setChips((cs) => cs.slice(0, -1));
    }
  };

  const send = async () => {
    const pending = [...chips.filter((c) => !done(c.status)).map((c) => c.text), ...(text.trim() ? [text.trim()] : [])];
    if (!pending.length || sending) return;
    if (text.trim()) add(text);
    setSending(true);
    setNotice("");
    try {
      const outcome = await api.invite!(roomId, pending.slice(0, MAX_CHIPS));
      if (outcome.kind === "limited") setNotice(t.inviteLimited);
      else if (outcome.kind === "not-found") setNotice(t.inviteFailed);
      else {
        const byText = new Map(outcome.results.map((r) => [r.to, r.status]));
        setChips((cs) => {
          const known = new Set(cs.map((c) => c.text));
          const next = cs.map((c) => (byText.has(c.text) ? { ...c, status: byText.get(c.text)! } : c));
          for (const r of outcome.results) if (!known.has(r.to)) next.push({ text: r.to, status: r.status });
          return next;
        });
        const sent = outcome.results.filter((r) => r.status === "invited").length;
        setNotice(t.invitesSent(sent));
        if (outcome.results.some((r) => r.status === "unavailable")) setNotice(`${t.invitesSent(sent)} ${t.emailUnavailable}`);
      }
    } catch {
      setNotice(t.inviteFailed);
    } finally {
      setSending(false);
    }
  };

  const clearDone = () => setChips((cs) => cs.filter((c) => !done(c.status)));
  const reason = (s: InviteStatus | null) => (s === null ? "" : (t.inviteStatus[s] ?? s));
  const open = people.length > 0;

  return (
    <div className={styles.inviteBar} data-invite-bar="">
      <label htmlFor={ids.input} className={kit.label}>
        {t.inviteByHandle}
      </label>
      <div className={styles.inviteField}>
        {chips.length > 0 && (
          <ul className={styles.chips} aria-label={t.toInvite} data-invite-chips="">
            {chips.map((c) => (
              <li
                key={c.text}
                className={`${styles.chip} ${c.status && !done(c.status) ? styles.chipProblem : ""} ${done(c.status) ? styles.chipDone : ""}`}
                data-invite-chip={c.text}
                data-status={c.status ?? undefined}
              >
                <span dir="ltr">{c.text}</span>
                {c.status ? <span className={styles.chipStatus}>{reason(c.status)}</span> : null}
                <button
                  type="button"
                  className={styles.chipRemove}
                  aria-label={t.removeInvitee(c.text)}
                  onClick={() => setChips((cs) => cs.filter((x) => x.text !== c.text))}
                  data-action="remove-invitee"
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        )}
        <div className={styles.comboRow}>
          <input
            id={ids.input}
            className={kit.input}
            type="text"
            value={text}
            placeholder={t.invitePlaceholder}
            maxLength={320}
            autoComplete="off"
            autoCapitalize="none"
            spellCheck={false}
            dir="ltr"
            role="combobox"
            aria-expanded={open}
            aria-controls={ids.list}
            aria-autocomplete="list"
            aria-activedescendant={open && active >= 0 ? `${ids.list}-${active}` : undefined}
            aria-describedby={ids.hint}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={onKey}
            onBlur={() => setTimeout(() => setPeople([]), 150)}
            data-invite-input=""
          />
          <button
            type="button"
            className={`${kit.button} ${kit.primary}`}
            disabled={sending || (!text.trim() && !chips.some((c) => !done(c.status)))}
            onClick={() => void send()}
            data-action="send-invites"
          >
            {sending ? t.sending : t.sendInvites}
          </button>
        </div>
        <ul id={ids.list} role="listbox" className={styles.suggestions} hidden={!open} data-invite-suggestions="">
          {people.map((p, i) => (
            <li
              key={p.id}
              id={`${ids.list}-${i}`}
              role="option"
              aria-selected={i === active}
              className={i === active ? `${styles.suggestion} ${styles.suggestionActive}` : styles.suggestion}
              onMouseDown={(e) => {
                e.preventDefault();
                choose(p);
              }}
              data-suggestion-handle={p.handle}
            >
              <span dir="auto">{p.name}</span>{" "}
              <span dir="ltr" className={styles.suggestionHandle}>
                @{p.handle}
              </span>
            </li>
          ))}
        </ul>
      </div>
      <span id={ids.hint} className={kit.hint}>
        {t.inviteBarHint}
      </span>
      <p role="status" aria-live="polite" className={kit.hint} data-invite-notice="">
        {notice}
        {chips.some((c) => done(c.status)) ? (
          <>
            {" "}
            <button type="button" className={styles.linkButton} onClick={clearDone} data-action="clear-sent">
              {t.clearSent}
            </button>
          </>
        ) : null}
      </p>
    </div>
  );
}
