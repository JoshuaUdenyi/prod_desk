-- ProductionDesk — initial schema
--
-- Conventions
--   * All timestamps are ISO 8601 UTC strings.
--   * All money is INTEGER kobo (1/100 naira). No REAL columns anywhere.
--   * Quantities and durations are INTEGER milli-units (3 decimal places).
--   * Percentages are INTEGER basis points (1% = 100 bp).
--   * Estimated costs live in cost_lines; what was actually spent lives in
--     actual_expenses. Estimates are never overwritten by actuals.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Users and sessions
-- ---------------------------------------------------------------------------

CREATE TABLE users (
  id             TEXT PRIMARY KEY,
  email          TEXT NOT NULL UNIQUE COLLATE NOCASE,
  name           TEXT NOT NULL,
  role           TEXT NOT NULL CHECK (role IN ('owner', 'finance')),
  password_hash  TEXT NOT NULL,
  password_salt  TEXT NOT NULL,
  password_iter  INTEGER NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  last_login_at  TEXT
);

CREATE TABLE sessions (
  -- Stores the SHA-256 hash of the session token, never the token itself.
  token_hash  TEXT PRIMARY KEY,
  user_id     TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL,
  expires_at  TEXT NOT NULL,
  user_agent  TEXT,
  ip          TEXT
);

CREATE INDEX idx_sessions_user ON sessions(user_id);
CREATE INDEX idx_sessions_expires ON sessions(expires_at);

-- ---------------------------------------------------------------------------
-- Company settings (single row)
-- ---------------------------------------------------------------------------

CREATE TABLE settings (
  id                        INTEGER PRIMARY KEY CHECK (id = 1),
  company_name              TEXT NOT NULL DEFAULT '',
  company_logo_key          TEXT,
  company_email             TEXT NOT NULL DEFAULT '',
  company_phone             TEXT NOT NULL DEFAULT '',
  company_address           TEXT NOT NULL DEFAULT '',
  bank_details              TEXT NOT NULL DEFAULT '',
  payment_terms             TEXT NOT NULL DEFAULT '',

  currency                  TEXT NOT NULL DEFAULT 'NGN',

  -- Target margins (PRD defaults: Budget 20%, Mid-range 30%, Premium 40%)
  margin_budget_bp          INTEGER NOT NULL DEFAULT 2000,
  margin_midrange_bp        INTEGER NOT NULL DEFAULT 3000,
  margin_premium_bp         INTEGER NOT NULL DEFAULT 4000,

  -- Below this margin, an owner approval and reason are required.
  min_margin_bp             INTEGER NOT NULL DEFAULT 2000,

  -- Margin warning bands
  band_critical_below_bp    INTEGER NOT NULL DEFAULT 1500,
  band_low_below_bp         INTEGER NOT NULL DEFAULT 2500,
  band_acceptable_below_bp  INTEGER NOT NULL DEFAULT 3500,
  band_good_up_to_bp        INTEGER NOT NULL DEFAULT 4000,

  -- Contingency
  default_contingency_bp    INTEGER NOT NULL DEFAULT 500,
  contingency_base          TEXT NOT NULL DEFAULT 'direct'
                            CHECK (contingency_base IN ('direct', 'direct_plus_overhead')),

  -- Overhead allocation
  overhead_method           TEXT NOT NULL DEFAULT 'none'
                            CHECK (overhead_method IN ('none', 'fixed', 'percent')),
  overhead_fixed_kobo       INTEGER NOT NULL DEFAULT 0,
  overhead_percent_bp       INTEGER NOT NULL DEFAULT 0,

  -- Tax and VAT (configurable; not tax advice)
  vat_enabled               INTEGER NOT NULL DEFAULT 1 CHECK (vat_enabled IN (0, 1)),
  vat_rate_bp               INTEGER NOT NULL DEFAULT 750,
  tax_provision_bp          INTEGER NOT NULL DEFAULT 0,

  -- Quotation defaults
  quotation_validity_days   INTEGER NOT NULL DEFAULT 30,
  deposit_percent_bp        INTEGER NOT NULL DEFAULT 5000,

  updated_at                TEXT NOT NULL
);

-- ---------------------------------------------------------------------------
-- Projects
-- ---------------------------------------------------------------------------

