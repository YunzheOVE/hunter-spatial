import createGraph, { type Graph, type Link, type Node } from "ngraph.graph";
import { aStar } from "ngraph.path";

export type RoutingNode = {
  coordinates: [number, number];
  building: string;
  level: number;
};

export type RoutingEdge = {
  from: string;
  to: string;
  distance: number;
  type: "walk" | "stairs" | "elevator" | "escalator" | "bridge" | "vertical";
  accessible: boolean;
};

export type RoutingRoom = {
  building: string;
  level: number;
  nodeId: string;
  name: string;
};

export type RoutingGraphData = {
  nodes: Record<string, RoutingNode>;
  edges: RoutingEdge[];
  rooms: Record<string, RoutingRoom>;
  restrictedRoomNodes?: string[];
};

export type RouteLeg = {
  building: string;
  level: number;
  toLevel?: number;
  coordinates: [number, number][];
  distanceMeters: number;
};

export type RouteTransition = {
  type: "stairs" | "elevator" | "escalator" | "bridge" | "connector";
  fromBuilding: string;
  fromLevel: number;
  toBuilding: string;
  toLevel: number;
  location: [number, number];
  toLocation?: [number, number];
  distanceMeters?: number;
  description: string;
};

export type RouteResult = {
  fromRoom: string;
  toRoom: string;
  totalDistanceMeters: number;
  estimatedSeconds: number;
  nodePath: string[];
  legs: RouteLeg[];
  transitions: RouteTransition[];
  summary: string;
};

export type FindRouteOptions = {
  accessibleOnly?: boolean;
  indoorOnly?: boolean;
};

const STOREY_HEIGHT_M = 3.5;
const WALKING_SPEED_MPS = 1.2; // ~4.3 km/h average indoor walk speed
const STAIRS_EFFORT_PENALTY = 8.0; // equivalent extra meters for stair climbing
const ELEVATOR_WAIT_PENALTY = 25.0; // equivalent extra meters for elevator wait
const ROOM_PASSTHROUGH_PENALTY = 500.0; // equivalent extra meters to avoid cutting through private rooms/classrooms

export const CAMPUS_BUILDING_NAMES: Record<string, string> = {
  W: "West Building",
  N: "North Building",
  E: "East Building",
  TH: "Thomas Hunter Hall",
  BTB: "Baker Theatre",
};

let cachedGraphData: RoutingGraphData | null = null;

