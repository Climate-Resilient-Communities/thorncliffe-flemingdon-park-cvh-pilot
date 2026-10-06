import { MARK_ROUTE, MarkRequestSchema } from "@/contracts/checkinRound";
import { readJson, staffError, staffJson, staffRoute } from "@/app/staff/guard";
import { markPlace, roundMarks } from "@/app/staff/ambassador/round/load";

export const dynamic = "force-dynamic";

/**
 * `POST /api/staff/ambassador/marks` (S08.07, A-04): one mark (done, not reached, needs help) with the id the page made when the ambassador tapped, naming the
 * row by its `round_ref`. The policy action is `checkins.mark`, judged on the floor of the row the `round_ref` names, read from the database (never the
 * request): an Ambassador who covers that floor now, or an Admin. A `round_ref` no row has (never was, or purged) names no floor, so an Ambassador is refused
 * there (403, recorded by the guard); the use case (checkins' `createMarks`) judges everyone again under the row's lock and refuses an expired stub or an
 * unknown `round_ref` (403, recorded, nothing recorded against the round). The answer says how the mark was taken (src/contracts/checkinRound.ts).
 */
export const POST = staffRoute(
  {
    route: MARK_ROUTE,
    access: "hub",
    action: "checkins.mark",
    context: async (request) => {
      const body = MarkRequestSchema.parse(await request.json());
      const place = await markPlace(body.round_ref);
      return place === null ? {} : { target: { rsn: place.rsn, floorId: place.floorId } };
    },
  },
  async (request, session) => {
    const body = await readJson(request, MarkRequestSchema);
    if (!body.ok) return body.response;
    const result = await roundMarks().mark({ staffId: session.staffId }, { markId: body.value.mark_id, roundRef: body.value.round_ref, status: body.value.status });
    return result.ok ? staffJson({ outcome: result.outcome }) : staffError(403, "forbidden");
  },
);
