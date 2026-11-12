import { handleReviews } from "../../../../../server/reviews";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  return handleReviews(request, (await context.params).id);
}
