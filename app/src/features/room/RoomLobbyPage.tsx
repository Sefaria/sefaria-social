import { useStrings } from "~/features/shell/use-strings";

/** `/social/r/$roomId`: the room lobby (R6). A placeholder until the rooms specs (who is here, what is learned, Join). */
export function RoomLobbyPage({ roomId }: { roomId: string }) {
  const t = useStrings();
  return (
    <main data-social-page="room">
      <h1>{t.room}</h1>
      <p>
        {t.roomId}: <bdi>{roomId}</bdi>
      </p>
      <p>{t.placeholder}</p>
    </main>
  );
}
