import type {
  ConstructionMode,
  ConstructionPhase,
  Shift,
  Vehicle,
} from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { PHASE_TEMPLATES } from "./phases";
import { previewPhase } from "../lib/preview";
import {
  networkFor,
  planRoute,
  standServicePoint,
  vehicleInsideZone,
} from "../lib/network";

/** 激活前的硬阻断检查（不把当前待激活阶段自身算作排队冲突） */
function activationBlockers(s: Shift, phase: ConstructionPhase): string[] {
  const out: string[] = [];
  const cs = s.construction;
  const templateDone = (dep: string) =>
    cs.phases.some(
      (p) => p.status === "done" && p.id.startsWith(`${dep}-`),
    );
  for (const dep of phase.dependsOn) {
    if (!templateDone(dep)) out.push(`前置阶段 ${dep} 尚未完工`);
  }
  if (cs.budget < phase.budgetCost)
    out.push(`预算不足：需要 ${phase.budgetCost}，剩余 ${cs.budget}`);
  if (cs.materials < phase.materialCost)
    out.push(`物料不足：需要 ${phase.materialCost}，剩余 ${cs.materials}`);
  if (cs.layout.activePhaseId) out.push("已有施工阶段进行中");
  for (const standId of phase.affectedStandIds) {
    const parked = s.flights.find(
      (f) => f.standId === standId && f.status !== "departed",
    );
    if (parked) out.push(`机位 ${standId} 仍有停靠飞机 ${parked.id}`);
    for (const v of s.vehicles) {
      if (v.status !== "working" || !v.serviceId) continue;
      const task = s.services.find((t) => t.id === v.serviceId);
      const f = s.flights.find((x) => x.id === task?.flightId);
      if (f?.standId === standId)
        out.push(`机位 ${standId} 有正在作业车辆 ${v.id}`);
    }
  }
  return out;
}

/** 将阶段加入分期方案（仅排队，不占用资源、不改变地图） */
export function queuePhase(
  state: Shift,
  templateId: string,
  mode: ConstructionMode,
): Shift {
  const preview = previewPhase(state, templateId, mode);
  if (!preview) return state;
  if (preview.blocked.length) {
    const s = copyShift(state);
    s.conflicts++;
    s.score -= 10;
    record(s, `施工方案被驳回：${preview.blocked[0]}`, "warning");
    return s;
  }
  const s = copyShift(state);
  s.construction.phases.push(preview.phase);
  s.construction.nextPhaseSeq++;
  record(
    s,
    `分期方案已保存：${preview.phase.name}（${mode === "full" ? "整体封闭" : "临时通道"}），确认施工后才会占用资源`,
  );
  return s;
}

/** 取消尚未施工的方案：未投入即无沉没成本；已投入阶段不可取消、不可回滚 */
export function cancelPlannedPhase(state: Shift, phaseId: string): Shift {
  const phase = state.construction.phases.find((p) => p.id === phaseId);
  if (!phase || phase.status !== "planned") {
    const s = copyShift(state);
    record(s, "已投入施工的阶段无法撤销，资源与变更均保留", "warning");
    return s;
  }
  const s = copyShift(state);
  s.construction.phases = s.construction.phases.filter(
    (p) => p.id !== phaseId,
  );
  record(s, `已取消未施工方案：${phase.name}`);
  return s;
}

function evacuateVehicles(s: Shift, phase: ConstructionPhase): void {
  const net = networkFor(s);
  for (const v of s.vehicles) {
    if (!vehicleInsideZone(v, phase.zones)) continue;
    if (v.status === "working") continue; // 硬阻断已在激活前拦截，理论不可达
    // 区内车辆：先吸附到封闭区外最近的可达节点，再沿路网安全驶离
    const escape = nearestEscapeNode(net, v.position, phase.zones);
    if (!escape) {
      v.status = "idle";
      v.serviceId = undefined;
      record(s, `${v.id} 所在道路被整体封闭，驻车等待道路恢复`, "warning");
      continue;
    }
    const out = planRoute(net, escape, net.depotGate);
    if (out) {
      v.path = [{ ...v.position }, ...out.path];
      v.origin = { ...v.position };
      v.target = { ...net.depotGate };
      v.progress = 0;
      v.tripDuration = Math.max(4, 5 + out.length / 50);
      if (v.status === "idle") v.status = "returning";
      record(s, `${v.id} 已在施工区内，沿可用道路安全驶离`, "warning");
    } else {
      v.status = "idle";
      v.serviceId = undefined;
      record(s, `${v.id} 所在道路被整体封闭，驻车等待道路恢复`, "warning");
    }
  }
}

