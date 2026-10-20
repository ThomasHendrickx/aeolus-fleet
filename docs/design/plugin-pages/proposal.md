# Plugin pages: three directions

Each plugin serves its own page under the fleet's address (0043), and a person signed in through pagasae uses it as their account, with exactly their scopes (0053, 0057); argo's console sign-in works there too. The console links to these pages, and its Network page moves into the networking plugin's page. The three pages, in the same three directions as the gateway's pages (aeolus-fleet-gateway, `design/gateway-pages`), so one pick covers both:

1. **Networking plugin:** the rules in force in three groups by who owns them: built-in (core's; the never-off ones locked, the viewer's read rule a switch), the plugin's own (editable), and declared (read-only, with the declarer: the installation's `group=#` to `group=#`, squadrons' three, the trierarch plugin's one). Reach explained: a ship, its counts per verb, and the exact rule behind each ship it reaches. Refusals: the latest, with the verb, the rules version, both ships' labels and owners, and whether the plugin was unavailable.
2. **Squadrons:** forming (blueprint, version, the roles and ship counts it commissions) and a sailing squadron (members on station, health, reports, hand-offs, Message, Add member, Stand down).
3. **Trierarch plugin:** computers (online or silent, how many ships each runs of its capacity, labels, owner), crew requests (running, crewing, crashed, waiting with the reason) and a person adding their own computer: a name, the owner is their person ship (0055), the setup line shown once, then it joins.

Each direction has four sheets: `<letter>-phone-light.png`, `<letter>-phone-dark.png`, `<letter>-desktop-light.png`, `<letter>-desktop-dark.png`. The chrome is the same in all three: the Aeolus mark, the fleet, the plugin's name, a link back to the console and the account; sections as a TabBar on phone and line tabs on desktop.

## A · Console

Lists and tables, as the console draws them today: rule rows with selector pills and a verb icon, a refusal opening in a side sheet, the squadron as a table of members, computers and crew requests as tables with StatusBadges.

- For: the console's parts as they are; the move of Network out of the console changes nothing for argo but the address.
- Against: dense. The difference between a built-in, an own and a declared rule is a section heading, and why a send was refused is a sheet away.

## B · Signal

One large shape per page: the plugin's availability as a ring, a big count per group of rules, rings per verb for reach, a ring of members on station coloured by health, a ring of capacity per computer. One rule, refusal or crew request in focus at a time. The declared `group=#` to `group=#` rule is drawn: two ships of group sales reach each other, sales and finance do not.

- For: the state of each plugin is seen at a glance and from across a room; the `#` rule explains itself.
- Against: one at a time is slow for argo working through 4 refusals or 12 rules; rings and the card stack are new parts.

## C · Tracker

Every check and flow is a row of steps. A send is sender, rule, recipient: reach explained shows it passing, with the rule named; a refusal shows it stopped at the rule. A crew request is requested, assigned, crewing, running, and stops where it stops (waiting at assigned with the reason, crashed at running). A squadron is blueprint, forming, sailing, disbanded; adding a computer is name, setup line, joined. Lists are lanes by state, each card with a tone edge: rules by owner, members by health, computers online or silent, crew requests by what needs you.

- For: the same tracker as the gateway's pages, so a person learns one picture for every flow; a refusal and a crashed request say where they stopped without a sentence. Lanes keep the overview.
- Against: two new parts (tracker and tone-edged card), and a tracker per row costs height on phone.

## Pick

C, as for the gateway pages. One tracker explains a refused send, a waiting crew request and a forming squadron the same way, the lanes keep argo's overview, and the pick stays one decision for gateway and plugins.

## Questions

1. Reach explained names the rule for each ship reached. Should the refusal page also show the nearest rules that did not match, computed by the plugin from the recorded labels? The screens show only "No rule matches", as 0034 records no reason.
2. Which scope lets a person add their own computer on the trierarch plugin's page? 0055 says a human adds it signed in as their account; the screens assume any account with a person ship may, owner fixed to that person ship.
