import { describe, expect, it } from 'vitest';

import { networkSchema, savedDeclarationSchema, savedRulesSchema } from './networking-plugin-schemas';

const RULE = { from: ['lbv_01m4jtkdcqe51e0v00c76eec2d'], to: [] };
const DECLARATION = { whileUnavailable: 'keep-latest', notRespondingAfterSeconds: 300 };

describe("the networking plugin's answers, parsed on the web app's server (decision 0033)", () => {
  it("reads the network: the rules, none for all-to-all, and what the plugin declares for while it is unavailable", () => {
    expect([networkSchema.parse({ rules: [RULE], declaration: DECLARATION }), networkSchema.parse({ rules: null, declaration: DECLARATION })]).toEqual([
      { rules: [RULE], declaration: DECLARATION },
      { rules: null, declaration: DECLARATION },
    ]);
  });

  it('refuses a declaration the fleet does not know', () => {
    expect(networkSchema.safeParse({ rules: null, declaration: { whileUnavailable: 'ask-argo', notRespondingAfterSeconds: 300 } }).success).toBe(false);
  });

  it('reads what a save of the rules did at the fleet', () => {
    expect(savedRulesSchema.parse({ rules: [RULE], supply: 'waiting' })).toEqual({ rules: [RULE], supply: 'waiting' });
  });

  it('reads what a save of the declaration did at the fleet', () => {
    expect(savedDeclarationSchema.parse({ declaration: DECLARATION, supply: 'supplied' })).toEqual({ declaration: DECLARATION, supply: 'supplied' });
  });

  it('refuses a supply it does not know', () => {
    expect(savedRulesSchema.safeParse({ rules: null, supply: 'maybe' }).success).toBe(false);
  });
});
