// messaging --> alerting is not in the diagram, and routing it through src/app must not hide that.
import { raiseAlert } from "../../../app/wiring";

export const send = () => raiseAlert();
