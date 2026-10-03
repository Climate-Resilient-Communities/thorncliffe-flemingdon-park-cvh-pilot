// The renderer reads the words of a text message: allowed.
import { smsStrings } from "../../../i18n/smsStrings";

export const render = (lang: string) => smsStrings(lang).stop;
