// Composition of the coverage view's check-in request counts (S08.05): subscriptions' reader of the requests per building and floor (counts only,
// never who), on the app's database connection. Server only.
import { checkinRequestCounts } from "@/modules/subscriptions";
import { getDb } from "@/platform/db";

/** The check-in requests per building and floor ("where I live"), counted. */
export function checkinRequestsByFloor(): Promise<{ rsn: string; floorId: string; requests: number }[]> {
  return checkinRequestCounts(getDb());
}
