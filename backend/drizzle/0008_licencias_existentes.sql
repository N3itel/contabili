-- Las empresas creadas antes de las licencias empiezan su prueba gratis hoy.
INSERT INTO company_licenses (company_id, plan, trial_ends_at)
SELECT id, 'negocio', now() + interval '30 days' FROM companies
ON CONFLICT DO NOTHING;
