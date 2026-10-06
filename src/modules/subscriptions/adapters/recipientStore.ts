// The recipient query (S07.07, AD-7, AR-11): which subscribers an alert's text is for. It is `matches` (src/contracts/audience.ts) written in SQL, and the
// property test (test/db/recipientQuery.db.test.ts) holds the two together on thousands of generated audiences and profiles. Ids and languages only: a phone
// number is never selected here.
//
// The profile of a subscriber, as AudienceProfile describes it for SMS: `neighbourhoodIds` is the one `subscriber.neighbourhood_id` (so never empty), `places` has one
// entry per distinct `rsn` of the subscriber's `subscriber_place` rows with `floors` the non-null `floor_id`s of those rows (a building whose rows all have a null floor
// is "no floor recorded there"), `groups` is `subscriber.groups` and `mutedTopics` the `subscriber_topic_optout` rows.
import { sql, type SQL } from "drizzle-orm";
import { SAFETY_OVERRIDE_TYPES, type Audience } from "../../../contracts/audience";
import type { LangCode } from "../../../contracts/lang";
import type { DbExecutor, DbTransaction } from "../../../platform/db";
import { RECEIVING_STATES } from "./subscriberStore";

/**
 * The states in which a subscriber gets alerts (epics, "Receiving subscriber"), built from the one list `phoneOf` also uses at the hand-off, so the reviewed count and
 * the texts sent cannot disagree.
 * TODO(E09, S09.07 reconsent campaign): a `reconsent_pending` subscriber receives only before the campaign deadline. That rule must change here AND in
 * `subscriberStore.phoneOf` together (both read RECEIVING_STATES today).
 */
const RECEIVING = sql`s.retention_state in (${sql.join(RECEIVING_STATES.map((state) => sql`${state}`), sql`, `)})`;

/** A subscriber the alert reaches: their id and the language they chose. */
export interface RecipientRow {
  id: string;
  lang: LangCode;
}

const json = (value: unknown) => sql`${JSON.stringify(value)}::jsonb`;

/**
 * The SQL of `matches(audience, profile)` for the subscriber aliased `s`: the topic rule (a mute counts only when every type of the alert is muted, and never for
 * fire), the groups rule (none named: no narrowing; else the subscriber chose one of them) and the place rule (a neighbourhood audience: their neighbourhood is
 * one of its; a buildings audience: they recorded one of its buildings and, when it lists floors there, one of them or none in that building).
 */
export function matchesSql(audience: Audience): SQL {
  const topics = audience.types.some((type) => SAFETY_OVERRIDE_TYPES.includes(type))
    ? sql`true`
    : sql`not coalesce((
        select bool_and(t.type in (select o.topic from subscriber_topic_optout o where o.subscriber_id = s.id))
        from jsonb_array_elements_text(${json(audience.types)}) as t(type)
      ), false)`;
  const groups = audience.groups.length === 0 ? sql`true` : sql`s.groups && array(select jsonb_array_elements_text(${json(audience.groups)}))::text[]`;
  const place =
    audience.scope === "neighbourhood"
      ? sql`s.neighbourhood_id in (select jsonb_array_elements_text(${json(audience.neighbourhood_ids)}))`
      : sql`exists (
          select 1 from jsonb_array_elements(${json(audience.buildings)}) as w(item)
          where exists (select 1 from subscriber_place p where p.subscriber_id = s.id and p.rsn = w.item->>'rsn')
            and (
              jsonb_typeof(w.item->'floors') = 'null'
              or not exists (select 1 from subscriber_place p where p.subscriber_id = s.id and p.rsn = w.item->>'rsn' and p.floor_id is not null)
              or exists (
                select 1 from subscriber_place p, jsonb_array_elements_text(w.item->'floors') as f(id)
                where p.subscriber_id = s.id and p.rsn = w.item->>'rsn' and p.floor_id::text = f.id
              )
            )
        )`;
  return sql`(${topics} and ${groups} and ${place})`;
}

/** "Reached whatever they muted or where they live now": a subscriber an earlier entry of the thread was queued to text (corrections, withdrawals and finals). */
function earlier(ids: readonly string[]): SQL {
  return ids.length === 0 ? sql`false` : sql`s.id in (select jsonb_array_elements_text(${json(ids)})::uuid)`;
}

const reaches = (audience: Audience, earlierIds: readonly string[]) => sql`${RECEIVING} and (${matchesSql(audience)} or ${earlier(earlierIds)})`;

const rowsOf = (rows: Iterable<{ id: string; lang: string }>): RecipientRow[] => [...rows].map((row) => ({ id: row.id, lang: row.lang as LangCode }));

export const recipientStore = {
  /**
   * The receiving subscribers the audience matches, plus those of `earlierIds` (subscribers still there, opt-outs and moves not removing them), in id order.
   * Reads and locks nothing: the reviewed count.
   */
  async reached(executor: DbExecutor, audience: Audience, earlierIds: readonly string[] = []): Promise<RecipientRow[]> {
    return rowsOf(await executor.execute<{ id: string; lang: string }>(sql`select s.id, s.lang from subscriber s where ${reaches(audience, earlierIds)} order by s.id`));
  },

  /**
   * The same, read inside the approval's transaction with every one of them locked `FOR SHARE`, in id order (AD-18's lock order). Three statements, so a change
   * that was committed while the approval waited for a row is seen: (1) the candidates, (2) their rows locked (a delete, which locks the subscriber `FOR UPDATE`,
   * or an edit, `FOR NO KEY UPDATE`, waits here for the approval to commit, and one that committed first has its row gone or new), (3) the rule applied again to the locked rows,
   * which is the answer. A subscriber who signs up, changes places or unsubscribes meanwhile is then wholly in or wholly out, never half of each.
   */
  async reachedForShare(tx: DbTransaction, audience: Audience, earlierIds: readonly string[] = []): Promise<RecipientRow[]> {
    const candidates = await tx.execute<{ id: string }>(sql`select s.id from subscriber s where ${reaches(audience, earlierIds)} order by s.id`);
    if (candidates.length === 0) return [];
    const ids = [...candidates].map((row) => row.id);
    const locked = await tx.execute<{ id: string }>(sql`
      select s.id from subscriber s where s.id in (select jsonb_array_elements_text(${json(ids)})::uuid) order by s.id for share of s`);
    if (locked.length === 0) return [];
    const lockedIds = [...locked].map((row) => row.id);
    return rowsOf(
      await tx.execute<{ id: string; lang: string }>(sql`
        select s.id, s.lang from subscriber s
        where s.id in (select jsonb_array_elements_text(${json(lockedIds)})::uuid) and ${reaches(audience, earlierIds)}
        order by s.id`),
    );
  },
};
