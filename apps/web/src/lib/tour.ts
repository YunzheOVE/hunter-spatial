import type { RoutingGraphData } from "./pathfinding";

export type TourStop = {
  /** Room key in routing-graph.json (or TOUR_ANCHORS); also the floor-plan room the map zooms to and highlights. */
  roomId: string;
  title: string;
  body: string;
  /** Detours are reached from the previous stop's card, and Next skips them. */
  optional?: boolean;
  source?: { label: string; href: string };
  /** Served from public/tour; credit links to the Commons file page, which carries the license. */
  photo?: { src: string; alt: string; credit: string; license: string; href: string };
};

const SKYBRIDGE = "Skybridge (West–East, Level 3)";

// The skybridge has no room in the source map, so the tour pins its East landing node.
const TOUR_ANCHORS: RoutingGraphData["rooms"] = {
  [SKYBRIDGE]: { building: "E", level: 3, nodeId: "n_683fc4722b365c1a8114c057", name: SKYBRIDGE },
};

/** Routing graph with the tour's extra anchors; the shared graph is not changed. */
export function tourGraph(graph: RoutingGraphData): RoutingGraphData {
  return { ...graph, rooms: { ...graph.rooms, ...TOUR_ANCHORS } };
}

// First-week tour, in the order Hunter's student ambassadors walk it: West → East → North → Thomas Hunter Hall.
export const TOUR_STOPS: TourStop[] = [
  {
    roomId: "Main Entrance",
    title: "West lobby & Visitors Center",
    photo: { src: "/tour/west-lobby.jpg", alt: "West Building entrance on Lexington Avenue with the Hunter College sign", credit: "Kenneth C. Zirkel", license: "CC BY-SA 4.0", href: "https://commons.wikimedia.org/wiki/File:Hunter_College_West,_NYC.jpg" },
    body: "Start at 68th Street and Lexington Avenue, right by the 6 train. Tap your Hunter OneCard at the turnstiles. If you still need campus access, check in at the Visitors Center.",
    source: { label: "Public Safety: campus access", href: "https://hunter.cuny.edu/public-safety/about/campus-access" },
  },
  {
    roomId: "W203",
    title: "OneCard Office",
    body: "Set up your mobile Hunter ID and submit your photo online. Come to West 203 if you need help or a physical card. Book an appointment first.",
    source: { label: "Hunter OneCard", href: "https://hunter.cuny.edu/information-technology/services/accounts-access/onecard" },
  },
  {
    roomId: "W304",
    title: "Main Cafeteria",
    body: "Grab lunch, heat up food you brought, or sit down between classes. The Purple Apron Food Pantry is on the lower level in West B103.",
  },
  {
    roomId: SKYBRIDGE,
    title: "Third-floor skybridge",
    photo: { src: "/tour/skybridge.jpg", alt: "Skybridges over Lexington Avenue linking the West and East Buildings", credit: "ajay_suresh", license: "CC BY 4.0", href: "https://commons.wikimedia.org/wiki/File:Hunter_College_(55505754641).jpg" },
    body: "The third-floor bridges link West, East and North over Lexington Avenue and 68th Street, so you rarely need to go outside between classes. This one takes you to the East Building and the library.",
  },
  {
    roomId: "Cooperman Library Welcome Desk",
    title: "Cooperman Library",
    body: "Enter the library from the third-floor walkway. Start at the Welcome Desk for help finding study space, course reserves or equipment loans. Writing, math and science tutoring are upstairs on 7.",
    source: { label: "Hunter College Libraries", href: "https://hunter-undergraduate.catalog.cuny.edu/student-life/academic-services/hunter-college-libraries" },
  },
  {
    roomId: "E730",
    title: "Writing Center",
    body: "One of the learning centers on the library's seventh floor, next to math and science tutoring. Worth a visit before your first paper is due.",
    optional: true,
  },
  {
    roomId: "N217",
    title: "One Stop / Registrar",
    photo: { src: "/tour/north-building.jpg", alt: "North Building entrance on 69th Street", credit: "Kenneth C. Zirkel", license: "CC BY 4.0", href: "https://commons.wikimedia.org/wiki/File:Hunter_College_North_Building.jpg" },
    body: "Come here for enrollment, academic records, transcripts and registration help.",
    source: { label: "Registrar's Office / One Stop", href: "https://hunter-undergraduate.catalog.cuny.edu/student-life/academic-services/registrars-office-one-stop" },
  },
  {
    roomId: "TH202", // The Student Union area has no floor-plan shape; Student Activities is its main room.
    title: "Student Union",
    photo: { src: "/tour/thomas-hunter-hall.jpg", alt: "Gothic facade of Thomas Hunter Hall", credit: "Beyond My Ken", license: "CC BY-SA 4.0", href: "https://commons.wikimedia.org/wiki/File:Thomas_Hunter_Hall_Hunter_College_CUNY_from_south.jpg" },
    body: "Find student clubs, campus events and a place to hang out between classes in Thomas Hunter Hall. Look for the game room and Undergraduate Student Government on this floor.",
  },
];
