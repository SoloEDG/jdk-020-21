import type {
  ConstructionMode,
  ConstructionPhase,
  Shift,
  Stand,
} from "../../../shared/types";
import {
  findRoute,
  networkFor,
  networkForHypothetical,
  standReachable,
  standServicePoint,
} from "./network";
import {
  PHASE_TEMPLATES,
  buildPhase,
} from "../model/phases";

export interface StandImpact {
  standId: string;
  reachable: boolean;
  /** 车场 -> 机位当前道路里程（米） */
  currentDistance: number;
  /** 施工假设下的道路里程，不可达时为 null */
  futureDistance: number | null;
  detour: number | null;
  /** 施工后该机型是否仍可接纳（机位升级会改变可接纳机型） */
  acceptsNarrow: boolean;
  acceptsWide: boolean;
}

export interface FlightImpact {
  flightId: string;
  standId?: string;
  /** 预计延误秒数（绕远里程折算 + 不可达惩罚） */
  expectedDelay: number;
  reachable: boolean;
  reason?: string;
}

export interface ImpactPreview {
  phase: ConstructionPhase;
  blocked: string[];
  warnings: string[];
  standImpacts: StandImpact[];
  flightImpacts: FlightImpact[];
  totalExpectedDelay: number;
  unreachableStands: string[];
  newlyWide: string[];
  remainingBudget: number;
  remainingMaterials: number;
}

function tripSecondsFor(length: number): number {
  // 与既有规则一致：5 秒基础 + 里程 / 50
  return 5 + length / 50;
}

/** 纯预览：不修改状态，只计算“假如确认施工”的预计影响 */
export function previewPhase(
  state: Shift,
  templateId: string,
  mode: ConstructionMode,
): ImpactPreview | undefined {
  const template = PHASE_TEMPLATES.find((t) => t.id === templateId);
  if (!template) return undefined;
  const phase = buildPhase(template, mode, state.construction.nextPhaseSeq);
  const blocked: string[] = [];
  const warnings: string[] = [];

  // 依赖检查
  const templateDone = (dep: string) =>
    state.construction.phases.some(
      (p) => p.status === "done" && p.id.startsWith(`${dep}-`),
    );
  for (const dep of phase.dependsOn) {
    if (!templateDone(dep))
      blocked.push(`前置阶段 ${dep} 尚未完工，无法启动本阶段`);
  }

  // 资源检查（预览只提示，确认时才真正占用）
  const cs = state.construction;
  if (cs.budget < phase.budgetCost)
    blocked.push(`预算不足：需要 ${phase.budgetCost}，剩余 ${cs.budget}`);
  if (cs.materials < phase.materialCost)
    blocked.push(`物料不足：需要 ${phase.materialCost}，剩余 ${cs.materials}`);

  // 同模板已有在途/排队阶段
  if (
    cs.phases.some(
      (p) =>
        p.id.startsWith(`${template.id}-`) && p.status !== "done",
    )
  )
    blocked.push("该分期已有进行中或排队的施工");
  if (cs.layout.activePhaseId)
    blocked.push("当前已有施工阶段进行中，需先完工");

  // 停靠飞机 / 作业车辆检查（不能直接覆盖）
  for (const standId of phase.affectedStandIds) {
    const parked = state.flights.find(
      (f) => f.standId === standId && f.status !== "departed",
    );
    if (parked) blocked.push(`机位 ${standId} 仍有停靠飞机 ${parked.id}`);
    const working = state.vehicles.filter(
      (v) => v.status === "working" && v.serviceId,
    );
    for (const v of working) {
      const task = state.services.find((t) => t.id === v.serviceId);
      const f = state.flights.find((x) => x.id === task?.flightId);
      if (f?.standId === standId)
        blocked.push(`机位 ${standId} 有正在作业车辆 ${v.id}`);
    }
  }

  // 假设性路网：当前封闭区 + 新阶段封闭区 + 新阶段临时道路
  const baseNet = networkFor(state);
  const futureZones = [...cs.layout.closedZones, ...phase.zones];
  const futureNet = networkForHypothetical(
    state,
    futureZones,
    phase.temporaryRoads,
  );

  const changeSize = new Map(
    phase.changes
      .filter((c) => c.size)
      .map((c) => [c.standId, c.size!]),
  );
  const newlyWide: string[] = [];

  const standImpacts: StandImpact[] = state.stands.map((stand: Stand) => {
    const gate = standServicePoint(stand);
    const cur = findRoute(baseNet, baseNet.depotGate, gate);
    const fut = findRoute(futureNet, futureNet.depotGate, gate);
    const size = changeSize.get(stand.id) ?? stand.size;
    if (changeSize.get(stand.id) === "wide" && stand.size === "narrow")
      newlyWide.push(stand.id);
    return {
      standId: stand.id,
      reachable: standReachable(futureNet, stand.id),
      currentDistance: cur ? Math.round(cur.length) : 0,
      futureDistance: fut ? Math.round(fut.length) : null,
      detour: cur && fut ? Math.round(fut.length - cur.length) : null,
      acceptsNarrow: true,
      acceptsWide: size === "wide",
    };
  });

  const unreachableStands = standImpacts
    .filter((x) => !x.reachable)
    .map((x) => x.standId);
  if (unreachableStands.length)
    warnings.push(
      `施工期间 ${unreachableStands.join("、")} 将与车场失联，进港航班无法分配`,
    );

  // 航班预计影响：绕远折算延误，失联机位上的在港航班按严重延误预估
  const flightImpacts: FlightImpact[] = state.flights
    .filter((f) => f.status !== "departed")
    .map((f) => {
      const impact = standImpacts.find((x) => x.standId === f.standId);
      if (!impact) {
        // 尚未分配机位：看可选机位是否全部失联
        const options = state.stands.filter(
          (s) => f.size === "narrow" || s.size === "wide",
        );
        const live = options.filter((o) =>
          standReachable(futureNet, o.id),
        );
        const expectedDelay =
          live.length === 0
            ? 180
            : Math.max(
                0,
                ...live.map((o) => {
                  const cur = findRoute(
                    baseNet,
                    baseNet.depotGate,
                    standServicePoint(o),
                  );
                  const fut = findRoute(
                    futureNet,
                    futureNet.depotGate,
                    standServicePoint(o),
                  );
                  return cur && fut
                    ? (tripSecondsFor(fut.length) -
                        tripSecondsFor(cur.length)) *
                        2
                    : 0;
                }),
              );
        return {
          flightId: f.id,
          expectedDelay: Math.round(expectedDelay),
          reachable: live.length > 0,
          reason: live.length === 0 ? "无可达兼容机位" : undefined,
        };
      }
      if (!impact.reachable) {
        return {
          flightId: f.id,
          standId: f.standId,
          expectedDelay: 180,
          reachable: false,
          reason: "停靠机位将被封闭隔离",
        };
      }
      const detourSeconds =
        impact.detour && impact.detour > 0
          ? (impact.detour / 50) * 2 // 进出两次保障行程
          : 0;
      return {
        flightId: f.id,
        standId: f.standId,
        expectedDelay: Math.round(detourSeconds),
        reachable: true,
      };
    });

  const totalExpectedDelay = flightImpacts.reduce(
    (sum, x) => sum + x.expectedDelay,
    0,
  );

  return {
    phase,
    blocked,
    warnings,
    standImpacts,
    flightImpacts,
    totalExpectedDelay,
    unreachableStands,
    newlyWide,
    remainingBudget: cs.budget - phase.budgetCost,
    remainingMaterials: cs.materials - phase.materialCost,
  };
}
