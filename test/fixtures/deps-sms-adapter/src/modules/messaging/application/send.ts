// Inside messaging, its own code reaches its adapters: allowed (the Twilio adapters have a stricter rule of their own, tested with deps-twilio-adapter).
import { recordInsteadOfSending } from "../adapters/fakeSms";
import { smartEncodingIsOn } from "../adapters/serviceSettings";

export const send = (body: string) => (smartEncodingIsOn() ? 0 : recordInsteadOfSending(body));
