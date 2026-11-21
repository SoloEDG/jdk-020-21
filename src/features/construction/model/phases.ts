import type {
  ConstructionMode,
  ConstructionPhase,
  ConstructionState,
  ConstructionZone,
  Point,
  RoadPolyline,
  StandChange,
} from "../../../shared/types";

export interface PhaseTemplate {
  id: string;
  name: string;
  description: string;
  baseDuration: number;
  budgetCost: number;
  materialCost: number;
  dependsOn: string[];
  affectedStandIds: string[];
  changes: StandChange[];
  zones: Record<ConstructionMode, ConstructionZone[]>;
  temporaryRoads: RoadPolyline[];
}

/** 固定分期方案：阶段二依赖阶段一，机坪布局本身固定，改造只按既定模板进行 */
export const PHASE_TEMPLATES: PhaseTemplate[] = [
  {
    id: "P1",
    name: "A 排改造 · A02 扩容",
    description: "A02 平移并升级为宽体机位，施工期间封闭其进近支路",
    baseDuration: 90,
    budgetCost: 120,
    materialCost: 40,
    dependsOn: [],
    affectedStandIds: ["A02"],
    changes: [
      {
        standId: "A02",
        from: { x: 420, y: 250 },
        to: { x: 520, y: 300 },
        size: "wide",
      },
    ],
    zones: {
      // 临时通道：仅围合机位与前沿路局部，主通道保持通行
      temporary: [{ id: "P1-zone", x: 356, y: 158, width: 128, height: 120, cutsRoad: false }],
      // 整体封闭：截断主服务通道并覆盖机位进近支路，绕行更远但工期更短
      full: [{ id: "P1-zone", x: 340, y: 150, width: 160, height: 250, cutsRoad: true }],
    },
    temporaryRoads: [
      {
        id: "P1-bypass",
        temporary: true,
        points: [
          { x: 300, y: 178 },
          { x: 300, y: 150 },
          { x: 500, y: 150 },
          { x: 500, y: 178 },
        ],
      },
    ],
  },
  {
    id: "P2",
    name: "B 排扩容 · B02 宽体化",
    description: "B01 平移、B02 升级为宽体机位，依赖阶段一完工释放的资源",
    baseDuration: 120,
    budgetCost: 200,
    materialCost: 70,
    dependsOn: ["P1"],
    affectedStandIds: ["B01", "B02"],
    changes: [
      {
        standId: "B01",
        from: { x: 220, y: 495 },
        to: { x: 300, y: 540 },
      },
      {
        standId: "B02",
        from: { x: 420, y: 495 },
        to: { x: 560, y: 520 },
        size: "wide",
      },
    ],
    zones: {
      temporary: [
        { id: "P2-zone", x: 140, y: 430, width: 360, height: 200, cutsRoad: false },
      ],
      full: [
        { id: "P2-zone", x: 120, y: 330, width: 400, height: 300, cutsRoad: true },
      ],
    },
    temporaryRoads: [
      {
        id: "P2-bypass",
        temporary: true,
        points: [
          { x: 75, y: 606 },
          { x: 75, y: 400 },
          { x: 560, y: 400 },
          { x: 560, y: 606 },
        ],
      },
    ],
  },
];

const TEMP_DURATION_FACTOR = 1.6;
const TEMP_BUDGET_FACTOR = 1.3;
const TEMP_MATERIAL_EXTRA = 20;

export function modeDuration(template: PhaseTemplate, mode: ConstructionMode): number {
  return mode === "full"
    ? template.baseDuration
    : Math.round(template.baseDuration * TEMP_DURATION_FACTOR);
}
export function modeBudget(template: PhaseTemplate, mode: ConstructionMode): number {
  return mode === "full"
    ? template.budgetCost
    : Math.round(template.budgetCost * TEMP_BUDGET_FACTOR);
}
export function modeMaterials(template: PhaseTemplate, mode: ConstructionMode): number {
  return mode === "full"
    ? template.materialCost
    : template.materialCost + TEMP_MATERIAL_EXTRA;
}

export const modeLabels: Record<ConstructionMode, string> = {
  temporary: "临时通道",
  full: "整体封闭",
};

export function initialConstruction(): ConstructionState {
  return {
    phases: [],
    layout: {
      closedZones: [],
      temporaryRoads: [],
      permanentRoads: [],
      standHistory: {},
      activePhaseId: undefined,
    },
    nextPhaseSeq: 1,
    budget: 600,
    materials: 200,
  };
}

export function buildPhase(
  template: PhaseTemplate,
  mode: ConstructionMode,
  seq: number,
): ConstructionPhase {
  return {
    id: `${template.id}-${seq}`,
    name: template.name,
    mode,
    status: "planned",
    dependsOn: template.dependsOn,
    affectedStandIds: template.affectedStandIds,
    changes: template.changes.map((c) => ({
      ...c,
      from: { ...c.from },
      to: { ...c.to } as Point,
    })),
    zones: template.zones[mode].map((z) => ({ ...z })),
    temporaryRoads:
      mode === "temporary"
        ? template.temporaryRoads.map((r) => ({
            ...r,
            points: r.points.map((p) => ({ ...p })),
          }))
        : [],
    duration: modeDuration(template, mode),
    elapsed: 0,
    budgetCost: modeBudget(template, mode),
    materialCost: modeMaterials(template, mode),
    spentBudget: 0,
    spentMaterials: 0,
  };
}
