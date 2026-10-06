// Which disruption types start a check-in round (S08.06, E08 "Round types", AD-12): `disruption_type.checkin`, the pilot's heat and power, which
// an Admin at aal2 changes on the coverage page. The staff guard has already refused anyone else (policy action `checkins.round_types`). A change
// is audited with the types before and after in its own transaction, a refused one as refused with its reason. It starts or ends no round by
// itself: the next approval reads the types in its own transaction (`roundTypes`, floorReader.ts), and the rows of a round already started stay
// until its thread closes.
import { asc, eq } from "drizzle-orm";
import type { Db, DbExecutor } from "../../../platform/db";
import { disruptionType } from "../adapters/schema";
import type { PlacesAudit } from "./ports";

/** A type of disruption as the control lists it: its id, and whether its approved alerts start a round now. */
export interface RoundTypeChoice {
  id: string;
  round: boolean;
}

/** `unknown_type`: the request names something that is not a type of disruption (a tampered form); `no_change`: those are the round types already. */
export type RoundTypesRefusal = "unknown_type" | "no_change";

export type RoundTypesResult = { ok: true; value: { roundTypes: string[]; previous: string[] } } | { ok: false; error: RoundTypesRefusal };

export interface RoundTypesService {
  /** Every type of disruption, by id, with whether it is a round type now. */
  list(executor?: DbExecutor): Promise<RoundTypeChoice[]>;
  /** Makes exactly these the round types (none is allowed: no alert then starts a round), as the Admin the guard let through. */
  set(actorStaffId: string, types: readonly unknown[]): Promise<RoundTypesResult>;
}

/** The most types a request may name: there are nine, and a longer list is not one the control sent. */
const MAX_TYPES = 20;
const TYPE_ID = /^[a-z][a-z_]{1,19}$/;

/** The audit reason of each refusal (the audit module's REFUSAL_REASONS). */
const REASONS: Record<RoundTypesRefusal, "validation" | "conflict"> = { unknown_type: "validation", no_change: "conflict" };

const SUBJECT = { subjectType: "disruption_type", subjectId: null } as const;

/** Found inside the transaction: nothing was written, and the refusal is audited after the rollback. */
class Refused extends Error {
  constructor(readonly error: RoundTypesRefusal) {
    super(error);
  }
}

const sameList = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((value, index) => value === b[index]);

export function createRoundTypes(deps: { db: Db; audit: PlacesAudit }): RoundTypesService {
  const { db, audit } = deps;
  return {
    async list(executor = db) {
      const rows = await executor.select({ id: disruptionType.id, round: disruptionType.checkin }).from(disruptionType).orderBy(asc(disruptionType.id));
      return rows;
    },

    async set(actorStaffId, types) {
      try {
        if (types.length > MAX_TYPES || types.some((type) => typeof type !== "string" || !TYPE_ID.test(type))) throw new Refused("unknown_type");
        const wanted = [...new Set(types as string[])].sort();
        const value = await db.transaction(async (tx) => {
          // Every type's row, locked in id order (FOR NO KEY UPDATE, the lock of the update below: a subscriber's muted topic, whose foreign key
          // takes FOR KEY SHARE, is not held up), so two Admins' changes run one after the other and each audits what it replaced.
          const rows = await tx.select({ id: disruptionType.id, round: disruptionType.checkin }).from(disruptionType).orderBy(asc(disruptionType.id)).for("no key update");
          const known = new Set(rows.map((row) => row.id));
          if (wanted.some((type) => !known.has(type))) throw new Refused("unknown_type");
          const previous = rows.filter((row) => row.round).map((row) => row.id);
          if (sameList(previous, wanted)) throw new Refused("no_change");
          for (const row of rows) {
            const round = wanted.includes(row.id);
            if (round !== row.round) await tx.update(disruptionType).set({ checkin: round }).where(eq(disruptionType.id, row.id));
          }
          await audit.record(tx, { action: "round_types.changed", actorStaffId, ...SUBJECT, meta: { round_types: wanted, previous } });
          return { roundTypes: wanted, previous };
        });
        return { ok: true, value };
      } catch (error) {
        if (!(error instanceof Refused)) throw error;
        await audit.recordRefusal(db, { action: "round_types.changed", actorStaffId, ...SUBJECT, meta: { reason: REASONS[error.error] } });
        return { ok: false, error: error.error };
      }
    },
  };
}
