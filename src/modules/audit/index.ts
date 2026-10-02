// TEMPORARY STUB from S02.09 (branch e02-s09-guide-content). S01.04 (the audit module) is built in
// parallel and REPLACES this file at merge: take S01.04's version of src/modules/audit/index.ts and
// delete this one. It only gives the guide seed the interface S01.04 exports, so the seed compiles
// and calls it inside its transaction; it writes nothing.

export interface AuditEventInput {
  action: "seed.run";
  actorStaffId: null;
  subjectType: string;
  subjectId: string | null;
  meta?: object;
}

/** Records an audit event inside the caller's transaction `tx`. (Stub: records nothing.) */
export async function record(tx: unknown, event: AuditEventInput): Promise<void> {
  void tx;
  void event;
}
