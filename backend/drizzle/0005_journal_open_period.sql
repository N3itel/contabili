-- Un periodo cerrado no recibe asientos. El bloqueo compartido de la empresa
-- espera a un cierre en curso, así ningún asiento se cuela al cerrar.
CREATE FUNCTION journal_entries_check_open_period() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  closed date;
BEGIN
  SELECT closed_through INTO closed FROM companies WHERE id = NEW.company_id FOR SHARE;
  IF closed IS NOT NULL AND NEW.entry_date <= closed THEN
    RAISE EXCEPTION 'Los libros están cerrados hasta %', closed
      USING ERRCODE = 'check_violation', CONSTRAINT = 'period_closed';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_open_period
  BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_entries_check_open_period();
