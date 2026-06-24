ALTER TABLE people ADD COLUMN pl TEXT NOT NULL DEFAULT '赵臣臣';
UPDATE people SET pl = '赵臣臣' WHERE pl IS NULL OR pl = '';
