import type { Shift } from "../../../shared/types";
import { initialFlights } from "../../flights";
import { initialStands } from "../../apron";
import { initialServices } from "../../services";
import { initialVehicles } from "../../fleet";
import { initialConstruction } from "../../construction/model/phases";
export function createShift(): Shift {
  const flights = initialFlights();
  const stands = initialStands();
  const construction = initialConstruction();
  // 机位身份轨迹基线：新班次即记录各机位初始坐标，后续移动据此追溯同一机位
  for (const stand of stands) {
    construction.layout.standHistory[stand.id] = [{ x: stand.x, y: stand.y }];
  }
  return {
    version: 2,
    time: 0,
    paused: false,
    speed: 1,
    score: 0,
    conflicts: 0,
    flights,
    stands,
    services: initialServices(flights),
    vehicles: initialVehicles(),
    events: [
      { id: 0, time: 0, text: "早班开始 · 3 架航班等待机位分配", tone: "info" },
    ],
    selectedFlightId: "MU2451",
    nextEventId: 1,
    construction,
  };
}
