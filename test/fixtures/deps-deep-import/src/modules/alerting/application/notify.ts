// alerting --> messaging is declared, but only messaging's index.ts may be imported.
import { render } from "../../messaging/domain/smsBody";

export const notify = () => render("alert");
