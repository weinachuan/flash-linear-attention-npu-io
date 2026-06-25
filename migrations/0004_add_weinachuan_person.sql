INSERT INTO people(id, name, position, placeholder, pl)
SELECT 'person-魏纳川', '魏纳川', next_position, 0, '赵臣臣'
FROM (
  SELECT COALESCE(MAX(position) + 1, 0) AS next_position
  FROM people
)
WHERE NOT EXISTS (
  SELECT 1
  FROM people
  WHERE id = 'person-魏纳川' OR name = '魏纳川'
);

UPDATE people
SET placeholder = 0,
    pl = '赵臣臣'
WHERE id = 'person-魏纳川' OR name = '魏纳川';
