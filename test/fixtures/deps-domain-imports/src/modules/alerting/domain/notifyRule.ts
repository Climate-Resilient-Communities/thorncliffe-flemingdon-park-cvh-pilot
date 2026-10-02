// alerting --> messaging is declared, but only application/ may import another module.
import { send } from "../../messaging";

export const shouldNotify = () => send("alert");
