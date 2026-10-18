-- Un comprobante registrado no se edita ni se borra, igual que su asiento:
-- si hubo un error, se extorna el asiento y el comprobante figura como anulado.
CREATE FUNCTION documents_reject_change() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Un comprobante registrado no se modifica: extorna su asiento.'
    USING ERRCODE = 'check_violation', CONSTRAINT = 'documents_immutable';
END;
$$;
--> statement-breakpoint
CREATE TRIGGER documents_immutable
  BEFORE UPDATE OR DELETE ON documents
  FOR EACH ROW EXECUTE FUNCTION documents_reject_change();
