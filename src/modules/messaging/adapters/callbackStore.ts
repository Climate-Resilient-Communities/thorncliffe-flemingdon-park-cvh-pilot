import { and, eq, isNotNull } from "drizzle-orm";
import type { CallbackStore } from "../application/statusCallback";
import { viewOf } from "./deliveryStore";
import { delivery } from "./schema";

/**
 * The delivery table as the status callbacks use it (S06.04), with Drizzle. The row is selected `FOR UPDATE` by its `callback_ref` (a unique
 * index), the same row lock the dispatcher's hand-off and outcome write, the sweep and a cancellation take, so a callback and any of them
 * are serialised on the row: the one that commits first wins, and the others (their statements name the state they expect) find the
 * row as it then is. The change is conditional on the state that was read under the lock, and from `claimed` on the hand-off too, as the
 * `delivery_guard` trigger requires; the trigger refuses everything the transition table does not have, so these statements cannot
 * write a move the table forbids even if the rules above them were wrong. The app role may update only the columns written here.
 */
export const drizzleCallbackStore: CallbackStore = {
  async lockByCallbackRef(tx, ref) {
    const [row] = await tx.select().from(delivery).where(eq(delivery.callbackRef, ref)).for("update");
    return row ? viewOf(row) : null;
  },

  async applyCallback(tx, { id, from, to, providerMessageId, errorCode }) {
    const [row] = await tx
      .update(delivery)
      .set({
        state: to,
        ...(providerMessageId === null ? {} : { providerMessageId }),
        ...(errorCode === null ? {} : { providerErrorCode: errorCode }),
      })
      .where(and(eq(delivery.id, id), eq(delivery.state, from), from === "claimed" ? isNotNull(delivery.handedOffAt) : undefined))
      .returning();
    return row ? viewOf(row) : null;
  },
};
