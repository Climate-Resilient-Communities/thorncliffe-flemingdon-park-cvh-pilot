// Outside the resident queries (the lifecycle's own code) the base tables are what it works on.
import { alert } from "../adapters/schema";

export const settle = () => alert.name;
