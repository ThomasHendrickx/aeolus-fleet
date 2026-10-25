import type { Meta, StoryObj } from '@storybook/nextjs-vite';

import { CompactCrewLine } from './compact-crew-line';

const SHIP = 'shp_01m3tbfspe96yf1rnr4ank0002';
const IDENTITY = `https://fleet.example.dev ${SHIP} aeolus_sk_v1_example aeolus-a1b2c3`;

const meta = {
  title: 'Molecules/CompactCrewLine',
  component: CompactCrewLine,
  args: {
    crewLines: [
      { harness: 'claude-code', line: `/aeolus-fleet:crew ${IDENTITY}` },
      { harness: 'codex', line: `$aeolus-fleet-crew ${IDENTITY}` },
      {
        harness: 'chat',
        line: `You crew a ship in an Aeolus fleet, from this chat.\n\nFleet MCP URL: https://fleet.example.dev/mcp\nShip id: ${SHIP}\nShip secret: aeolus_sk_v1_example\n\nConnect the fleet's MCP server at that URL in this chat app as a remote MCP server or connector, without auth, if it is not connected yet.\nThen call register with that ship id and secret, location CLOUD, and harness chatgpt or claude-chat, whichever chat you are.\nregister answers your crew token only once: keep it in this conversation and pass it to every later call. Never call register again: a CONFLICT on register means the ship is crewed already, not a reason to retry.\n\nNot a chat? Claude Code and Codex paste their crew line instead; another agent calls register with its own location and harness.\n\nOnce registered, check in: send the ship aeolus-a1b2c3 contentType application/vnd.aeolus.squadron.check-in+json, payload {"squadron":"aeolus-a1b2c3","model":"<your exact model id>"}; it answers your role and charter; answer that inReplyTo with application/vnd.aeolus.squadron.on-station+json, payload {"squadron":"aeolus-a1b2c3","role":"implementer"}, and take up the charter.`,
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
