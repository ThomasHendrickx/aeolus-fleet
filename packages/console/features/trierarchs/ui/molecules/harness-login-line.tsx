import { Tooltip, TooltipContent, TooltipTrigger } from '@aeolus-fleet/common/header';

import { KEY_CHIP_WORDS, keyTooltip, LOGIN_WORDS, SPEND_TOOLTIP, usd, type HarnessLogin } from '../../../../lib/api-key-logins';
import { clockTime, fullDateTime } from '../../../../lib/relative-time';

function Dot() {
  return <span className="text-muted-foreground">·</span>;
}

/**
 * A harness's login line on the computer card (aeolus-fleet-trierarch's api
 * keys design, K12): its default login, how many of its ships run on the
 * other one, and what they spent on the key; under it, while its key is not
 * ready and ships need it, a chip and how many ships wait.
 */
export function HarnessLoginLine({ login }: { login: HarnessLogin }) {
  const other = login.default === 'apiKey' ? 'subscription' : 'apiKey';
  const { keyNotReady } = login;
  const tooltip = keyNotReady === undefined ? undefined : keyTooltip(keyNotReady, keyNotReady.at === undefined ? undefined : clockTime(new Date(keyNotReady.at)));
  const chip = keyNotReady === undefined ? null : (
    <span
      data-testid="machine-key-chip"
      data-key={keyNotReady.key}
      className="inline-flex items-center rounded-sm border border-tone-attention-border bg-tone-attention-bg px-1.5 text-meta text-tone-attention-fg"
      {...(keyNotReady.at === undefined ? {} : { title: fullDateTime(new Date(keyNotReady.at)) })}
    >
      {KEY_CHIP_WORDS[keyNotReady.key]}
    </span>
  );
  return (
    <>
      <span data-testid="machine-login-line" className="flex flex-wrap items-center gap-x-2 gap-y-1 text-meta">
        <span className="text-muted-foreground">login</span>
        <span className="font-medium">{LOGIN_WORDS[login.default]}</span>
        {login.otherCount === 0 ? null : (
          <>
            <Dot />
            <span className="text-muted-foreground">
              {login.otherCount} on {LOGIN_WORDS[other]}
            </span>
          </>
        )}
        {login.spentOnKeyUsd === undefined ? null : (
          <>
            <Dot />
            <Tooltip>
              <TooltipTrigger render={<span data-testid="machine-spent-on-key" className="tabular-nums" />}>
                {usd(login.spentOnKeyUsd)} <span className="text-muted-foreground">on key</span>
              </TooltipTrigger>
              <TooltipContent>{SPEND_TOOLTIP}</TooltipContent>
            </Tooltip>
          </>
        )}
      </span>
      {chip === null || login.waitingShips === undefined ? null : (
        <span className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-meta">
          {tooltip === undefined ? (
            chip
          ) : (
            <Tooltip>
              <TooltipTrigger render={<span />}>{chip}</TooltipTrigger>
              <TooltipContent>{tooltip}</TooltipContent>
            </Tooltip>
          )}
          <span className="text-muted-foreground" data-testid="machine-ships-wait">
            {login.waitingShips} {login.waitingShips === 1 ? 'ship waits' : 'ships wait'}
          </span>
        </span>
      )}
    </>
  );
}
