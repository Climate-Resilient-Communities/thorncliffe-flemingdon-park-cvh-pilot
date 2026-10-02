import { isOdd } from "./odd";

export const isEven = (n: number): boolean => n === 0 || isOdd(n - 1);
