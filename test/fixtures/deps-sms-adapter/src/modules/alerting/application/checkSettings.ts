// Another module reading messaging's Messaging Service settings adapter directly: not allowed either.
import { smartEncodingIsOn } from "../../messaging/adapters/serviceSettings";

export const checkSettings = () => smartEncodingIsOn();
