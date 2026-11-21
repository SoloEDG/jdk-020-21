export type ServiceKind = "baggage" | "fuel" | "clean";
export type FlightStatus =
  | "scheduled"
  | "incoming"
  | "parked"
  | "departing"
  | "departed";
export interface Point {
  x: number;
  y: number;
}
export interface Flight {
  id: string;
  airline: string;
  from: string;
  destination: string;
  aircraft: string;
  size: "narrow" | "wide";
  arrival: number;
  deadline: number;
  passengers: number;
  status: FlightStatus;
  standId?: string;
  departureAt?: number;
  color: string;
}
export interface Stand extends Point {
  id: string;
  size: "narrow" | "wide";
  terminal: string;
}
export interface Service {
  id: string;
  flightId: string;
  kind: ServiceKind;
  status: "pending" | "travel" | "working" | "done";
  progress: number;
  duration: number;
  vehicleId?: string;
}
export interface Vehicle {
  id: string;
  kind: ServiceKind;
  status: "idle" | "travel" | "working" | "returning";
  position: Point;
  origin: Point;
  target: Point;
  progress: number;
  tripDuration: number;
  serviceId?: string;
  /** 已生效布局下的路网折线（沿道路行驶），缺省时退化为直线段 */
  path?: Point[];
}
export interface Event {
  id: number;
  time: number;
  text: string;
  tone: "info" | "success" | "warning";
}

/* ---------- 施工领域 ---------- */
export type ConstructionMode = "temporary" | "full";
export type PhaseStatus =
  | "planned" // 已保存方案，等待前序完成
  | "active" // 已确认施工，正在占用资源
  | "done"; // 已完工，变更已生效且不可回滚
export interface ConstructionZone {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
  /** 该区域截断道路的等级：full 封闭主干道，temporary 仅围合机位并保留临时绕行 */
  cutsRoad: boolean;
}
export interface RoadPolyline {
  id: string;
  points: Point[];
  temporary: boolean;
}
export interface StandChange {
  standId: string;
  from: Point;
  to: Point;
  /** 升级后的机位尺寸；不传表示尺寸不变 */
  size?: "narrow" | "wide";
}
export interface ConstructionPhase {
  id: string;
  name: string;
  mode: ConstructionMode;
  status: PhaseStatus;
  /** 必须全部完工（done）才能启动本阶段 */
  dependsOn: string[];
  affectedStandIds: string[];
  changes: StandChange[];
  /** 激活后立即封闭的区域 */
  zones: ConstructionZone[];
  /** 临时通道模式下随阶段生效的绕行道路 */
  temporaryRoads: RoadPolyline[];
  duration: number;
  elapsed: number;
  budgetCost: number;
  materialCost: number;
  /** 已实际占用的资源（用于保证不可悄悄回滚） */
  spentBudget: number;
  spentMaterials: number;
}
export interface LayoutState {
  /** 当前生效的封闭区域（激活中的阶段叠加） */
  closedZones: ConstructionZone[];
  /** 当前生效的临时道路 */
  temporaryRoads: RoadPolyline[];
  /** 已完工阶段留下的永久道路（临时通道转正） */
  permanentRoads: RoadPolyline[];
  /** 机位身份轨迹：standId -> 历次坐标，历史记录可据此认出同一机位 */
  standHistory: Record<string, Point[]>;
  activePhaseId?: string;
}
export interface ConstructionState {
  phases: ConstructionPhase[];
  layout: LayoutState;
  nextPhaseSeq: number;
  budget: number;
  materials: number;
}

export interface Shift {
  version: 2;
  time: number;
  paused: boolean;
  speed: 1 | 2 | 4;
  score: number;
  conflicts: number;
  flights: Flight[];
  stands: Stand[];
  services: Service[];
  vehicles: Vehicle[];
  events: Event[];
  selectedFlightId: string;
  selectedStandId?: string;
  selectedVehicleId?: string;
  nextEventId: number;
  construction: ConstructionState;
}
export type CommandResult = (state: Shift) => Shift;
