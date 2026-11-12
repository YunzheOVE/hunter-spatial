import { handleReviews } from "../../../../server/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const GET = (request: Request) => handleReviews(request);
