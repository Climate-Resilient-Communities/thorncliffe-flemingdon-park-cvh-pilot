// Another module taking the Twilio adapter by its file: not allowed.
import { twilioMessageLister } from "../../messaging/adapters/twilioMessageList";

export const notify = () => twilioMessageLister();
