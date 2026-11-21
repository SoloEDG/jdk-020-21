import type {
  ConstructionZone,
  LayoutState,
  Point,
  RoadPolyline,
  Shift,
  Stand,
  Vehicle,
} from "../../../shared/types";

/* 固定基础路网：机坪布局固定，道路以折线节点建模，封闭区域会截断落入其中的路段 */
interface RoadDef {
  id: string;
  points: Point[];
}

const BASE_ROADS: RoadDef[] = [
  // 主滑行/服务通道（东西向，y=355）
  { id: "main", points: [{ x: 0, y: 355 }, { x: 940, y: 355 }] },
  // 南滑行道（y=606）
  { id: "south", points: [{ x: 0, y: 606 }, { x: 940, y: 606 }] },
  // 西侧联络道 x=75
  { id: "west", points: [{ x: 75, y: 355 }, { x: 75, y: 606 }] },
  // 东侧联络道 x=740
  { id: "east", points: [{ x: 740, y: 355 }, { x: 740, y: 606 }] },
  // 航站楼前沿服务路 y=178
  {
    id: "front",
    points: [
      { x: 120, y: 178 },
      { x: 300, y: 178 },
      { x: 500, y: 178 },
      { x: 730, y: 178 },
    ],
  },
  // 近机位 A 排进近支线（主通道 -> 前沿路）
  { id: "spur-A01", points: [{ x: 220, y: 355 }, { x: 220, y: 250 }] },
  { id: "spur-A02", points: [{ x: 420, y: 355 }, { x: 420, y: 250 }] },
  { id: "spur-A03", points: [{ x: 650, y: 355 }, { x: 650, y: 250 }] },
  // 远机位 B 排进近支线（主通道 -> 南滑行道之间）
  { id: "spur-B01", points: [{ x: 220, y: 355 }, { x: 220, y: 495 }] },
  { id: "spur-B02", points: [{ x: 420, y: 355 }, { x: 420, y: 495 }] },
  { id: "spur-B03", points: [{ x: 650, y: 355 }, { x: 650, y: 495 }] },
  // 车场出入线
  { id: "depot", points: [{ x: 740, y: 606 }, { x: 830, y: 480 }, { x: 850, y: 510 }] },
];

function key(p: Point): string {
  return `${Math.round(p.x)},${Math.round(p.y)}`;
}
/** 节点坐标归一化：切分点取整，保证道路交叉处落到同一节点 */
function norm(p: Point): Point {
  return { x: Math.round(p.x), y: Math.round(p.y) };
}
function dist(a: Point, b: Point): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}
function inZone(p: Point, z: ConstructionZone): boolean {
  return (
    p.x >= z.x &&
    p.x <= z.x + z.width &&
    p.y >= z.y &&
    p.y <= z.y + z.height
  );
}
/** 线段是否穿过封闭区域（采样判定，足够覆盖矩形围合） */
function segmentBlocked(a: Point, b: Point, zones: ConstructionZone[]): boolean {
  const steps = Math.max(2, Math.ceil(dist(a, b) / 18));
  for (let i = 0; i <= steps; i++) {
    const p = {
      x: a.x + ((b.x - a.x) * i) / steps,
      y: a.y + ((b.y - a.y) * i) / steps,
    };
    if (zones.some((z) => inZone(p, z))) return true;
  }
  return false;
}
/** 点 p 在线段 a-b 上的投影参数 t（仅处理水平/垂直/共线情形，路网均为正交折线） */
function projectT(a: Point, b: Point, p: Point): number {
  const dx = b.x - a.x,
    dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  if (len2 === 0) return 0;
  let t: number;
  if (Math.abs(dx) >= Math.abs(dy)) t = (p.x - a.x) / dx;
  else t = (p.y - a.y) / dy;
  // 正交路网：投影后必须与线段吻合（另一坐标一致），否则不属于该线段
  const onLine =
    Math.abs(a.x + dx * t - p.x) < 1.5 &&
    Math.abs(a.y + dy * t - p.y) < 1.5;
  return onLine ? t : -1;
}

export interface RoadNetwork {
  nodes: Map<string, Point>;
  adj: Map<string, { to: string; w: number; roadId: string }[]>;
  /** 每个机位的道路接入点 */
  standGates: Map<string, Point>;
  depotGate: Point;
}

