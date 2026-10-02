// domain/ has no clock: the time is passed in.
import { now } from "../../../platform/clock";

export const isExpired = (until: Date) => until < now();
