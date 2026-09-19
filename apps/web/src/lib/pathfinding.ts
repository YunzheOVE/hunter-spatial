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
};

export type RouteLeg = {
  building: string;
  level: number;
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
};

const STOREY_HEIGHT_M = 3.5;
const WALKING_SPEED_MPS = 1.2; // ~4.3 km/h average indoor walk speed
const STAIRS_EFFORT_PENALTY = 8.0; // equivalent extra meters for stair climbing
const ELEVATOR_WAIT_PENALTY = 25.0; // equivalent extra meters for elevator wait

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
  accessibleOnly: boolean = false
): Graph<RoutingNode, RoutingEdge> {
  const graph = createGraph<RoutingNode, RoutingEdge>();

  for (const [id, node] of Object.entries(data.nodes)) {
    graph.addNode(id, node);
  }

  for (const edge of data.edges) {
    if (accessibleOnly && !edge.accessible) {
      continue;
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

  // 3. Match room by name or case-insensitive key
  for (const [key, room] of Object.entries(graphData.rooms)) {
    if (key.toUpperCase() === upper || room.name.toUpperCase() === upper) {
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

  const graph = createPathfindingGraph(graphData, options.accessibleOnly);
  const targetNode = graphData.nodes[targetNodeId];

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
      const baseDistance = link.data.distance;
      if (link.data.type === "stairs") {
        return baseDistance + STAIRS_EFFORT_PENALTY;
      }
      if (link.data.type === "elevator") {
        return baseDistance + ELEVATOR_WAIT_PENALTY;
      }
      return baseDistance;
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

  let currentLeg: RouteLeg | null = null;

  for (let i = 0; i < nodePath.length; i++) {
    const nodeId = nodePath[i];
    const node = graphData.nodes[nodeId];

    if (!currentLeg || currentLeg.building !== node.building || currentLeg.level !== node.level) {
      if (currentLeg) {
        legs.push(currentLeg);
      }
      currentLeg = {
        building: node.building,
        level: node.level,
        coordinates: [node.coordinates],
        distanceMeters: 0,
      };
    } else {
      currentLeg.coordinates.push(node.coordinates);
    }

    if (i > 0) {
      const prevNodeId = nodePath[i - 1];
      const prevNode = graphData.nodes[prevNodeId];
      const hDist = haversineMeters(prevNode.coordinates, node.coordinates);
      const vDist = Math.abs(prevNode.level - node.level) * STOREY_HEIGHT_M;
      const segDistance = Math.hypot(hDist, vDist);

      totalDistance += segDistance;
      currentLeg.distanceMeters = Math.round((currentLeg.distanceMeters + segDistance) * 10) / 10;

      // Check transition between buildings or floors
      if (prevNode.building !== node.building || prevNode.level !== node.level) {
        let transitionType: RouteTransition["type"] = "connector";
        let desc = "";

        if (prevNode.building !== node.building && prevNode.level === node.level) {
          transitionType = "bridge";
          desc = `Cross Level ${node.level} Skybridge from ${prevNode.building} to ${node.building} Building`;
        } else if (prevNode.level !== node.level) {
          const isElevator = !options.accessibleOnly
            ? segDistance < 5 && Math.abs(prevNode.level - node.level) >= 1
            : true;
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
          location: node.coordinates,
          description: desc,
        });
      }
    }
  }

  if (currentLeg) {
    legs.push(currentLeg);
  }

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