CREATE TABLE projects (
  id                    TEXT PRIMARY KEY,
  reference             TEXT NOT NULL UNIQUE,
  name                  TEXT NOT NULL,
  client_name           TEXT NOT NULL,
  client_contact        TEXT NOT NULL DEFAULT '',
  client_email          TEXT NOT NULL DEFAULT '',
  event_type            TEXT NOT NULL DEFAULT 'other'
                        CHECK (event_type IN ('corporate', 'conference', 'concert', 'church',
                                              'wedding', 'government', 'product_launch',
                                              'workshop', 'other')),
  location              TEXT NOT NULL DEFAULT '',
  event_date            TEXT,
  production_days       INTEGER NOT NULL DEFAULT 1 CHECK (production_days > 0),
  description           TEXT NOT NULL DEFAULT '',

  status                TEXT NOT NULL DEFAULT 'draft'
                        CHECK (status IN ('draft', 'quoted', 'approved', 'in_production',
                                          'completed', 'cancelled')),

  -- Pricing
  target_margin_preset  TEXT NOT NULL DEFAULT 'midrange'
                        CHECK (target_margin_preset IN ('budget', 'midrange', 'premium', 'custom')),
  target_margin_bp      INTEGER NOT NULL DEFAULT 3000 CHECK (target_margin_bp >= 0 AND target_margin_bp < 10000),
  price_base            TEXT NOT NULL DEFAULT 'direct_plus_contingency'
                        CHECK (price_base IN ('direct', 'direct_plus_contingency',
                                              'direct_plus_contingency_plus_overhead')),
  -- Contingency snapshot, so a project keeps its own assumptions even if the
  -- company default later changes.
  contingency_bp        INTEGER NOT NULL DEFAULT 500,
  contingency_base      TEXT NOT NULL DEFAULT 'direct'
                        CHECK (contingency_base IN ('direct', 'direct_plus_overhead')),
  overhead_method       TEXT NOT NULL DEFAULT 'none'
                        CHECK (overhead_method IN ('none', 'fixed', 'percent')),
  overhead_fixed_kobo   INTEGER NOT NULL DEFAULT 0,
  overhead_percent_bp   INTEGER NOT NULL DEFAULT 0,

  -- Selling price excluding VAT. VAT is applied and stored separately.
  selling_price_net_kobo INTEGER NOT NULL DEFAULT 0 CHECK (selling_price_net_kobo >= 0),
  vat_rate_bp           INTEGER NOT NULL DEFAULT 750,
  vat_kobo              INTEGER NOT NULL DEFAULT 0,

  -- Below-threshold pricing needs an owner sign-off with a reason.
  approval_status       TEXT NOT NULL DEFAULT 'not_required'
                        CHECK (approval_status IN ('not_required', 'required', 'approved')),
  approval_reason       TEXT,
  approved_by           TEXT REFERENCES users(id),
  approved_at           TEXT,

  -- PRD §6: the approved quotation and its original prices must stay intact.
  quote_locked_at       TEXT,

  created_by            TEXT NOT NULL REFERENCES users(id),
  created_at            TEXT NOT NULL,
  updated_at            TEXT NOT NULL
);

CREATE INDEX idx_projects_status ON projects(status);
CREATE INDEX idx_projects_event_date ON projects(event_date);
CREATE INDEX idx_projects_client ON projects(client_name);

-- ---------------------------------------------------------------------------
-- Estimated cost lines
-- ---------------------------------------------------------------------------

CREATE TABLE cost_lines (
  id                TEXT PRIMARY KEY,
  project_id        TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  category          TEXT NOT NULL CHECK (category IN ('equipment', 'crew', 'logistics',
                                                       'internet', 'other', 'overhead')),
  kind              TEXT NOT NULL DEFAULT 'standard'
                    CHECK (kind IN ('equipment', 'crew', 'standard')),
  description       TEXT NOT NULL,
  quantity_milli    INTEGER NOT NULL DEFAULT 1000 CHECK (quantity_milli >= 0),
  unit_rate_kobo    INTEGER NOT NULL DEFAULT 0 CHECK (unit_rate_kobo >= 0),
  days_milli        INTEGER NOT NULL DEFAULT 1000 CHECK (days_milli >= 0),
  additional_kobo   INTEGER NOT NULL DEFAULT 0,
  supplier          TEXT NOT NULL DEFAULT '',
  notes             TEXT NOT NULL DEFAULT '',
  sort_order        INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);

