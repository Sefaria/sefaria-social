// Makes rooms live for the feed journeys (specs 016 and 018): a separate page on the harness origin (the relay checks the
// page's Origin) opens one raw WebSocket per room to the local relay, joins first (so it holds the spotlight) and publishes
// a keyframe at `url` with the summary slice, as a publisher's client would. Its sockets are its own page's, so a test that
// counts the viewer's sockets does not see them.
import type { Browser, BrowserContext } from "@playwright/test";
import { STACK } from "./config";
import { tokenFor, type Persona } from "./tokens";

export interface LiveRoom {
  roomId: string;
  url: string;
  summary: { ref: string; heRef: string | null; title: string };
}

export async function publish(browser: Browser, persona: Persona, rooms: LiveRoom[]): Promise<BrowserContext> {
  const context = await browser.newContext();
  const page = await context.newPage();
  await page.goto("/social/settings"); // any harness page: only its origin matters
  const token = await tokenFor(persona);
  await page.evaluate(
    async ({ relay, token, rooms, id }) => {
      const open = (room: (typeof rooms)[number]) =>
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`${relay}/r/${room.roomId}`, ["sefaria-social.v1", `bearer.${token}`]);
          ws.onerror = () => reject(new Error(`relay refused ${room.roomId}`));
          ws.onopen = () => {
            ws.send(
              JSON.stringify({
                ch: "control",
                body: { type: "join", participant: { id, name: "Publisher", isHost: true, canLead: true } },
              }),
            );
            const slices = { "social.summary": { v: 1, value: room.summary } };
            ws.send(
              JSON.stringify({
                ch: "state",
                body: { type: "keyframe", seq: 0, t: 0, snapshot: { v: 1, url: room.url, nav: null, slices } },
              }),
            );
            resolve();
          };
          (window as unknown as { __publisherSockets?: WebSocket[] }).__publisherSockets ??= [];
          (window as unknown as { __publisherSockets: WebSocket[] }).__publisherSockets.push(ws);
        });
      await Promise.all(rooms.map(open));
    },
    { relay: `ws://127.0.0.1:${STACK.relayPort}`, token, rooms, id: String(persona.id) },
  );
  return context;
}

/** The feed as the API gives it to a token, for polling until the relay reports the rooms live. */
export async function feedOf(token: string): Promise<{ live: { id: string }[]; recent: { id: string }[] }> {
  const res = await fetch(`http://127.0.0.1:${STACK.apiPort}/api/v1/feed`, { headers: { authorization: `Bearer ${token}` } });
  return res.json() as Promise<{ live: { id: string }[]; recent: { id: string }[] }>;
}

/** Create a room owned by the token's user. */
export async function createRoom(token: string, title: string): Promise<{ id: string }> {
  const res = await fetch(`http://127.0.0.1:${STACK.apiPort}/api/v1/rooms`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ title }),
  });
  if (res.status !== 201) throw new Error(`room not created: ${res.status}`);
  return res.json() as Promise<{ id: string }>;
}
