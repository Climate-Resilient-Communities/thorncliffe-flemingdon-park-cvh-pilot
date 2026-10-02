import { now } from "../../../platform/clock";
import { send } from "../../messaging";
import { isOpen } from "../domain/lifecycle";

export const raiseAlert = (at: Date = now()) => isOpen(at) && send("alert");
