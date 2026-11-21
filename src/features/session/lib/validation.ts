import type { Shift } from "../../../shared/types";
const kinds = ["fuel", "baggage", "clean"];
const flightStates = [
  "scheduled",
  "incoming",
  "parked",
  "departing",
  "departed",
];
const serviceStates = ["pending", "travel", "working", "done"];
const vehicleStates = ["idle", "travel", "working", "returning"];
const phaseStates = ["planned", "active", "done"];
const modes = ["temporary", "full"];
type Row = Record<string, unknown>;
function row(value: unknown): value is Row {
  return typeof value === "object" && value !== null;
}
function finite(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
function text(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}
function point(value: unknown): boolean {
  return row(value) && finite(value.x) && finite(value.y);
}
function unique(values: Row[]): boolean {
  return (
    values.every((x) => text(x.id)) &&
    new Set(values.map((x) => x.id)).size === values.length
  );
}
function collection(value: unknown, length: number): value is Row[] {
  return (
    Array.isArray(value) &&
    value.length === length &&
    value.every(row) &&
    unique(value)
  );
}
function zone(value: unknown): boolean {
  return (
    row(value) &&
    text(value.id) &&
    finite(value.x) &&
    finite(value.y) &&
    finite(value.width) &&
    value.width > 0 &&
    finite(value.height) &&
    value.height > 0 &&
    typeof value.cutsRoad === "boolean"
  );
}
function road(value: unknown): boolean {
  return (
    row(value) &&
    text(value.id) &&
    typeof value.temporary === "boolean" &&
    Array.isArray(value.points) &&
    value.points.length >= 2 &&
    value.points.every(point)
  );
}
function validConstruction(value: unknown, standIds: Set<string>): boolean {
  if (!row(value)) return false;
  if (
    !finite(value.budget) ||
    value.budget < 0 ||
    !finite(value.materials) ||
    value.materials < 0 ||
    !finite(value.nextPhaseSeq) ||
    !row(value.layout) ||
    !Array.isArray(value.phases)
  )
    return false;
  const layout = value.layout as Row;
  if (
    !Array.isArray(layout.closedZones) ||
    !layout.closedZones.every(zone) ||
    !Array.isArray(layout.temporaryRoads) ||
    !layout.temporaryRoads.every(road) ||
    !Array.isArray(layout.permanentRoads) ||
    !layout.permanentRoads.every(road) ||
    !row(layout.standHistory)
  )
    return false;
  // 身份轨迹必须覆盖每个机位，且至少包含一个坐标点
  const history = layout.standHistory as Record<string, unknown>;
  for (const id of standIds) {
    const pts = history[id];
    if (!Array.isArray(pts) || pts.length === 0 || !pts.every(point))
      return false;
  }
  if (
    layout.activePhaseId !== undefined &&
    !text(layout.activePhaseId)
  )
    return false;

  const phases = value.phases as Row[];
  if (!unique(phases)) return false;
  let activeCount = 0;
  const phaseIds = new Set(phases.map((p) => p.id as string));
  for (const p of phases) {
    if (
      !text(p.name) ||
      !modes.includes(p.mode as string) ||
      !phaseStates.includes(p.status as string) ||
      !Array.isArray(p.dependsOn) ||
      !p.dependsOn.every((d: unknown) => typeof d === "string") ||
      !Array.isArray(p.affectedStandIds) ||
      !p.affectedStandIds.every((id: unknown) => standIds.has(id as string)) ||
      !Array.isArray(p.zones) ||
      !p.zones.every(zone) ||
      !Array.isArray(p.temporaryRoads) ||
      !p.temporaryRoads.every(road) ||
      !finite(p.duration) ||
      p.duration <= 0 ||
      !finite(p.elapsed) ||
      p.elapsed < 0 ||
      !finite(p.budgetCost) ||
      !finite(p.materialCost) ||
      !finite(p.spentBudget) ||
      !finite(p.spentMaterials)
    )
      return false;
    if (
      !Array.isArray(p.changes) ||
      !p.changes.every(
        (c: unknown) =>
          row(c) &&
          standIds.has(c.standId as string) &&
          point(c.from) &&
          point(c.to) &&
          (c.size === undefined ||
            ["narrow", "wide"].includes(c.size as string)),
      )
    )
      return false;
    // 已投入施工的阶段：占用资源必须真实记账，禁止“悄悄回滚”
    if (p.status !== "planned") {
      if (p.spentBudget !== p.budgetCost || p.spentMaterials !== p.materialCost)
        return false;
    } else {
      if (p.spentBudget !== 0 || p.spentMaterials !== 0 || p.elapsed !== 0)
        return false;
    }
    if (p.status === "active") {
      activeCount++;
      // 激活阶段的封闭区与临时道路必须存在于已生效布局中
      for (const z of p.zones as Row[]) {
        if (
          !(layout.closedZones as Row[]).some((x) => x.id === z.id)
        )
          return false;
      }
    }
    // 依赖只能指向已存在的阶段
    for (const dep of p.dependsOn as string[]) {
      if (![...phaseIds].some((pid) => pid.startsWith(`${dep}-`)))
        return false;
    }  }
  if (activeCount > 1) return false;
  if (activeCount === 1 && !text(layout.activePhaseId)) return false;
  if (activeCount === 0 && layout.activePhaseId !== undefined) return false;
  return true;
}
export function validShift(value: unknown): value is Shift {
  if (
    !row(value) ||
    value.version !== 2 ||
    !finite(value.time) ||
    value.time < 0 ||
    !finite(value.score) ||
    !finite(value.conflicts) ||
    value.conflicts < 0 ||
    typeof value.paused !== "boolean" ||
    ![1, 2, 4].includes(value.speed as number) ||
    !finite(value.nextEventId)
  )
    return false;
  if (
    !collection(value.flights, 6) ||
    !collection(value.stands, 6) ||
    !collection(value.vehicles, 6) ||
    !collection(value.services, 18) ||
    !Array.isArray(value.events) ||
    value.events.length > 30
  )
    return false;
  const flights = value.flights,
    stands = value.stands,
    vehicles = value.vehicles,
    services = value.services;
  const flightIds = new Set(flights.map((x) => x.id as string)),
    standIds = new Set(stands.map((x) => x.id as string)),
    vehicleIds = new Set(vehicles.map((x) => x.id as string)),
    serviceIds = new Set(services.map((x) => x.id as string));
  if (
    !flights.every(
      (f) =>
        text(f.airline) &&
        text(f.from) &&
        text(f.destination) &&
        text(f.aircraft) &&
        ["narrow", "wide"].includes(f.size as string) &&
        flightStates.includes(f.status as string) &&
        finite(f.arrival) &&
        finite(f.deadline) &&
        finite(f.passengers) &&
        f.passengers > 0 &&
        text(f.color) &&
        (f.departureAt === undefined || finite(f.departureAt)) &&
        (f.standId === undefined || standIds.has(f.standId as string)),
    )
  )
    return false;
  if (
    !stands.every(
      (s) =>
        point(s) &&
        ["narrow", "wide"].includes(s.size as string) &&
        text(s.terminal),
    )
  )
    return false;
  if (
    !vehicles.every(
      (v) =>
        kinds.includes(v.kind as string) &&
        vehicleStates.includes(v.status as string) &&
        point(v.position) &&
        point(v.origin) &&
        point(v.target) &&
        finite(v.progress) &&
        v.progress >= 0 &&
        v.progress <= 100 &&
        finite(v.tripDuration) &&
        v.tripDuration > 0 &&
        (v.serviceId === undefined || serviceIds.has(v.serviceId as string)) &&
        (v.path === undefined ||
          (Array.isArray(v.path) &&
            v.path.length >= 2 &&
            v.path.every(point))),
    )
  )
    return false;
  if (
    !services.every(
      (s) =>
        flightIds.has(s.flightId as string) &&
        kinds.includes(s.kind as string) &&
        serviceStates.includes(s.status as string) &&
        finite(s.progress) &&
        s.progress >= 0 &&
        s.progress <= 100 &&
        finite(s.duration) &&
        s.duration > 0 &&
        (s.vehicleId === undefined || vehicleIds.has(s.vehicleId as string)),
    )
  )
    return false;
  if (
    !flights.every((f) =>
      kinds.every(
        (k) =>
          services.filter((t) => t.flightId === f.id && t.kind === k).length ===
          1,
      ),
    )
  )
    return false;
  const occupied = flights
    .filter((f) => f.status !== "departed" && f.standId !== undefined)
    .map((f) => f.standId);
  if (new Set(occupied).size !== occupied.length) return false;
  if (
    !flights.every(
      (f) =>
        !["parked", "departing", "departed"].includes(f.status as string) ||
        (standIds.has(f.standId as string) &&
          (f.size === "narrow" ||
            stands.find((s) => s.id === f.standId)?.size === "wide")),
    )
  )
    return false;
  if (
    !services.every((s) => {
      if (s.status === "pending")
        return s.progress === 0 && s.vehicleId === undefined;
      const v = vehicles.find((x) => x.id === s.vehicleId);
      if (!v || v.kind !== s.kind) return false;
      if (s.status === "done") return s.progress === 100;
      return (
        v.serviceId === s.id &&
        v.status === s.status &&
        flights.find((f) => f.id === s.flightId)?.status === "parked"
      );
    })
  )
    return false;
  if (
    !vehicles.every(
      (v) =>
        !["travel", "working"].includes(v.status as string) ||
        services.some(
          (s) =>
            s.id === v.serviceId &&
            s.vehicleId === v.id &&
            s.status === v.status,
        ),
    )
  )
    return false;
  if (
    !flights.every(
      (f) =>
        services.filter(
          (t) =>
            t.flightId === f.id &&
            ["travel", "working"].includes(t.status as string),
        ).length <= 2,
    )
  )
    return false;
  if (
    !flights.every(
      (f) =>
        !["departing", "departed"].includes(f.status as string) ||
        services
          .filter((t) => t.flightId === f.id)
          .every((t) => t.status === "done"),
    )
  )
    return false;
  if (
    !value.events.every(
      (e) =>
        row(e) &&
        finite(e.id) &&
        finite(e.time) &&
        text(e.text) &&
        ["info", "success", "warning"].includes(e.tone as string),
    )
  )
    return false;
  const events = value.events as Row[];
  if (
    new Set(events.map((e) => e.id)).size !== events.length ||
    events.some((e) => (e.id as number) >= (value.nextEventId as number))
  )
    return false;
  if (!validConstruction(value.construction, standIds)) return false;
  return (
    flightIds.has(value.selectedFlightId as string) &&
    (value.selectedStandId === undefined ||
      standIds.has(value.selectedStandId as string)) &&
    (value.selectedVehicleId === undefined ||
      vehicleIds.has(value.selectedVehicleId as string))
  );
}
