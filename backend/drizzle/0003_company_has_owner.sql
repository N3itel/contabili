-- Toda empresa conserva al menos un dueño: al confirmar la transacción se
-- revisa la empresa de cada fila cambiada o quitada en company_members.
CREATE FUNCTION company_members_check_owner() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM company_members WHERE company_id = OLD.company_id AND role = 'owner'
  ) THEN
    RAISE EXCEPTION 'La empresa % se quedaría sin dueño', OLD.company_id
      USING ERRCODE = 'check_violation', CONSTRAINT = 'company_members_has_owner';
  END IF;
  RETURN NULL;
END;
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER company_members_has_owner
  AFTER UPDATE OR DELETE ON company_members
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION company_members_check_owner();
--> statement-breakpoint
-- El libro diario no se edita ni se borra: un error se corrige con un extorno.
CREATE FUNCTION journal_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Los asientos registrados no se modifican: se extornan'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'journal_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_immutable
  BEFORE UPDATE OR DELETE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION journal_reject_change();
--> statement-breakpoint
CREATE TRIGGER journal_lines_immutable
  BEFORE UPDATE OR DELETE ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION journal_reject_change();
