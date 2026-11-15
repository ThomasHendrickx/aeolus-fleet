-- The plugin's join-machine commissions type trierarch, and label-machines owns
-- trierarch=machine for computers and trierarch=plugin for its own ship.
-- Evidence: aeolus-fleet-trierarch-plugin, join-machine.ts and label-machines.ts
-- at 90cd8423267c257b71ac6bcfc058a0a4fa6ee25a (approved trierarch-kind design).
-- Select old agent/app computers by either the same-fleet plugin commissioner
-- plus its computer type, or the computer label owned by that fleet's plugin.
-- Type alone and another plugin's similarly named label are never proof.
-- Only kind changes: ids, credentials, inboxes, leases and requests stay in place.
-- The enum is added in the previous migration so this value is committed first.
UPDATE ships AS computer
SET kind = 'trierarch'::ship_kind
WHERE computer.kind IN ('agent', 'app')
  AND EXISTS (
    SELECT 1
    FROM ships AS plugin
    WHERE plugin.fleet_id = computer.fleet_id
      AND plugin.type = 'trierarch-plugin'
      AND plugin.id <> computer.id
      AND (
        (computer.type = 'trierarch'
          AND computer.commissioned_by_kind = 'ship'
          AND computer.commissioned_by = plugin.id)
        OR EXISTS (
          SELECT 1
          FROM ship_labels AS carried
          JOIN labels AS label
            ON label.fleet_id = carried.fleet_id AND label.id = carried.label_id
          JOIN label_values AS value
            ON value.fleet_id = carried.fleet_id AND value.id = carried.value_id AND value.label_id = label.id
          WHERE carried.fleet_id = computer.fleet_id
            AND carried.ship_id = computer.id
            AND label.key = 'trierarch'
            AND label.owner_kind = 'ship'
            AND label.owner_ship_id = plugin.id
            AND value.value = 'machine'
        )
      )
  );
