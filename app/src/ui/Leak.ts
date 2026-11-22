// Throwaway: a forbidden import (ui must never import server code).
import { dbUrl } from "../server/db/client";

export const leakedDbUrl = dbUrl;
