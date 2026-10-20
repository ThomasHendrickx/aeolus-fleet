# 0037 Declared network rules, and the limits on rules

- An actor that defined labels (a plugin such as squadrons or the trierarch plugin, or the installation for `group`, 0052) declares the network rules it needs to core with `fleet.declareNetworkRules` (`labels:define`, also on REST and MCP as a fleet action): its whole list, replacing what it declared before; an empty list withdraws them. Every term of every rule uses a label the caller owns: an exact value's label, and the label of a `*` or `#` term. An unknown id is refused, as its owner cannot be checked. The rules follow 0034's format and selector limits, each naming its verb. Each change writes NetworkRulesDeclared (the declaring ship and the number of rules, never the rules).
- Core stores them per declaring ship and checks them beside the fleet's own rules (0034), so a declaration is in force at once and moves the settings version. While the fleet has none of its own applied (all-to-all), open allows everything and declared rules add nothing: rules only allow.
- An actor holding `fleet:network` reads them (`fleet.declaredNetworkRules`, each declaring ship with its list) and sees them on Network apart from the fleet's own rules. Only the declaring ship changes them.
- A plugin switched off or deleted withdraws its declared rules. Retiring the declaring ship removes them in the same unit of work, with NetworkRulesDeclared of none, as its labels retire with it (0031). The labels a plugin assigned stay when it withdraws.
- Limits, named by every refusal of them (`NETWORK_RULES_MAX`, `DECLARED_NETWORK_RULES_MAX` in common):
  - the fleet's own rules: at most 200, counted alone;
  - declared rules: at most 20 per declaring ship.

Why: an owner of a group keeps its own members labelled and its own reach in place, so argo never maintains rules per squadron, per trierarch or per plugin (design on #573). Rules only on labels the declarer owns keep them safe: only it assigns those labels (0031), so its rules reach no ship it did not label. Every rule in force stays visible, read beside the fleet's own, with no hidden core exception per plugin. The limits keep each send's check fast; they are a deliberate exception to 0016, for performance, not policy.

Rejected: declared rules copied into the fleet's own (two sources of one rule); declared rules counting toward the fleet's 200 (one plugin could crowd the fleet out); a plugin declaring rules on labels it does not own; a fixed core exception per plugin.
