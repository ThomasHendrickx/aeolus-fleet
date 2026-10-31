import { answerReportRead } from '../../../../lib/report-read';

export const dynamic = 'force-dynamic';

/** The report and its task link are read together for the current viewer. */
export async function GET(request: Request, { params }: RouteContext<'/api/reports/[procedure]'>): Promise<Response> {
  return answerReportRead(request, { procedure: (await params).procedure, environment: process.env });
}
