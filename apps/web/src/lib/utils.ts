import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function decisionLabel(d: string | null): string {
  if (!d) return "";
  return d.replace("accept-", "");
}

export const decisionWeight: Record<string, number> = {
  "accept-oral": 3,
  "accept-spotlight": 2,
  "accept-poster": 1,
  "accept": 1,
};
