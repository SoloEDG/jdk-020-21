import type { Shift } from "../../../shared/types";
import { validShift } from "./validation";
import { migrateShift } from "./migration";
const key = "apron07-shift-v2";
const legacyKey = "apron07-shift-v1";
export function saveShift(state: Shift): void {
  localStorage.setItem(key, JSON.stringify(state));
}
export function loadShift(): Shift | undefined {
  try {
    const raw = localStorage.getItem(key) ?? localStorage.getItem(legacyKey);
    if (!raw) return undefined;
    const value: unknown = JSON.parse(raw);
    const migrated = migrateShift(value);
    return migrated && validShift(migrated) ? migrated : undefined;
  } catch {
    return undefined;
  }
}