function buildNetwork(
  roads: RoadDef[],
  zones: ConstructionZone[],
  standGates: Map<string, Point>,
  depotGate: Point,
): RoadNetwork {
  const nodes = new Map<string, Point>();
  const adj = new Map<string, { to: string; w: number; roadId: string }[]>();
  const add = (p: Point) => {
    const np = norm(p);
    const k = key(np);
    if (!nodes.has(k)) {
      nodes.set(k, np);
      adj.set(k, []);
    }
    return k;
  };
  const edge = (a: Point, b: Point, roadId: string) => {
    const ka = add(a),
      kb = add(b);
    if (ka === kb) return;
    const w = dist(nodes.get(ka)!, nodes.get(kb)!);
    adj.get(ka)!.push({ to: kb, w, roadId });
    adj.get(kb)!.push({ to: ka, w, roadId });
  };
  // 长直路切分为短边：封闭区域只截断落入其中的局部路段，而非整条道路。
  // 先汇总所有道路的真实拐点作为共享切分点，保证不同道路在交叉处落在同一节点。
  const CHUNK = 40;
  // 共享拐点坐标表
  const junctionPoints = new Map<string, Point>();
  for (const r of roads)
    for (const p of r.points) junctionPoints.set(key(norm(p)), norm(p));
  const junctionKeys = new Set(junctionPoints.keys());
  const linkRoad = (a: Point, b: Point, roadId: string) => {
    const na = norm(a),
      nb = norm(b);
    const total = dist(na, nb);
    // 收集该线段上的等距切分点与落在其上的共享拐点
    const cuts: { t: number; p: Point }[] = [];
    const pieces = Math.max(1, Math.ceil(total / CHUNK));
    for (let i = 1; i < pieces; i++) {
      cuts.push({
        t: i / pieces,
        p: norm({
          x: na.x + (nb.x - na.x) * (i / pieces),
          y: na.y + (nb.y - na.y) * (i / pieces),
        }),
      });
    }
    for (const jk of junctionKeys) {
      const jp = junctionPoints.get(jk);
      if (!jp) continue;
      const t = projectT(na, nb, jp);
      if (t > 0.001 && t < 0.999) cuts.push({ t, p: norm(jp) });
    }
    cuts.sort((x, y) => x.t - y.t);
    let prev = na;
    for (const c of cuts) {
      if (segmentBlocked(prev, c.p, zones)) {
        prev = c.p;
        continue;
      }
      edge(prev, c.p, roadId);
      prev = c.p;
    }
    if (!segmentBlocked(prev, nb, zones)) edge(prev, nb, roadId);
  };
  for (const r of roads) {
    for (let i = 0; i < r.points.length - 1; i++) {
      linkRoad(r.points[i], r.points[i + 1], r.id);
    }
  }
  // 机位接入点始终登记为节点；连接段受封闭区截断后，该节点成为孤立点即代表失联，
  // 不能让机位绕过被封闭的进近支路“直线接入”主路
  for (const [, gate] of standGates) {
    add(gate);
    let nearest: Point | undefined;
    let best = Infinity;
    for (const p of nodes.values()) {
      if (key(p) === key(gate)) continue;
      const d = dist(gate, p);
      if (d < best) {
        best = d;
        nearest = p;
      }
    }
    if (
      nearest &&
      best > 0.01 &&
      best < 260 &&
      !segmentBlocked(gate, nearest, zones)
    )
      edge(gate, nearest, "gate");
  }
  // 车场接入：同样先登记节点，连接被截断时为孤立点
  add(depotGate);
  let nearest: Point | undefined;
  let best = Infinity;
  for (const p of nodes.values()) {
    if (key(p) === key(depotGate)) continue;
    const d = dist(depotGate, p);
    if (d < best) {
      best = d;
      nearest = p;
    }
  }
  if (nearest && best > 0.01 && !segmentBlocked(depotGate, nearest, zones))
    edge(depotGate, nearest, "gate");
  return { nodes, adj, standGates, depotGate };
}

function dijkstra(
  net: RoadNetwork,
  from: Point,
  to: Point,
): { path: Point[]; length: number } | undefined {
  const start = key(from),
    goal = key(to);
  // 端点可能是孤立接入点（如车场），确保其存在于节点表中
  if (!net.nodes.has(start) || !net.nodes.has(goal)) return undefined;
  if (!net.adj.has(start)) net.adj.set(start, []);
  if (!net.adj.has(goal)) net.adj.set(goal, []);
  const prev = new Map<string, string>();
  const best = new Map<string, number>();
  const queue = new Map<string, number>();
  queue.set(start, 0);
  best.set(start, 0);
  while (queue.size) {
    let cur = "",
      curD = Infinity;
    for (const [k, d] of queue) {
      if (d < curD) {
        curD = d;
        cur = k;
      }
    }
    queue.delete(cur);
    if (cur === goal) {
      const chain: Point[] = [];
      let k: string | undefined = goal;
      while (k) {
        chain.unshift(net.nodes.get(k)!);
        k = prev.get(k);
      }
      return { path: chain, length: curD };
    }
    for (const e of net.adj.get(cur) ?? []) {
      const nd = curD + e.w;
      if (nd < (best.get(e.to) ?? Infinity)) {
        best.set(e.to, nd);
        queue.set(e.to, nd);
        prev.set(e.to, cur);
      }
    }
  }
  return undefined;
}