/** 找封闭区外、距离车辆最近且与车场连通的路网节点 */
function nearestEscapeNode(
  net: ReturnType<typeof networkFor>,
  from: { x: number; y: number },
  zones: ConstructionPhase["zones"],
): { x: number; y: number } | undefined {
  let best: { x: number; y: number } | undefined;
  let bestD = Infinity;
  for (const p of net.nodes.values()) {
    if (zones.some((z) => p.x >= z.x && p.x <= z.x + z.width && p.y >= z.y && p.y <= z.y + z.height))
      continue;
    const d = Math.hypot(p.x - from.x, p.y - from.y);
    if (d < bestD) {
      const reachable = planRoute(net, p, net.depotGate);
      if (reachable) {
        bestD = d;
        best = p;
      }
    }
  }
  return best;
}

function rerouteMovingVehicles(s: Shift, phase: ConstructionPhase): void {
  const net = networkFor(s);
  for (const v of s.vehicles) {
    if (v.status !== "travel" && v.status !== "returning") continue;
    if (vehicleInsideZone(v, phase.zones)) continue; // 已由 evacuate 处理
    const destination = v.target;
    const out = planRoute(net, v.position, destination);
    if (out && out.path.length > 1) {
      v.path = out.path;
      v.origin = { ...v.position };
      v.target = { ...destination };
      v.progress = 0;
      v.tripDuration = Math.max(4, 5 + out.length / 50);
    } else if (!out) {
      // 目标已不可达：返回车场，调度系统不再向封闭区派车
      const back = planRoute(net, v.position, net.depotGate);
      if (back) {
        v.path = back.path;
        v.origin = { ...v.position };
        v.target = { ...net.depotGate };
        v.progress = 0;
        v.tripDuration = Math.max(4, 5 + back.length / 50);
        v.status = "returning";
        const task = s.services.find((t) => t.id === v.serviceId);
        if (task) task.status = "pending";
        record(s, `${v.id} 目标机位已不可达，调度撤回并改回车场`, "warning");
      }
    }
  }
}

/** 确认施工：再次硬校验 → 占用资源 → 封闭区域/临时道路立即生效 → 车辆改道 */
export function activatePhase(state: Shift, phaseId: string): Shift {
  const s = copyShift(state);
  const phase = s.construction.phases.find((p) => p.id === phaseId);
  if (!phase || phase.status !== "planned") return state;

  // 二次硬校验（排队后状态可能变化）：依赖、资源、占用物均需仍然满足
  const blockers = activationBlockers(s, phase);
  if (blockers.length) {
    s.conflicts++;
    s.score -= 10;
    record(s, `施工确认失败：${blockers[0]}`, "warning");
    return s;
  }

  // 真正占用资源（预览从不占用）
  s.construction.budget -= phase.budgetCost;
  s.construction.materials -= phase.materialCost;
  phase.spentBudget = phase.budgetCost;
  phase.spentMaterials = phase.materialCost;
  phase.status = "active";

  // 变更即时反映到同一份已生效布局
  s.construction.layout.closedZones.push(...phase.zones);
  s.construction.layout.temporaryRoads.push(...phase.temporaryRoads);
  s.construction.layout.activePhaseId = phase.id;

  // 机位身份轨迹：确保每个机位都有坐标基线，受影响机位记录移动前位置
  for (const stand of s.stands) {
    if (!s.construction.layout.standHistory[stand.id]) {
      s.construction.layout.standHistory[stand.id] = [
        { x: stand.x, y: stand.y },
      ];
    }
  }
  for (const c of phase.changes) {
    const stand = s.stands.find((x) => x.id === c.standId);
    if (stand && s.construction.layout.standHistory[c.standId].length === 0) {
      s.construction.layout.standHistory[c.standId] = [
        { x: stand.x, y: stand.y },
      ];
    }
  }

  // 受影响机位在施工期间不可再分配
  // 已进入车辆先安全驶离，再对其余在途车辆按新路网重新检查可达性
  evacuateVehicles(s, phase);
  rerouteMovingVehicles(s, phase);

  record(
    s,
    `施工开始：${phase.name} · 预算 -${phase.budgetCost} / 物料 -${phase.materialCost} · 预计 ${phase.duration}s`,
    "success",
  );
  return s;
}

