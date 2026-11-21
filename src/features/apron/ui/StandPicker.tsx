import type { Shift } from "../../../shared/types";
import { compatibleStand, occupiedFlight } from "../lib/geometry";
import { networkFor, standReachable } from "../../construction/lib/network";
export function StandPicker({
  state,
  onAssign,
  onSelect,
}: {
  state: Shift;
  onAssign: (id: string) => void;
  onSelect: (id: string) => void;
}) {
  const f = state.flights.find((x) => x.id === state.selectedFlightId);
  if (!f || f.status !== "incoming") return null;
  const valid = state.stands.find((s) => s.id === state.selectedStandId);
  const net = networkFor(state);
  const reachable = (id: string) => standReachable(net, id);
  const blocked = (id: string) =>
    !!occupiedFlight(state, id) ||
    !compatibleStand(state.stands.find((s) => s.id === id)!, f) ||
    !reachable(id);
  return (
    <div className="stand-picker">
      <div className="hint-label">01 / 为航班分配机位</div>
      <div className="stand-choices">
        {state.stands.map((s) => (
          <button
            key={s.id}
            disabled={blocked(s.id)}
            className={s.id === state.selectedStandId ? "chosen" : ""}
            title={!reachable(s.id) ? "施工封闭：道路不可达" : undefined}
            onClick={() => onSelect(s.id)}
          >
            {s.id}
            {s.size === "wide" && <small>W</small>}
          </button>
        ))}
      </div>
      <button
        className="primary full"
        data-testid="assign-stand"
        disabled={!valid || blocked(valid.id)}
        onClick={() => valid && onAssign(valid.id)}
      >
        分配至 {valid?.id ?? "所选机位"} <span>↗</span>
      </button>
    </div>
  );
}
