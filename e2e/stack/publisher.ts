// Makes rooms live for the feed journeys (specs 016 and 018): a separate page on the harness origin (the relay checks the
// page's Origin) opens one raw WebSocket per room to the local relay, joins first (so it holds the spotlight) and publishes
// a keyframe at `url` with the summary slice, as a publisher's client would. Its sockets are its own page's, so a test that
// counts the viewer's sockets does not see them. It offers the room's relay ticket (spec 048): only the owner's makes it a
// leader, so the publisher must own the rooms it publishes (createRoom with its token).
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
  const tickets: Record<string, string> = {};
  for (const room of rooms) {
    const res = await fetch(`http://127.0.0.1:${STACK.apiPort}/api/v1/rooms/${room.roomId}/ticket`, {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    if (res.status !== 200) throw new Error(`no relay ticket for ${room.roomId}: ${res.status}`);
    tickets[room.roomId] = ((await res.json()) as { ticket: string }).ticket;
  }
  await page.evaluate(
    async ({ relay, token, rooms, id, tickets }) => {
      const open = (room: (typeof rooms)[number]) =>
        new Promise<void>((resolve, reject) => {
          const ws = new WebSocket(`${relay}/r/${room.roomId}`, [
            "sefaria-social.v1",
            `bearer.${token}`,
            `ticket.${tickets[room.roomId]}`,
          ]);
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
    { relay: `ws://127.0.0.1:${STACK.relayPort}`, token, rooms, id: String(persona.id), tickets },
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

/** Join a room as a member with the token's user (the room's link is the invitation, spec 011). */
export async function joinRoom(token: string, roomId: string): Promise<void> {
  const res = await fetch(`http://127.0.0.1:${STACK.apiPort}/api/v1/rooms/${roomId}/members`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  });
  if (res.status >= 300) throw new Error(`could not join ${roomId}: ${res.status}`);
}

/**
 * Move a publisher's room to another place (spec 056): a new keyframe on the socket `publish` opened for `index`, as the
 * leader's client does when they go to another text.
 */
export async function move(context: BrowserContext, index: number, room: LiveRoom, seq: number): Promise<void> {
  const page = context.pages()[0]!;
  await page.evaluate(
    ({ index, room, seq }) => {
      const ws = (window as unknown as { __publisherSockets: WebSocket[] }).__publisherSockets[index]!;
      const slices = { "social.summary": { v: 1, value: room.summary } };
      ws.send(
        JSON.stringify({
          ch: "state",
          body: { type: "keyframe", seq, t: seq, snapshot: { v: 1, url: room.url, nav: null, slices } },
        }),
      );
    },
    { index, room, seq },
  );
}

/** Post as the token's user, with a card for a room, broadcast or recording (spec 055); returns the HTTP status. */
export async function postWithEmbed(token: string, body: string, embed: { kind: string; id: string }): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${STACK.apiPort}/api/v1/posts`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify({ body, embed }),
  });
  await res.arrayBuffer();
  return res.status;
}