/** 施工推进：完工前已投入资源绝不回滚；完工后机位变更落地、临时道路转正 */
export function advanceConstruction(state: Shift, seconds: number): Shift {
  const activeId = state.construction.layout.activePhaseId;
  if (!activeId) return state;
  const s = copyShift(state);
  const phase = s.construction.phases.find((p) => p.id === activeId);
  if (!phase || phase.status !== "active") return s;
  phase.elapsed += seconds;
  if (phase.elapsed < phase.duration) return s;

  // 完工：机位身份不变，坐标/尺寸落地，历史轨迹追加
  for (const c of phase.changes) {
    const stand = s.stands.find((x) => x.id === c.standId);
    if (stand) {
      stand.x = c.to.x;
      stand.y = c.to.y;
      if (c.size) stand.size = c.size;
    }
    const history = s.construction.layout.standHistory[c.standId];
    if (history) history.push({ ...c.to });
  }
  // 封闭解除、临时道路转为永久道路（地图与车辆路线继续基于同一份布局）
  s.construction.layout.closedZones = s.construction.layout.closedZones.filter(
    (z) => !phase.zones.some((pz) => pz.id === z.id),
  );
  for (const r of phase.temporaryRoads) {
    s.construction.layout.temporaryRoads =
      s.construction.layout.temporaryRoads.filter((x) => x.id !== r.id);
    s.construction.layout.permanentRoads.push({ ...r, temporary: false });
  }
  phase.status = "done";
  s.construction.layout.activePhaseId = undefined;
  record(
    s,
    `施工完工：${phase.name} · 机位 ${phase.affectedStandIds.join("、")} 变更已生效（身份保持不变）`,
    "success",
  );
  return s;
}

/** 调度派遣前的可达性检查：未进入施工区的调度必须基于当前已生效布局重新检查 */
export function dispatchReachable(state: Shift, standId: string): boolean {
  const net = networkFor(state);
  const stand = state.stands.find((x) => x.id === standId);
  if (!stand) return false;
  const route = planRoute(net, net.depotGate, standServicePoint(stand));
  return !!route;
}

/** 派遣时沿当前路网规划实际行驶路线 */
export function routeForDispatch(
  state: Shift,
  vehicle: Vehicle,
  standId: string,
): { path: Shift["vehicles"][number]["path"]; duration: number } | undefined {
  const net = networkFor(state);
  const stand = state.stands.find((x) => x.id === standId);
  if (!stand) return undefined;
  const route = planRoute(net, vehicle.position, standServicePoint(stand));
  if (!route) return undefined;
  return {
    path: route.path,
    duration: 5 + route.length / 50,
  };
}

export function returnRouteFor(
  state: Shift,
  vehicle: Vehicle,
): { path: NonNullable<Vehicle["path"]>; duration: number } | undefined {
  const net = networkFor(state);
  const route = planRoute(net, vehicle.position, net.depotGate);
  if (!route) return undefined;
  return { path: route.path, duration: Math.max(4, 5 + route.length / 50) };
}

export function templateOf(phaseId: string) {
  return PHASE_TEMPLATES.find((t) => phaseId.startsWith(`${t.id}-`));
}
