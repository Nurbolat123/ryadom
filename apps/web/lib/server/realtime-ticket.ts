import { realtimeTicketKey, REALTIME_TICKET_TTL_SEC } from "@ryadom/shared";
import { redis } from "../redis";
import { randomToken, sha256 } from "./hash";

/** Билет живёт минуту и используется один раз; в Redis хранится только хэш. */
export const issueRealtimeTicket = async (userId: string) => {
  const ticket = randomToken();
  await redis.set(realtimeTicketKey(sha256(ticket)), userId, "EX", REALTIME_TICKET_TTL_SEC);
  return ticket;
};
