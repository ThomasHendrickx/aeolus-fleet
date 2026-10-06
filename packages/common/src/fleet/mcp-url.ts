/** Where the server serves the ship contract as MCP tools. */
export const MCP_PATH = '/mcp';

/**
 * The fleet's MCP URL, which every starting prompt carries: `/mcp` under the
 * public URL, keeping its path, whether or not it ends in a slash.
 */
export function mcpUrlOf(publicUrl: string): string {
  return `${publicUrl.replace(/\/+$/, '')}${MCP_PATH}`;
}
