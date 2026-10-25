import { handleSubmissions } from "../../../../server/submissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export const GET = handleSubmissions;
export const POST = handleSubmissions;
