-- Partida doble en la base: al confirmar la transacción, cada asiento tocado
-- tiene al menos dos líneas y la suma del debe es igual a la del haber.
CREATE FUNCTION journal_entry_check_balance() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE
  target uuid;
  n integer;
  debit bigint;
  credit bigint;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.entry_id;
  ELSE
    target := NEW.entry_id;
  END IF;

  -- Si se borró el asiento entero, no queda nada que cuadrar.
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = target) THEN
    RETURN NULL;
  END IF;

  SELECT count(*), coalesce(sum(debit_cents), 0), coalesce(sum(credit_cents), 0)
    INTO n, debit, credit
    FROM journal_lines WHERE entry_id = target;

  IF n < 2 THEN
    RAISE EXCEPTION 'El asiento % necesita al menos dos líneas', target
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_entries_min_lines';
  END IF;
  IF debit <> credit THEN
    RAISE EXCEPTION 'El asiento % no cuadra: debe %, haber %', target, debit, credit
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_entries_balanced';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_check_balance();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION journal_entry_check_balance();
--> statement-breakpoint
-- Un asiento no cambia de empresa ni de línea a otro asiento: se anula con otro.
CREATE FUNCTION journal_lines_keep_entry() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.entry_id <> OLD.entry_id THEN
    RAISE EXCEPTION 'Una línea no se mueve a otro asiento'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_lines_keep_entry';
  END IF;
  RETURN NEW;
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_keep_entry
  BEFORE UPDATE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_lines_keep_entry();
