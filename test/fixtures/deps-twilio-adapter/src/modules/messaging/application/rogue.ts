// messaging's own application code reaching a Twilio adapter directly: not allowed. Only the index re-exports it.
import { twilioMessageSubmitter } from "../adapters/twilioMessagingService";

export const rogue = () => twilioMessageSubmitter()("hello");
