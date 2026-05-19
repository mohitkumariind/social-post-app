import { twitterCampaignWorkersGET, twitterCampaignWorkersPOST } from '@/lib/admin/twitter-campaign-workers-api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 300;

export async function GET() {
  return twitterCampaignWorkersGET();
}

export async function POST(req: Request) {
  return twitterCampaignWorkersPOST(req);
}