CREATE INDEX idx_cost_lines_project ON cost_lines(project_id, category, sort_order);

-- ---------------------------------------------------------------------------
-- Actual expenses
-- ---------------------------------------------------------------------------

CREATE TABLE actual_expenses (
  id            TEXT PRIMARY KEY,
  project_id    TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  -- Optional link to the estimate this expense belongs to, for line-level variance.
  cost_line_id  TEXT REFERENCES cost_lines(id) ON DELETE SET NULL,
  category      TEXT NOT NULL CHECK (category IN ('equipment', 'crew', 'logistics',
                                                  'internet', 'other', 'overhead')),
  description   TEXT NOT NULL,
  amount_kobo   INTEGER NOT NULL DEFAULT 0,
  incurred_on   TEXT,
  supplier      TEXT NOT NULL DEFAULT '',
  notes         TEXT NOT NULL DEFAULT '',
  created_by    TEXT NOT NULL REFERENCES users(id),
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);

CREATE INDEX idx_actuals_project ON actual_expenses(project_id, category);
CREATE INDEX idx_actuals_line ON actual_expenses(cost_line_id);

-- ---------------------------------------------------------------------------
-- Quotations
-- ---------------------------------------------------------------------------

CREATE TABLE quotations (
  id                  TEXT PRIMARY KEY,
  project_id          TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  reference           TEXT NOT NULL UNIQUE,
  version             INTEGER NOT NULL DEFAULT 1,
  layout              TEXT NOT NULL DEFAULT 'detailed'
                      CHECK (layout IN ('detailed', 'package')),
  status              TEXT NOT NULL DEFAULT 'draft'
                      CHECK (status IN ('draft', 'issued', 'accepted', 'declined', 'expired')),

  issued_on           TEXT,
  valid_until         TEXT,

  -- Client-facing snapshot. Deliberately contains only what the client may see:
  -- descriptions, quantities and prices. No costs, overhead, suppliers or margins.
  client_items_json   TEXT NOT NULL DEFAULT '[]',
  client_notes        TEXT NOT NULL DEFAULT '',

  subtotal_kobo       INTEGER NOT NULL DEFAULT 0,
  vat_rate_bp         INTEGER NOT NULL DEFAULT 0,
  vat_kobo            INTEGER NOT NULL DEFAULT 0,
  total_kobo          INTEGER NOT NULL DEFAULT 0,

  pdf_r2_key          TEXT,
  pdf_generated_at    TEXT,

  created_by          TEXT NOT NULL REFERENCES users(id),
  created_at          TEXT NOT NULL,
  updated_at          TEXT NOT NULL
);

CREATE INDEX idx_quotations_project ON quotations(project_id, version);

-- ---------------------------------------------------------------------------
-- Client payments
-- ---------------------------------------------------------------------------

CREATE TABLE payments (
  id          TEXT PRIMARY KEY,
  project_id  TEXT NOT NULL REFERENCES projects(id) ON DELETE CASCADE,
  amount_kobo INTEGER NOT NULL CHECK (amount_kobo > 0),
  paid_on     TEXT NOT NULL,
  method      TEXT NOT NULL DEFAULT '',
  reference   TEXT NOT NULL DEFAULT '',
  notes       TEXT NOT NULL DEFAULT '',
  created_by  TEXT NOT NULL REFERENCES users(id),
  created_at  TEXT NOT NULL
);

CREATE INDEX idx_payments_project ON payments(project_id);

-- ---------------------------------------------------------------------------
-- Audit trail (PRD §12)
-- ---------------------------------------------------------------------------

CREATE TABLE audit_log (
  id           TEXT PRIMARY KEY,
  actor_id     TEXT,
  actor_email  TEXT,
  action       TEXT NOT NULL,
  entity       TEXT NOT NULL,
  entity_id    TEXT,
  detail_json  TEXT NOT NULL DEFAULT '{}',
  created_at   TEXT NOT NULL
);

CREATE INDEX idx_audit_entity ON audit_log(entity, entity_id, created_at);
CREATE INDEX idx_audit_created ON audit_log(created_at);

-- ---------------------------------------------------------------------------
-- Seed the settings row
-- ---------------------------------------------------------------------------

INSERT INTO settings (id, company_name, updated_at)
VALUES (1, 'ProductionDesk', strftime('%Y-%m-%dT%H:%M:%fZ', 'now'));
