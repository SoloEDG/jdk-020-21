import type { Shift } from "../../../shared/types";
import { copyShift, record } from "../../../shared/document";
import { serviceCatalog } from "./catalog";
import { returnRouteFor } from "../../construction/model/commands";
export function advanceServices(state: Shift, seconds: number): Shift {
  const s = copyShift(state);
  for (const task of s.services) {
    if (task.status !== "working") continue;
    task.progress = Math.min(
      100,
      task.progress + (seconds / task.duration) * 100,
    );
    if (task.progress === 100) {
      task.status = "done";
      const v = s.vehicles.find((x) => x.id === task.vehicleId);
      if (v) {
        v.status = "returning";
        v.origin = { ...v.position };
        v.target = { x: 830, y: 480 };
        v.progress = 0;
        // 施工可能已改变回程路线：基于当前布局重新规划，失败则保留直线兜底
        const back = returnRouteFor(s, v);
        if (back) {
          v.path = back.path;
          v.tripDuration = back.duration;
        } else {
          v.path = undefined;
          v.tripDuration = 10;
        }
      }
      record(
        s,
        `${task.flightId} ${serviceCatalog[task.kind].label}完成`,
        "success",
      );
    }
  }
  return s;
}
