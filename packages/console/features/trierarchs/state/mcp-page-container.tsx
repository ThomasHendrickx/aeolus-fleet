'use client';

import { useAccess } from '../../../lib/access';
import { useTrierarchPluginConnection } from '../../../lib/trierarch-plugin';
import { McpContainer } from './mcp-container';
import { TrierarchsContainer } from './trierarchs-container';

/** Direct URLs keep the machines screen for a viewer or a console without the plugin. */
export function McpPageContainer() {
  const access = useAccess();
  const connection = useTrierarchPluginConnection();
  return access.canManage && connection !== 'none' && connection !== 'unknown' ? <McpContainer /> : <TrierarchsContainer />;
}
