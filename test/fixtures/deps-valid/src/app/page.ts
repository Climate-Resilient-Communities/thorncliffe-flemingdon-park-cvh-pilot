import { raiseAlert } from "../modules/alerting";
import { now } from "../platform/clock";

export const render = () => raiseAlert(now());
