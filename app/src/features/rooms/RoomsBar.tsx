// The rail's ways into rooms (spec 044 AC-007): Start a room and All rooms, under the feed's rooms. It sits outside the feed's
// own block, so the feed's cards keep their place (they load their text when they come into view).
import { HostLink } from "~/features/host/HostLink";
import { useStrings } from "~/features/shell/use-strings";
import kit from "~/ui/kit.module.css";
import { StartRoom } from "./StartRoom";
import styles from "./rooms.module.css";

export function RoomsBar() {
  const t = useStrings();
  return (
    <div className={styles.bar} data-rooms-bar="">
      <StartRoom variant="primary" />
      <HostLink to="/social/rooms" className={kit.link}>
        {t.allRooms}
      </HostLink>
    </div>
  );
}
