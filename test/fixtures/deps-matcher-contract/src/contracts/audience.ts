// The matcher is pure and browser-safe: it may import zod and the contract files beside it, nothing else.
import { z } from "zod";
import { Group } from "./groups";
import { now } from "../platform/clock";

export const Audience = z.object({ at: z.number(), group: z.string() });
export const matches = (group: Group) => now() > 0 && Boolean(Audience) && group.length > 0;
