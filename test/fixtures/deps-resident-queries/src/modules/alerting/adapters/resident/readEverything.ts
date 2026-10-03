// Not allowed: a resident query that reads the base table could return a drill.
import { alert } from "../schema";

export const readEverything = () => alert.name;
