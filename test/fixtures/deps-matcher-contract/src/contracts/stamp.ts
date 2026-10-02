// Another file in contracts may import platform code: only the matcher is held to being pure.
import { now } from "../platform/clock";

export const stamp = () => now();
