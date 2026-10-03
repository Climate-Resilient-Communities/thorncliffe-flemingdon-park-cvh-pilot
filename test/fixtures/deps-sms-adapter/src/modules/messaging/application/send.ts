// Inside messaging, its own code reaches its adapters: allowed.
import { recordInsteadOfSending } from "../adapters/fakeSms";
import { sendThroughTwilio } from "../adapters/twilioSms";

export const send = (body: string) => sendThroughTwilio(body) + recordInsteadOfSending(body);
