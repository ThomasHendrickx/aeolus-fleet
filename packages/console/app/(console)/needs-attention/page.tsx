import { redirect } from 'next/navigation';

/** Needs attention became Health (#304): an old link opens Health. */
export default function NeedsAttentionPage(): never {
  redirect('/fleet-health');
}