export async function fetchRoutingGraph(url: string = "/data/routing-graph.json"): Promise<RoutingGraphData> {
  if (cachedGraphData) return cachedGraphData;
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Failed to load routing graph from ${url} (${response.status})`);
  }
  const data = (await response.json()) as RoutingGraphData;
  cachedGraphData = data;
  return data;
}

export function setCachedRoutingGraph(data: RoutingGraphData) {
  cachedGraphData = data;
}

function haversineMeters(c1: [number, number], c2: [number, number]): number {
  const [lon1, lat1] = c1;
  const [lon2, lat2] = c2;
  const R = 6371000.0;
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const dphi = ((lat2 - lat1) * Math.PI) / 180;
  const dlam = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dphi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(dlam / 2) ** 2;
  return 2.0 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1.0 - a));
}

export function createPathfindingGraph(
  data: RoutingGraphData,
  accessibleOnly: boolean = false,
  indoorOnly: boolean = true
): Graph<RoutingNode, RoutingEdge> {
  const graph = createGraph<RoutingNode, RoutingEdge>();

  for (const [id, node] of Object.entries(data.nodes)) {
    if (indoorOnly && !node.building) {
      continue;
    }
    graph.addNode(id, node);
  }

  for (const edge of data.edges) {
    if (accessibleOnly && !edge.accessible) {
      continue;
    }
    if (indoorOnly) {
      const fromNode = data.nodes[edge.from];
      const toNode = data.nodes[edge.to];
      if (!fromNode?.building || !toNode?.building) {
        continue;
      }
    }
    // Add bidirectional edge in graph
    graph.addLink(edge.from, edge.to, edge);
    graph.addLink(edge.to, edge.from, edge);
  }

  return graph;
}

export function resolveRoom(
  graphData: RoutingGraphData,
  query: string
): { roomId: string; room: RoutingRoom } | null {
  const trimmed = query.trim();
  if (!trimmed) return null;

  // 1. Exact key match
  if (graphData.rooms[trimmed]) {
    return { roomId: trimmed, room: graphData.rooms[trimmed] };
  }

  const upper = trimmed.toUpperCase();
  if (graphData.rooms[upper]) {
    return { roomId: upper, room: graphData.rooms[upper] };
  }

  // 2. Normalize prefixes (e.g. HW-305 -> W305, HN11007 -> N11007)
  const normalized = upper.replace(/^H([NEW])/, "$1").replace(/-/g, "");
  if (graphData.rooms[normalized]) {
    return { roomId: normalized, room: graphData.rooms[normalized] };
  }

  // 3. Compact facility code aliases (e.g. N9M -> N9-MEN, N10W -> N10-WOMEN, N9MEN -> N9-MEN)
  const facilityCodeMatch = upper.match(/^([A-Z]{1,3})(\d+|C|B\d*)-?(MEN|WOMEN|ALLGENDER|RESTROOM|W|M)$/);
  if (facilityCodeMatch) {
    const [, bld, flr, typeCode] = facilityCodeMatch;
    const mappedType = typeCode === "M" ? "MEN" : typeCode === "W" ? "WOMEN" : typeCode;
    const targetKey = `${bld}${flr}-${mappedType}`;
    if (graphData.rooms[targetKey]) {
      return { roomId: targetKey, room: graphData.rooms[targetKey] };
    }
  }

  // 4. Match room by exact name or case-insensitive key
  for (const [key, room] of Object.entries(graphData.rooms)) {
    if (key.toUpperCase() === upper || room.name.toUpperCase() === upper) {
      return { roomId: key, room };
    }
  }

  // 5. Natural language facility search (e.g. "men's washroom at north 10th floor", "washroom north 10")
  const isWashroom = /\b(washroom|restroom|toilet|bathroom|bathrooms|restrooms|washrooms)\b/i.test(trimmed);
  const isMen = /\b(men'?s?|male|guys?|boys?)\b/i.test(trimmed);
  const isWomen = /\b(women'?s?|female|ladies|girls?)\b/i.test(trimmed);
  const isAllGender = /\b(all\s*gender|gender\s*neutral|unisex)\b/i.test(trimmed);

  if (isWashroom || isMen || isWomen || isAllGender) {
    let category: "MEN" | "WOMEN" | "ALLGENDER" | null = null;
    if (isAllGender) category = "ALLGENDER";
    else if (isWomen) category = "WOMEN";
    else if (isMen) category = "MEN";

    let requestedBuilding: string | null = null;
    if (/\b(north|hn)\b/i.test(trimmed)) requestedBuilding = "N";
    else if (/\b(west|hw)\b/i.test(trimmed)) requestedBuilding = "W";
    else if (/\b(east|he)\b/i.test(trimmed)) requestedBuilding = "E";
    else if (/\b(thomas\s*hunter|thomas|th)\b/i.test(trimmed)) requestedBuilding = "TH";
    else if (/\b(baker|theatre|theater|btb)\b/i.test(trimmed)) requestedBuilding = "BTB";
    else {
      const bMatch = trimmed.match(/\b(?:building|tower|hall)?\s*([nwe]|th|btb)\b/i);
      if (bMatch) requestedBuilding = bMatch[1].toUpperCase();
    }

    let requestedLevel: number | null = null;
    if (/\bconcourse\b/i.test(trimmed)) requestedLevel = 0;
    else if (/\b(ground|first|1st)\b/i.test(trimmed)) requestedLevel = 1;
    else if (/\b(second|2nd)\b/i.test(trimmed)) requestedLevel = 2;
    else if (/\b(third|3rd)\b/i.test(trimmed)) requestedLevel = 3;
    else if (/\b(fourth|4th)\b/i.test(trimmed)) requestedLevel = 4;
    else if (/\b(fifth|5th)\b/i.test(trimmed)) requestedLevel = 5;
    else if (/\b(sixth|6th)\b/i.test(trimmed)) requestedLevel = 6;
    else if (/\b(seventh|7th)\b/i.test(trimmed)) requestedLevel = 7;
    else if (/\b(eighth|8th)\b/i.test(trimmed)) requestedLevel = 8;
    else if (/\b(ninth|9th)\b/i.test(trimmed)) requestedLevel = 9;
    else if (/\b(tenth|10th)\b/i.test(trimmed)) requestedLevel = 10;
    else {
      const lvlMatch = trimmed.match(/\b(?:level|floor|fl|l|f)?\s*(\d+)(?:st|nd|rd|th)?\s*(?:level|floor|fl)?\b/i);
      if (lvlMatch) {
        requestedLevel = parseInt(lvlMatch[1], 10);
      }
    }

    const candidates: Array<{ key: string; room: RoutingRoom; score: number }> = [];
    for (const [key, room] of Object.entries(graphData.rooms)) {
      const nameLower = room.name.toLowerCase();
      const isRoomWashroom =
        key.includes("-MEN") ||
        key.includes("-WOMEN") ||
        key.includes("-ALLGENDER") ||
        key.includes("-RESTROOM") ||
        /\b(washroom|restroom|toilet|bathroom)\b/i.test(nameLower);

      if (!isRoomWashroom) continue;

      const isRoomMen = key.includes("-MEN") || (/\b(men'?s?|male)\b/i.test(nameLower) && !/\b(women'?s?|female)\b/i.test(nameLower));
      const isRoomWomen = key.includes("-WOMEN") || /\b(women'?s?|female)\b/i.test(nameLower);
      const isRoomAllGender = key.includes("-ALLGENDER") || /\b(all\s*gender|gender\s*neutral|unisex)\b/i.test(nameLower);

      if (category === "MEN" && (!isRoomMen || isRoomWomen)) continue;
      if (category === "WOMEN" && !isRoomWomen) continue;
      if (category === "ALLGENDER" && !isRoomAllGender) continue;

      let score = 0;
      if (requestedBuilding) {
        if (room.building === requestedBuilding) {
          score -= 1000;
        } else {
          score += 1000;
        }
      }

      if (requestedLevel !== null) {
        score += Math.abs(room.level - requestedLevel) * 10;
      }

      candidates.push({ key, room, score });
    }

    if (candidates.length > 0) {
      candidates.sort((a, b) => a.score - b.score);
      const best = candidates[0];
      return { roomId: best.key, room: best.room };
    }
  }

  // 6. Substring match for room names
  for (const [key, room] of Object.entries(graphData.rooms)) {
    if (room.name.toUpperCase().includes(upper)) {
      return { roomId: key, room };
    }
  }

  return null;
}

export function findRoute(
  graphData: RoutingGraphData,
  fromRoomId: string,
  toRoomId: string,
  options: FindRouteOptions = {}
): RouteResult | null {
  const startResolved = resolveRoom(graphData, fromRoomId);
  const targetResolved = resolveRoom(graphData, toRoomId);

  if (!startResolved || !targetResolved) {
    return null;
  }

  const startRoom = startResolved.room;
  const targetRoom = targetResolved.room;
  const startKey = startResolved.roomId;
  const targetKey = targetResolved.roomId;

  const startNodeId = startRoom.nodeId;
  const targetNodeId = targetRoom.nodeId;

  if (startNodeId === targetNodeId) {
    const node = graphData.nodes[startNodeId];
    return {
      fromRoom: startKey,
      toRoom: targetKey,
      totalDistanceMeters: 0,
      estimatedSeconds: 0,
      nodePath: [startNodeId],
      legs: [
        {
          building: startRoom.building,
          level: startRoom.level,
          coordinates: [node.coordinates],
          distanceMeters: 0,
        },
      ],
      transitions: [],
      summary: `Start and destination are at the same room (${startKey})`,
    };
  }

  const indoorOnly = options.indoorOnly ?? true;
  const graph = createPathfindingGraph(graphData, options.accessibleOnly, indoorOnly);
  const targetNode = graphData.nodes[targetNodeId];
  const restrictedNodes = new Set(graphData.restrictedRoomNodes ?? []);

  const pathfinder = aStar(graph, {
    heuristic(from: Node<RoutingNode>, to: Node<RoutingNode>) {
      const fromNode = from.data;
      const toNode = to.data;
      const hDist = haversineMeters(fromNode.coordinates, toNode.coordinates);
      const vDist = Math.abs(fromNode.level - toNode.level) * STOREY_HEIGHT_M;
      return Math.hypot(hDist, vDist);
    },
    distance(
      from: Node<RoutingNode>,
      to: Node<RoutingNode>,
      link: Link<RoutingEdge>
    ) {
      let cost = link.data.distance;
      if (link.data.type === "stairs") {
        cost += STAIRS_EFFORT_PENALTY;
      } else if (link.data.type === "elevator") {
        cost += ELEVATOR_WAIT_PENALTY;
      }

      // Heavily penalize cutting through an intermediate private room/classroom
      // while still allowing entering destination or leaving origin rooms.
      const toId = String(to.id);
      if (
        toId !== targetNodeId &&
        toId !== startNodeId &&
        restrictedNodes.has(toId)
      ) {
        cost += ROOM_PASSTHROUGH_PENALTY;
      }

      return cost;
    },
  });

  // ngraph.path aStar returns nodes in reverse order: [target, ..., start]
  const reversedNodes = pathfinder.find(startNodeId, targetNodeId);
  if (!reversedNodes || reversedNodes.length === 0) {
    return null;
  }

  const nodePath = reversedNodes.map((n) => String(n.id)).reverse();

  // Segment node path into floor/building legs and detect transitions
  const legs: RouteLeg[] = [];
  const transitions: RouteTransition[] = [];
  let totalDistance = 0;

  const firstNode = graphData.nodes[nodePath[0]];
  let currentLeg: RouteLeg = {
    building: firstNode.building,
    level: firstNode.level,
    toLevel: firstNode.level,
    coordinates: [firstNode.coordinates],
    distanceMeters: 0,
  };

  for (let i = 1; i < nodePath.length; i++) {
    const prevNodeId = nodePath[i - 1];
    const prevNode = graphData.nodes[prevNodeId];
    const nodeId = nodePath[i];
    const node = graphData.nodes[nodeId];

    const hDist = haversineMeters(prevNode.coordinates, node.coordinates);
    const vDist = Math.abs(prevNode.level - node.level) * STOREY_HEIGHT_M;
    const segDistance = Math.hypot(hDist, vDist);
    totalDistance += segDistance;

    const isTransition = prevNode.building !== node.building || prevNode.level !== node.level;

    if (isTransition) {
      let transitionType: RouteTransition["type"] = "connector";
      let desc = "";

      const link = graph.hasLink(prevNodeId, nodeId) || graph.hasLink(nodeId, prevNodeId);
      const edgeType = link?.data?.type;

      const isCrossBuilding = Boolean(
        prevNode.building && node.building && prevNode.building !== node.building
      );
      const isBridge = edgeType === "bridge" || isCrossBuilding;

      if (isBridge && prevNode.building && node.building) {
        transitionType = "bridge";
        const fromB = CAMPUS_BUILDING_NAMES[prevNode.building] ?? `${prevNode.building} Building`;
        const toB = CAMPUS_BUILDING_NAMES[node.building] ?? `${node.building} Building`;
        desc = `Cross Skybridge from ${fromB} to ${toB}`;
      } else if (prevNode.level !== node.level) {
        const isElevator =
          edgeType === "elevator" ||
          (edgeType !== "stairs" &&
            (options.accessibleOnly ||
              (segDistance < 5 && Math.abs(prevNode.level - node.level) >= 1)));
        transitionType = isElevator ? "elevator" : "stairs";
        const action = isElevator ? "Take Elevator" : "Take Stairs";
        desc = `${action} from Level ${prevNode.level} to Level ${node.level}`;
      }

      transitions.push({
        type: transitionType,
        fromBuilding: prevNode.building,
        fromLevel: prevNode.level,
        toBuilding: node.building,
        toLevel: node.level,
        location: prevNode.coordinates,
        toLocation: node.coordinates,
        distanceMeters: Math.round(segDistance * 10) / 10,
        description: desc,
      });

      if (isBridge) {
        // Cross-building bridge walkway: the outgoing leg includes the bridge span coordinates to the destination entrance
        currentLeg.coordinates.push(node.coordinates);
        currentLeg.toLevel = node.level;
        currentLeg.distanceMeters = Math.round((currentLeg.distanceMeters + segDistance) * 10) / 10;
        legs.push(currentLeg);

        // Next leg starts seamlessly at the destination doorway, with zero gap between ribbons
        currentLeg = {
          building: node.building,
          level: node.level,
          toLevel: node.level,
          coordinates: [node.coordinates],
          distanceMeters: 0,
        };
      } else {
        // Vertical transition (stairs/elevator): previous floor leg ends at elevator/stair door
        legs.push(currentLeg);

        // Next leg begins on the new floor at elevator/stair door
        currentLeg = {
          building: node.building,
          level: node.level,
          toLevel: node.level,
          coordinates: [node.coordinates],
          distanceMeters: 0,
        };
      }
    } else {
      // Continuing on same floor and building
      currentLeg.coordinates.push(node.coordinates);
      currentLeg.distanceMeters = Math.round((currentLeg.distanceMeters + segDistance) * 10) / 10;
    }
  }

  legs.push(currentLeg);

  const roundedDistance = Math.round(totalDistance * 10) / 10;
  const estimatedSeconds = Math.round(roundedDistance / WALKING_SPEED_MPS);

  let summary = `Walk ~${Math.round(roundedDistance)}m (${Math.ceil(estimatedSeconds / 60)} min)`;
  if (transitions.length > 0) {
    const transitionPhrases = transitions.map((t) => t.type).join(", ");
    summary += ` via ${transitionPhrases}`;
  }

  return {
    fromRoom: startKey,
    toRoom: targetKey,
    totalDistanceMeters: roundedDistance,
    estimatedSeconds,
    nodePath,
    legs,
    transitions,
    summary,
  };
}
