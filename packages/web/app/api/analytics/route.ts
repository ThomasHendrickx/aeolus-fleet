import { analyticsAdapterFrom } from '../../../lib/analytics-adapter';
import { createDailySalt, handleAnalytics } from '../../../lib/analytics-route';
import { serverInternalUrlFrom } from '../../../lib/server-url';

// Every event is its own request: nothing here is cached.
export const dynamic = 'force-dynamic';

const salt = createDailySalt();

/** The console's analytics events (decision 0025), handed to the configured adapter; 404 without one. */
export async function POST(request: Request): Promise<Response> {
  return handleAnalytics(request, { adapter: analyticsAdapterFrom(process.env), serverUrl: serverInternalUrlFrom(process.env), salt });
}
