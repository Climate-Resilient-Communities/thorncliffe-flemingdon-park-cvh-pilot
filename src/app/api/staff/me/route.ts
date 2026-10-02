import { GATE_PAGES, type StaffMe } from "@/contracts/staffAuth";
import { staffJson, staffRoute } from "@/app/staff/guard";

export const dynamic = "force-dynamic";

/** `GET /api/staff/me`: who is signed in and the setup gate they are at. Reachable at every gate. */
export const GET = staffRoute({ route: "/api/staff/me", access: "any_gate" }, async (_request, session) => {
  const me: StaffMe = {
    staffId: session.staffId,
    username: session.username,
    firstName: session.firstName,
    lastName: session.lastName,
    role: session.role,
    gate: session.gate,
    aal: session.aal,
    next: GATE_PAGES[session.gate],
  };
  return staffJson(me);
});
