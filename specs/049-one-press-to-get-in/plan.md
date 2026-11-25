# Plan: spec 049

## Approach

1. **Call controller (T-001).** `enter(roomId, { mic, camera })` goes `open → choose → join` in one move and connects, leaving any
   other call first, as `joinWith` does for broadcasts. `features/av/device-memory.ts` keeps the owner's last microphone and camera
   choice in `localStorage` (first time: microphone on, camera off); `setMic`/`setCamera` save it while the call's role is owner.
2. **One press (T-002).** `features/room/enter.ts` `enterRoom` enlarges the room through the room controller and, when the room
   offers calls, enters its call (the owner with the remembered choice, anyone else with both off). Start calls it after the
   create instead of opening the lobby; the lobby's Join calls it after joining; Enter the room calls it. A signed-out Join stores
   the room id in `sessionStorage` and asks for sign-in; the lobby, signed in again on that room, carries on.

## Tests

| AC            | Test                                                                                                                                            | Fails on base because                         |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------- |
| 001           | `rooms.test.tsx`: Start enlarges into the room's context and enters its call                                                                    | Start opens the lobby                         |
| 002, 003, 005 | `RoomLobbyPage.test.tsx`: Join makes a member, enters the context and the call (off); signed out it continues after sign-in; calls off: no call | Join only makes a member                      |
| 004           | `RoomLobbyPage.test.tsx`: Enter also enters the call                                                                                            | Enter only enlarges                           |
| 006           | `call-controller.test.ts`: enter() with the remembered choice; setCamera(true) by an owner is remembered                                        | enter() does not exist; nothing is remembered |

The e2e journeys in `room-flows.spec.ts` and `calls.spec.ts` change to the one-press flow.