/** 机位服务点（车辆实际停靠位置，与地图渲染保持一致） */
export function standServicePoint(stand: Stand): Point {
  return { x: stand.x + 42, y: stand.y + 22 };
}

function currentRoads(layout: LayoutState): RoadDef[] {
  const extra = [
    ...layout.temporaryRoads,
    ...layout.permanentRoads,
  ].map<RoadDef>((r: RoadPolyline) => ({
    id: r.id,
    points: r.points,
  }));
  return [...BASE_ROADS, ...extra];
}

/** 基于一份已生效布局构建路网（地图、机位分配、车辆路线共用同一份） */
export function networkFor(state: Shift): RoadNetwork {
  const gates = new Map<string, Point>();
  for (const s of state.stands) gates.set(s.id, standServicePoint(s));
  return buildNetwork(
    currentRoads(state.construction.layout),
    state.construction.layout.closedZones,
    gates,
    { x: 830, y: 480 },
  );
}

/** 预览用：在指定封闭区域与临时道路假设下构建路网（不写入状态） */
export function networkForHypothetical(
  state: Shift,
  zones: ConstructionZone[],
  extraRoads: RoadPolyline[],
): RoadNetwork {
  const gates = new Map<string, Point>();
  for (const s of state.stands) gates.set(s.id, standServicePoint(s));
  const roads = [
    ...currentRoads(state.construction.layout),
    ...extraRoads.map((r) => ({ id: r.id, points: r.points })),
  ];
  return buildNetwork(roads, zones, gates, { x: 830, y: 480 });
}

export function findRoute(
  net: RoadNetwork,
  from: Point,
  to: Point,
): { path: Point[]; length: number } | undefined {
  return dijkstra(net, from, to);
}

function nearestNode(net: RoadNetwork, p: Point): Point | undefined {
  let best: Point | undefined;
  let d = Infinity;
  for (const n of net.nodes.values()) {
    const nd = dist(p, n);
    if (nd < d) {
      d = nd;
      best = n;
    }
  }
  return best;
}

/**
 * 实际调度使用：任意起点/终点（如车辆当前位置）先吸附到最近路网节点，
 * 返回包含真实端点的折线与总里程。
 * 终点（机位接入点/车场）若因封闭完全脱离路网则直接判定不可达，
 * 不能吸附到邻近节点后“穿墙”进入施工区；起点吸附段视为车辆安全驶离，
 * 不做封闭截断（已获准进入的车辆允许从区内撤出）。
 */
export function planRoute(
  net: RoadNetwork,
  from: Point,
  to: Point,
): { path: Point[]; length: number } | undefined {
  // 终点必须真实存在于路网（机位 gate / 车场 gate 由 buildNetwork 登记）
  if (!net.nodes.has(key(to))) return undefined;
  const startNode = net.nodes.has(key(from)) ? from : nearestNode(net, from);
  const endNode = net.nodes.has(key(to)) ? to : nearestNode(net, to);
  if (!startNode || !endNode) return undefined;
  const hit = dijkstra(net, startNode, endNode);
  if (!hit) return undefined;
  const path: Point[] = [];
  // 起点真实位置 -> 吸附节点：逃生段，不检查封闭
  if (key(from) !== key(startNode)) path.push({ ...from });
  for (const p of hit.path) path.push(p);
  if (key(to) !== key(endNode)) path.push({ ...to });
  return { path, length: pathLength(path) };
}

export function standReachable(
  net: RoadNetwork,
  standId: string,
): boolean {
  const gate = net.standGates.get(standId);
  if (!gate) return false;
  return !!dijkstra(net, net.depotGate, gate);
}

/** 沿折线按总长度比例取点（车辆沿道路行驶用） */
export function pointAlongPath(path: Point[], fraction: number): Point {
  if (path.length === 0) return { x: 0, y: 0 };
  if (path.length === 1) return path[0];
  const lengths = path.slice(1).map((p, i) => dist(path[i], p));
  const total = lengths.reduce((a, b) => a + b, 0) || 1;
  let target = total * Math.min(1, Math.max(0, fraction));
  for (let i = 0; i < lengths.length; i++) {
    if (target <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : target / lengths[i];
      return {
        x: path[i].x + (path[i + 1].x - path[i].x) * t,
        y: path[i].y + (path[i + 1].y - path[i].y) * t,
      };
    }
    target -= lengths[i];
  }
  return path[path.length - 1];
}

export function pathLength(path: Point[]): number {
  return path
    .slice(1)
    .reduce((sum, p, i) => sum + dist(path[i], p), 0);
}

/** 车辆当前是否处于封闭区域内（用于已进入车辆的安全驶离判定） */
export function vehicleInsideZone(v: Vehicle, zones: ConstructionZone[]): boolean {
  return zones.some((z) => inZone(v.position, z));
}
