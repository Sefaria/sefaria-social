import { useInterfaceLang } from "~/features/host/host-context";
import { stringsFor, type Strings } from "./strings";

export const useStrings = (): Strings => stringsFor(useInterfaceLang());
