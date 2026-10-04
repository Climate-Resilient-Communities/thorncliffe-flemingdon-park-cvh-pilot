// app --> messaging through the index is declared (what src/app/dispatch.ts and src/app/reconcile.ts do); the graph cannot tell which names it takes,
// so test/twilioAdapterCallers.test.ts lists the files that name a Twilio adapter's exports.
import { twilioMessageSubmitter } from "../modules/messaging";

export const page = () => twilioMessageSubmitter();
