import type { Shift, ConstructionState } from "../../../shared/types";
import { initialConstruction } from "../../construction/model/phases";

type Row = Record<string, unknown>;

function isRow(v: unknown): v is Row {
  return typeof v === "object" && v !== null;
}

/**
 * 存档迁移：
 * - v1 存档升级为 v2，补入施工领域初始状态；
 * - v2 存档做结构兜底；
 * 迁移后仍需通过 validShift 校验，失败则拒绝读取（绝不静默回滚施工）。
 */
export function migrateShift(value: unknown): Shift | undefined {
  if (!isRow(value)) return undefined;
  if (value.version === 2 && isRow(value.construction)) {
    return reconcile(value as unknown as Shift);
  }
  if (value.version !== 1) return undefined;

  const v1 = value as Row;
  const construction: ConstructionState = initialConstruction();
  const stands = Array.isArray(v1.stands) ? v1.stands : [];
  // 旧存档机位坐标即当前生效布局，登记为各机位的身份轨迹起点
  for (const stand of stands as Row[]) {
    if (
      typeof stand.id === "string" &&
      typeof stand.x === "number" &&
      typeof stand.y === "number"
    ) {
      construction.layout.standHistory[stand.id] = [
        { x: stand.x, y: stand.y },
      ];
    }
  }
  const migrated: Shift = {
    ...(v1 as unknown as Shift),
    version: 2,
    construction,
  };
  return reconcile(migrated);}

/** 结构兜底：补齐可能缺失的施工字段，并保证布局与机位状态自洽 */
function reconcile(state: Shift): Shift {
  const fallback = initialConstruction();
  const c = state.construction ?? fallback;
  c.layout = c.layout ?? fallback.layout;
  c.layout.closedZones ??= [];
  c.layout.temporaryRoads ??= [];
  c.layout.permanentRoads ??= [];
  c.layout.standHistory ??= {};
  c.phases ??= [];
  if (typeof c.budget !== "number") c.budget = fallback.budget;
  if (typeof c.materials !== "number") c.materials = fallback.materials;
  if (typeof c.nextPhaseSeq !== "number") c.nextPhaseSeq = 1;

  // 若存档中存在激活阶段但布局丢失了封闭区（异常存档），按阶段数据重建
  const active = c.phases.find((p) => p.status === "active");
  c.layout.activePhaseId = active?.id;
  if (active) {
    for (const z of active.zones) {
      if (!c.layout.closedZones.some((x) => x.id === z.id))
        c.layout.closedZones.push(z);
    }
    for (const r of active.temporaryRoads) {
      if (!c.layout.temporaryRoads.some((x) => x.id === r.id))
        c.layout.temporaryRoads.push(r);
    }
  }
  // 机位身份轨迹兜底：保证每个机位至少有一条历史坐标
  for (const stand of state.stands) {
    if (!c.layout.standHistory[stand.id])
      c.layout.standHistory[stand.id] = [{ x: stand.x, y: stand.y }];
  }
  return state;
}
