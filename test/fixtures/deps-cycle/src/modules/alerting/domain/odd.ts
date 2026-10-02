import { isEven } from "./even";

export const isOdd = (n: number): boolean => n !== 0 && isEven(n - 1);
