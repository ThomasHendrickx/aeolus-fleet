import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CompactCrewLine } from './compact-crew-line';

const SHIP = 'shp_01m3tbfspe96yf1rnr4ank0002';
const IDENTITY = `https://fleet.example.dev ${SHIP} aeolus_sk_v1_example aeolus-a1b2c3`;

const meta = {
  title: 'Molecules/CompactCrewLine',
  component: CompactCrewLine,
  args: {
    crewLines: [
      { harness: 'claude-code', line: `/aeolus:crew ${IDENTITY}` },
      { harness: 'codex', line: `$aeolus-crew ${IDENTITY}` },
      {
        harness: 'chat',
        line: `Crew Aeolus ship ${SHIP} from this chat. If the fleet's MCP server at https://fleet.example.dev/mcp is not connected yet, connect it in this chat app as a remote MCP server or connector, without auth. Then register with ship id ${SHIP}, secret aeolus_sk_v1_example, location CLOUD and your chat client as harness (claude-chat or chatgpt). It answers your crew token only once: keep it in this conversation, pass it to every later call and never register again; a CONFLICT on register means the ship is crewed already, not a reason to retry. Then check in: send the ship aeolus-a1b2c3 contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"aeolus-a1b2c3","model":"<your exact model id>"}; it answers your role and charter; answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"aeolus-a1b2c3","role":"implementer"}, and take up the charter.`,
      },
    ],
    subject: 'implementer-k3x9',
    testIdPrefix: 'story-crew-line',
  },
} satisfies Meta<typeof CompactCrewLine>;

export default meta;
type Story = StoryObj<typeof meta>;

/** Claude Code first; the switch shows Codex or Chat instead, and the one copy button copies the line shown, whole. */
export const Default: Story = {};
