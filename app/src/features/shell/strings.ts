import type { InterfaceLang } from "~/features/host/host-context";

/** Interface strings for social's frame and placeholder pages, in both interface languages (plan 4.7). */
const STRINGS = {
  english: {
    nav: "Social",
    feed: "Feed",
    settings: "Settings",
    room: "Room",
    shiur: "Shiur",
    roomId: "Room id",
    shiurId: "Shiur id",
    placeholder: "This page is a placeholder.",
    notFoundTitle: "Page not found",
    notFoundBody: "There is no social page at this address.",
    backToFeed: "Back to the feed",
    tabs: { profile: "Profile", notifications: "Notifications" },
    openText: "Open Genesis 1 in the reader",
    reload: "Sefaria was updated. Please reload the page to use Social.",
    inRoom: "You are in a room",
    backToRoom: "Back to the room",
  },
  hebrew: {
    nav: "חברתי",
    feed: "עדכונים",
    settings: "הגדרות",
    room: "חדר",
    shiur: "שיעור",
    roomId: "מזהה חדר",
    shiurId: "מזהה שיעור",
    placeholder: "עמוד זה הוא ממלא מקום.",
    notFoundTitle: "העמוד לא נמצא",
    notFoundBody: "אין עמוד חברתי בכתובת הזאת.",
    backToFeed: "חזרה לעדכונים",
    tabs: { profile: "פרופיל", notifications: "התראות" },
    openText: "פתיחת בראשית א בקורא",
    reload: "ספריא עודכנה. יש לרענן את העמוד כדי להשתמש בחברתי.",
    inRoom: "את/ה בחדר",
    backToRoom: "חזרה לחדר",
  },
} as const satisfies Record<InterfaceLang, unknown>;

export type Strings = (typeof STRINGS)["english"] | (typeof STRINGS)["hebrew"];
export const stringsFor = (lang: InterfaceLang): Strings => STRINGS[lang];

/** `lang` and `dir` for an element whose text is in the interface language. */
export const langAttrs = (lang: InterfaceLang) =>
  lang === "hebrew" ? ({ lang: "he", dir: "rtl" } as const) : ({ lang: "en", dir: "ltr" } as const);
