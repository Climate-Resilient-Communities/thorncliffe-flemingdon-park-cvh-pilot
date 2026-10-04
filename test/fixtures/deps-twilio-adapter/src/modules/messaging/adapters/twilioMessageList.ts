// A Twilio adapter of messaging that takes the other one's helper: adapters may use each other.
import { twilioMessageSubmitter } from "./twilioMessagingService";

export const twilioMessageLister = () => twilioMessageSubmitter()("list");
