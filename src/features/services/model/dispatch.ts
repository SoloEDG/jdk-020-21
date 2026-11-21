import type { Shift, ServiceKind } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { serviceBlockReason } from "../lib/eligibility";
import { serviceCatalog } from "./catalog";
import { dispatchReachable, routeForDispatch } from "../../construction/model/commands";
export function dispatchService(
  state: Shift,
  flightId: string,
  kind: ServiceKind,
  vehicleId: string,
): Shift {
  const s = copyShift(state),
    reason = serviceBlockReason(s, flightId, kind),
    v = s.vehicles.find((x) => x.id === vehicleId),
    f = s.flights.find((x) => x.id === flightId),
    stand = s.stands.find((x) => x.id === f?.standId),
    task = s.services.find((x) => x.flightId === flightId && x.kind === kind);
  if (
    reason ||
    !v ||
    v.status !== "idle" ||
    v.kind !== kind ||
    !stand ||
    !task
  ) {
    s.conflicts++;
    s.score -= 10;
    record(s, reason ?? "车辆不可用或车辆类型不匹配", "warning");
    return s;
  }
  // 未进入施工区的新调度：基于当前已生效布局重新检查可达性
  if (!dispatchReachable(s, stand.id)) {
    s.conflicts++;
    s.score -= 10;
    record(s, `机位 ${stand.id} 当前被施工封闭隔离，无法派遣车辆`, "warning");
    return s;
  }
  const planned = routeForDispatch(s, v, stand.id);
  if (!planned) {
    s.conflicts++;
    s.score -= 10;
    record(s, "路网中找不到可达机位的行驶路线", "warning");
    return s;
  }
  task.status = "travel";
  task.vehicleId = v.id;
  v.status = "travel";
  v.serviceId = task.id;
  v.origin = { ...v.position };
  v.target = { x: stand.x + 42, y: stand.y + 22 };
  v.path = planned.path;
  v.progress = 0;
  v.tripDuration = planned.duration;
  record(s, `${v.id} → ${flightId} · ${serviceCatalog[kind].label}`);
  return s;
}
