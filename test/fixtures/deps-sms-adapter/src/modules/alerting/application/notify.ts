// alerting --> messaging is declared, but the Twilio adapter is not part of messaging's interface: another module
// sending a body of its own would bypass the one renderer.
import { sendThroughTwilio } from "../../messaging/adapters/twilioSms";

export const notify = (body: string) => sendThroughTwilio(body);
