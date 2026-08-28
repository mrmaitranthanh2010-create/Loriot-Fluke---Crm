import { env } from "cloudflare:workers";
import seedProducts from "@/data/fluke-products-2026.json";

type D1Result<T = Record<string, unknown>> = {
  results?: T[];
  success: boolean;
};

type D1PreparedStatement = {
  bind: (...values: unknown[]) => D1PreparedStatement;
  run: () => Promise<D1Result>;
  all: <T>() => Promise<D1Result<T>>;
  first: <T>() => Promise<T | null>;
};

export type CrmDatabase = {
  prepare: (query: string) => D1PreparedStatement;
  batch: (statements: D1PreparedStatement[]) => Promise<D1Result[]>;
};

export function getDb(): CrmDatabase {
  if (!env.DB) {
    throw new Error("Không tìm thấy vùng lưu dữ liệu DB.");
  }
  return env.DB as unknown as CrmDatabase;
}

const CREATE_STATEMENTS = [
  `CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY,
    customer_code TEXT NOT NULL DEFAULT '',
    company_name TEXT NOT NULL,
    account_type TEXT NOT NULL,
    industry TEXT NOT NULL DEFAULT '',
    region TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'Sales Fluke',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS contacts (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    full_name TEXT NOT NULL,
    title TEXT NOT NULL DEFAULT '',
    department TEXT NOT NULL DEFAULT '',
    buying_role TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    zalo TEXT NOT NULL DEFAULT '',
    preferred_channel TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS prospecting_leads (
    id TEXT PRIMARY KEY,
    company_name TEXT NOT NULL,
    website TEXT NOT NULL DEFAULT '',
    industry TEXT NOT NULL DEFAULT '',
    account_type TEXT NOT NULL DEFAULT 'End-User',
    contact_name TEXT NOT NULL DEFAULT '',
    title TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    last_email_date TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Chưa gửi',
    next_follow_up_date TEXT NOT NULL DEFAULT '',
    email_subject TEXT NOT NULL DEFAULT '',
    reply_notes TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'Mai Trần Thành',
    email_opt_out INTEGER NOT NULL DEFAULT 0,
    converted_opportunity_id TEXT NOT NULL DEFAULT '',
    converted_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_settings (
    id TEXT PRIMARY KEY,
    from_email TEXT NOT NULL,
    from_name TEXT NOT NULL DEFAULT 'Mai Trần Thành',
    username TEXT NOT NULL,
    smtp_host TEXT NOT NULL DEFAULT 'pro43.emailserver.vn',
    smtp_port INTEGER NOT NULL DEFAULT 465,
    smtp_security TEXT NOT NULL DEFAULT 'ssl',
    imap_host TEXT NOT NULL DEFAULT 'pro43.emailserver.vn',
    imap_port INTEGER NOT NULL DEFAULT 993,
    password_ciphertext TEXT NOT NULL DEFAULT '',
    password_iv TEXT NOT NULL DEFAULT '',
    default_subject TEXT NOT NULL DEFAULT '',
    default_body TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_assets (
    id TEXT PRIMARY KEY,
    object_key TEXT NOT NULL UNIQUE,
    file_name TEXT NOT NULL,
    content_type TEXT NOT NULL,
    size_bytes INTEGER NOT NULL DEFAULT 0,
    file_kind TEXT NOT NULL DEFAULT 'document',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_messages (
    id TEXT PRIMARY KEY,
    lead_id TEXT NOT NULL REFERENCES prospecting_leads(id) ON DELETE CASCADE,
    direction TEXT NOT NULL,
    sender_email TEXT NOT NULL DEFAULT '',
    recipient_email TEXT NOT NULL DEFAULT '',
    subject TEXT NOT NULL DEFAULT '',
    body_text TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Queued',
    campaign_id TEXT NOT NULL DEFAULT '',
    classification TEXT NOT NULL DEFAULT '',
    ai_summary TEXT NOT NULL DEFAULT '',
    suggested_action TEXT NOT NULL DEFAULT '',
    draft_reply TEXT NOT NULL DEFAULT '',
    ai_confidence REAL NOT NULL DEFAULT 0,
    ai_source TEXT NOT NULL DEFAULT '',
    ai_processed_at TEXT NOT NULL DEFAULT '',
    provider_message_id TEXT NOT NULL DEFAULT '',
    error_message TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL DEFAULT '',
    received_at TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_automation_settings (
    id TEXT PRIMARY KEY,
    enabled INTEGER NOT NULL DEFAULT 0,
    daily_limit INTEGER NOT NULL DEFAULT 20,
    batch_size INTEGER NOT NULL DEFAULT 2,
    send_start_hour INTEGER NOT NULL DEFAULT 8,
    send_end_hour INTEGER NOT NULL DEFAULT 17,
    weekdays_only INTEGER NOT NULL DEFAULT 1,
    auto_classify_replies INTEGER NOT NULL DEFAULT 1,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_campaigns (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    objective TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Draft',
    start_date TEXT NOT NULL,
    subject_template TEXT NOT NULL,
    body_template TEXT NOT NULL,
    follow_up_enabled INTEGER NOT NULL DEFAULT 0,
    follow_up_delay_days INTEGER NOT NULL DEFAULT 4,
    follow_up_subject_template TEXT NOT NULL DEFAULT '',
    follow_up_body_template TEXT NOT NULL DEFAULT '',
    industry_template_id TEXT NOT NULL DEFAULT '',
    industry_group TEXT NOT NULL DEFAULT '',
    sequence_json TEXT NOT NULL DEFAULT '[]',
    asset_ids_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_campaign_recipients (
    id TEXT PRIMARY KEY,
    campaign_id TEXT NOT NULL REFERENCES email_campaigns(id) ON DELETE CASCADE,
    lead_id TEXT NOT NULL REFERENCES prospecting_leads(id) ON DELETE CASCADE,
    status TEXT NOT NULL DEFAULT 'Queued',
    current_step INTEGER NOT NULL DEFAULT 0,
    next_send_at TEXT NOT NULL DEFAULT '',
    sent_at TEXT NOT NULL DEFAULT '',
    replied_at TEXT NOT NULL DEFAULT '',
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NOT NULL DEFAULT '',
    email_message_id TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS email_automation_runs (
    id TEXT PRIMARY KEY,
    run_type TEXT NOT NULL DEFAULT 'Scheduled',
    status TEXT NOT NULL DEFAULT 'Running',
    replies_added INTEGER NOT NULL DEFAULT 0,
    sent_count INTEGER NOT NULL DEFAULT 0,
    failed_count INTEGER NOT NULL DEFAULT 0,
    error_message TEXT NOT NULL DEFAULT '',
    started_at TEXT NOT NULL,
    completed_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS opportunities (
    id TEXT PRIMARY KEY,
    account_id TEXT NOT NULL REFERENCES accounts(id),
    contact_id TEXT NOT NULL REFERENCES contacts(id),
    product_application TEXT NOT NULL,
    need_pain TEXT NOT NULL DEFAULT '',
    stage TEXT NOT NULL DEFAULT 'Target Account',
    status TEXT NOT NULL DEFAULT 'Open',
    estimated_value INTEGER NOT NULL DEFAULT 0,
    expected_close_date TEXT NOT NULL DEFAULT '',
    actual_close_date TEXT NOT NULL DEFAULT '',
    last_contact_date TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    next_step_due TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'Sales Fluke',
    icp_fit INTEGER NOT NULL DEFAULT 0,
    need_score INTEGER NOT NULL DEFAULT 0,
    authority_score INTEGER NOT NULL DEFAULT 0,
    budget_score INTEGER NOT NULL DEFAULT 0,
    timing_score INTEGER NOT NULL DEFAULT 0,
    engagement_score INTEGER NOT NULL DEFAULT 0,
    channel_score INTEGER NOT NULL DEFAULT 0,
    competitor TEXT NOT NULL DEFAULT '',
    lost_reason TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    end_user_company TEXT NOT NULL DEFAULT '',
    end_user_address TEXT NOT NULL DEFAULT '',
    end_user_industry TEXT NOT NULL DEFAULT '',
    end_user_contact_name TEXT NOT NULL DEFAULT '',
    end_user_title TEXT NOT NULL DEFAULT '',
    end_user_phone TEXT NOT NULL DEFAULT '',
    end_user_email TEXT NOT NULL DEFAULT '',
    end_user_notes TEXT NOT NULL DEFAULT '',
    stage_entered_at TEXT NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS activities (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
    activity_date TEXT NOT NULL,
    activity_type TEXT NOT NULL,
    contact_name TEXT NOT NULL DEFAULT '',
    summary TEXT NOT NULL,
    outcome TEXT NOT NULL DEFAULT '',
    next_step TEXT NOT NULL DEFAULT '',
    due_date TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT 'Sales Fluke',
    status TEXT NOT NULL DEFAULT 'Completed',
    include_in_weekly_report INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT ''
  )`,
  `CREATE TABLE IF NOT EXISTS quotations (
    id TEXT PRIMARY KEY,
    opportunity_id TEXT NOT NULL REFERENCES opportunities(id),
    quotation_no TEXT NOT NULL UNIQUE,
    quote_date TEXT NOT NULL,
    expiration_date TEXT NOT NULL DEFAULT '',
    customer_id TEXT NOT NULL DEFAULT '',
    recipient_company TEXT NOT NULL,
    recipient_address TEXT NOT NULL DEFAULT '',
    attention TEXT NOT NULL DEFAULT '',
    recipient_email TEXT NOT NULL DEFAULT '',
    shipping_method TEXT NOT NULL DEFAULT 'Air Shipment',
    shipping_terms TEXT NOT NULL DEFAULT 'DDP',
    delivery_date TEXT NOT NULL DEFAULT '2-4 Weeks',
    payment_terms TEXT NOT NULL DEFAULT '100% TT',
    currency TEXT NOT NULL DEFAULT 'VND',
    vat_rate INTEGER NOT NULL DEFAULT 8,
    prepared_by TEXT NOT NULL DEFAULT 'MAI TRẦN THÀNH (+84 964 72 72 33)',
    status TEXT NOT NULL DEFAULT 'Draft',
    notes TEXT NOT NULL DEFAULT '',
    subtotal INTEGER NOT NULL DEFAULT 0,
    vat_amount INTEGER NOT NULL DEFAULT 0,
    total INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS quotation_items (
    id TEXT PRIMARY KEY,
    quotation_id TEXT NOT NULL REFERENCES quotations(id),
    line_no INTEGER NOT NULL,
    item_number TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL,
    application TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'PCS',
    quantity REAL NOT NULL DEFAULT 1,
    product_id TEXT NOT NULL DEFAULT '',
    list_price INTEGER NOT NULL DEFAULT 0,
    discount_percent REAL NOT NULL DEFAULT 0,
    origin TEXT NOT NULL DEFAULT '',
    warranty TEXT NOT NULL DEFAULT '12 tháng',
    unit_price INTEGER NOT NULL DEFAULT 0,
    amount INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    product_family TEXT NOT NULL DEFAULT '',
    model_group TEXT NOT NULL DEFAULT '',
    market_model TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL,
    normalized_model TEXT NOT NULL,
    item_no TEXT NOT NULL UNIQUE,
    description TEXT NOT NULL DEFAULT '',
    country_of_origin TEXT NOT NULL DEFAULT '',
    list_price_usd REAL NOT NULL DEFAULT 0,
    list_price_vnd INTEGER NOT NULL DEFAULT 0,
    item_status TEXT NOT NULL DEFAULT 'ACTIVE',
    gross_weight TEXT NOT NULL DEFAULT '',
    uom TEXT NOT NULL DEFAULT 'EA',
    warranty_text TEXT NOT NULL DEFAULT '12 tháng',
    high_touch INTEGER NOT NULL DEFAULT 0,
    price_source TEXT NOT NULL DEFAULT '',
    high_touch_source TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS pricing_settings (
    id TEXT PRIMARY KEY,
    use_manual_rate INTEGER NOT NULL DEFAULT 0,
    manual_rate REAL NOT NULL DEFAULT 0,
    buffer_percent REAL NOT NULL DEFAULT 0,
    rounding_step INTEGER NOT NULL DEFAULT 1000,
    last_live_rate REAL NOT NULL DEFAULT 26310,
    source_updated_at TEXT NOT NULL DEFAULT '',
    fetched_at TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS inventory_items (
    id TEXT PRIMARY KEY,
    product_id TEXT NOT NULL DEFAULT '',
    material_code TEXT NOT NULL UNIQUE,
    item_no TEXT NOT NULL DEFAULT '',
    description TEXT NOT NULL DEFAULT '',
    unit TEXT NOT NULL DEFAULT 'Bộ',
    quantity REAL NOT NULL DEFAULT 0,
    report_date TEXT NOT NULL DEFAULT '',
    source_file TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS weekly_reports (
    id TEXT PRIMARY KEY,
    week_start TEXT NOT NULL UNIQUE,
    week_end TEXT NOT NULL,
    report_date TEXT NOT NULL,
    week_number INTEGER NOT NULL,
    reporter TEXT NOT NULL DEFAULT 'Mai Trần Thành',
    status TEXT NOT NULL DEFAULT 'Draft',
    source_file TEXT NOT NULL DEFAULT '',
    plan_json TEXT NOT NULL DEFAULT '[]',
    projects_json TEXT NOT NULL DEFAULT '[]',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
  )`,
  "CREATE INDEX IF NOT EXISTS idx_opportunities_stage ON opportunities(stage)",
  "CREATE INDEX IF NOT EXISTS idx_opportunities_next_step_due ON opportunities(next_step_due)",
  "CREATE INDEX IF NOT EXISTS idx_activities_opportunity ON activities(opportunity_id)",
  "CREATE INDEX IF NOT EXISTS idx_prospecting_leads_status ON prospecting_leads(status)",
  "CREATE INDEX IF NOT EXISTS idx_prospecting_leads_follow_up ON prospecting_leads(next_follow_up_date)",
  "CREATE INDEX IF NOT EXISTS idx_prospecting_leads_email ON prospecting_leads(email)",
  "CREATE INDEX IF NOT EXISTS idx_email_messages_lead_created ON email_messages(lead_id, created_at)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_email_messages_provider_id ON email_messages(provider_message_id)",
  "CREATE INDEX IF NOT EXISTS idx_email_assets_created ON email_assets(created_at)",
  "CREATE INDEX IF NOT EXISTS idx_email_campaigns_status_start ON email_campaigns(status, start_date)",
  "CREATE UNIQUE INDEX IF NOT EXISTS idx_email_campaign_recipient_unique ON email_campaign_recipients(campaign_id, lead_id)",
  "CREATE INDEX IF NOT EXISTS idx_email_campaign_recipient_queue ON email_campaign_recipients(status, next_send_at)",
  "CREATE INDEX IF NOT EXISTS idx_email_campaign_recipient_lead ON email_campaign_recipients(lead_id)",
  "CREATE INDEX IF NOT EXISTS idx_email_automation_runs_started ON email_automation_runs(started_at)",
  "CREATE INDEX IF NOT EXISTS idx_quotations_opportunity ON quotations(opportunity_id)",
  "CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON quotation_items(quotation_id)",
  "CREATE INDEX IF NOT EXISTS idx_products_model ON products(normalized_model)",
  "CREATE INDEX IF NOT EXISTS idx_products_high_touch ON products(high_touch)",
  "CREATE INDEX IF NOT EXISTS idx_inventory_item_no ON inventory_items(item_no)",
  "CREATE INDEX IF NOT EXISTS idx_inventory_product ON inventory_items(product_id)",
  "CREATE INDEX IF NOT EXISTS idx_weekly_reports_week ON weekly_reports(week_start)",
];

const ACCOUNT_COLUMNS = [
  ["customer_code", "TEXT NOT NULL DEFAULT ''"],
] as const;

const LEAD_COLUMNS = [
  ["email_opt_out", "INTEGER NOT NULL DEFAULT 0"],
] as const;

const EMAIL_MESSAGE_COLUMNS = [
  ["campaign_id", "TEXT NOT NULL DEFAULT ''"],
  ["classification", "TEXT NOT NULL DEFAULT ''"],
  ["ai_summary", "TEXT NOT NULL DEFAULT ''"],
  ["suggested_action", "TEXT NOT NULL DEFAULT ''"],
  ["draft_reply", "TEXT NOT NULL DEFAULT ''"],
  ["ai_confidence", "REAL NOT NULL DEFAULT 0"],
  ["ai_source", "TEXT NOT NULL DEFAULT ''"],
  ["ai_processed_at", "TEXT NOT NULL DEFAULT ''"],
] as const;

const EMAIL_CAMPAIGN_COLUMNS = [
  ["industry_template_id", "TEXT NOT NULL DEFAULT ''"],
  ["industry_group", "TEXT NOT NULL DEFAULT ''"],
  ["sequence_json", "TEXT NOT NULL DEFAULT '[]'"],
] as const;

const OPPORTUNITY_COLUMNS = [
  ["end_user_company", "TEXT NOT NULL DEFAULT ''"],
  ["end_user_address", "TEXT NOT NULL DEFAULT ''"],
  ["end_user_industry", "TEXT NOT NULL DEFAULT ''"],
  ["end_user_contact_name", "TEXT NOT NULL DEFAULT ''"],
  ["end_user_title", "TEXT NOT NULL DEFAULT ''"],
  ["end_user_phone", "TEXT NOT NULL DEFAULT ''"],
  ["end_user_email", "TEXT NOT NULL DEFAULT ''"],
  ["end_user_notes", "TEXT NOT NULL DEFAULT ''"],
] as const;

const ACTIVITY_COLUMNS = [
  ["status", "TEXT NOT NULL DEFAULT 'Completed'"],
  ["include_in_weekly_report", "INTEGER NOT NULL DEFAULT 0"],
  ["updated_at", "TEXT NOT NULL DEFAULT ''"],
] as const;

const QUOTATION_ITEM_COLUMNS = [
  ["application", "TEXT NOT NULL DEFAULT ''"],
  ["product_id", "TEXT NOT NULL DEFAULT ''"],
  ["list_price", "INTEGER NOT NULL DEFAULT 0"],
  ["discount_percent", "REAL NOT NULL DEFAULT 0"],
  ["origin", "TEXT NOT NULL DEFAULT ''"],
  ["warranty", "TEXT NOT NULL DEFAULT '12 tháng'"],
] as const;

type SeedProduct = {
  id: string;
  productFamily: string;
  modelGroup: string;
  marketModel: string;
  model: string;
  normalizedModel: string;
  itemNo: string;
  description: string;
  countryOfOrigin: string;
  listPriceUsd: number;
  listPriceVnd: number;
  itemStatus: string;
  grossWeight: string;
  uom: string;
  warrantyText: string;
  highTouch: boolean;
  priceSource: string;
  highTouchSource: string;
};

let databaseReady: Promise<CrmDatabase> | null = null;
let productCatalogReady: Promise<CrmDatabase> | null = null;

async function initializeDatabase() {
  const db = getDb();
  for (const statement of CREATE_STATEMENTS) {
    await db.prepare(statement).run();
  }

  const accountColumnResult = await db.prepare("PRAGMA table_info(accounts)").all<{ name: string }>();
  const existingAccountColumns = new Set((accountColumnResult.results ?? []).map((column) => column.name));
  for (const [name, definition] of ACCOUNT_COLUMNS) {
    if (!existingAccountColumns.has(name)) {
      try {
        await db.prepare(`ALTER TABLE accounts ADD COLUMN ${name} ${definition}`).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }

  await db.prepare(`UPDATE accounts SET customer_code = UPPER(REPLACE(REPLACE(REPLACE(TRIM((
      SELECT q.customer_id FROM opportunities o
      JOIN quotations q ON q.opportunity_id = o.id
      WHERE o.account_id = accounts.id AND TRIM(q.customer_id) <> ''
      ORDER BY q.created_at ASC LIMIT 1
    )), ' ', ''), '-', ''), '/', ''))
    WHERE customer_code = '' AND EXISTS (
      SELECT 1 FROM opportunities o JOIN quotations q ON q.opportunity_id = o.id
      WHERE o.account_id = accounts.id AND TRIM(q.customer_id) <> ''
    )`).run();
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_accounts_customer_code ON accounts(customer_code)").run();

  const leadColumnResult = await db.prepare("PRAGMA table_info(prospecting_leads)").all<{ name: string }>();
  const existingLeadColumns = new Set((leadColumnResult.results ?? []).map((column) => column.name));
  for (const [name, definition] of LEAD_COLUMNS) {
    if (!existingLeadColumns.has(name)) {
      try {
        await db.prepare(`ALTER TABLE prospecting_leads ADD COLUMN ${name} ${definition}`).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }

  const emailMessageColumnResult = await db.prepare("PRAGMA table_info(email_messages)").all<{ name: string }>();
  const existingEmailMessageColumns = new Set((emailMessageColumnResult.results ?? []).map((column) => column.name));
  for (const [name, definition] of EMAIL_MESSAGE_COLUMNS) {
    if (!existingEmailMessageColumns.has(name)) {
      try {
        await db.prepare(`ALTER TABLE email_messages ADD COLUMN ${name} ${definition}`).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }

  const emailCampaignColumnResult = await db.prepare("PRAGMA table_info(email_campaigns)").all<{ name: string }>();
  const existingEmailCampaignColumns = new Set((emailCampaignColumnResult.results ?? []).map((column) => column.name));
  for (const [name, definition] of EMAIL_CAMPAIGN_COLUMNS) {
    if (!existingEmailCampaignColumns.has(name)) {
      try {
        await db.prepare(`ALTER TABLE email_campaigns ADD COLUMN ${name} ${definition}`).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }

  const columnResult = await db.prepare("PRAGMA table_info(opportunities)").all<{ name: string }>();
  const existingColumns = new Set((columnResult.results ?? []).map((column) => column.name));
  for (const [name, definition] of OPPORTUNITY_COLUMNS) {
    if (!existingColumns.has(name)) {
      try {
        await db.prepare(`ALTER TABLE opportunities ADD COLUMN ${name} ${definition}`).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }

  const itemColumnResult = await db.prepare("PRAGMA table_info(quotation_items)").all<{ name: string }>();
  const existingItemColumns = new Set((itemColumnResult.results ?? []).map((column) => column.name));
  for (const [name, definition] of QUOTATION_ITEM_COLUMNS) {
    if (!existingItemColumns.has(name)) {
      try {
        await db.prepare(`ALTER TABLE quotation_items ADD COLUMN ${name} ${definition}`).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }

  const activityColumnResult = await db.prepare("PRAGMA table_info(activities)").all<{ name: string }>();
  const existingActivityColumns = new Set((activityColumnResult.results ?? []).map((column) => column.name));
  for (const [name, definition] of ACTIVITY_COLUMNS) {
    if (!existingActivityColumns.has(name)) {
      try {
        await db.prepare(`ALTER TABLE activities ADD COLUMN ${name} ${definition}`).run();
      } catch (error) {
        if (!(error instanceof Error) || !error.message.includes("duplicate column name")) throw error;
      }
    }
  }
  await db.prepare("CREATE INDEX IF NOT EXISTS idx_activities_weekly_report ON activities(include_in_weekly_report, activity_date)").run();

  const now = new Date().toISOString();
  await db.prepare(`INSERT INTO email_automation_settings (
      id, enabled, daily_limit, batch_size, send_start_hour, send_end_hour,
      weekdays_only, auto_classify_replies, updated_at
    ) VALUES ('primary', 0, 20, 2, 8, 17, 1, 1, ?)
    ON CONFLICT(id) DO NOTHING`).bind(now).run();
  await db.prepare("UPDATE activities SET updated_at = created_at WHERE updated_at = ''").run();
  await db.batch([
    db.prepare(`DELETE FROM quotation_items WHERE quotation_id IN (
      SELECT id FROM quotations WHERE opportunity_id LIKE 'DEMO-%'
    )`),
    db.prepare("DELETE FROM quotations WHERE opportunity_id LIKE 'DEMO-%'"),
    db.prepare("DELETE FROM activities WHERE opportunity_id LIKE 'DEMO-%'"),
    db.prepare("DELETE FROM opportunities WHERE id LIKE 'DEMO-%'"),
    db.prepare(`DELETE FROM contacts WHERE id IN ('CON-001','CON-002','CON-003','CON-004','CON-005','CON-006','CON-007','CON-008')
      AND NOT EXISTS (SELECT 1 FROM opportunities WHERE contact_id = contacts.id)`),
    db.prepare(`DELETE FROM accounts WHERE id IN ('ACC-001','ACC-002','ACC-003','ACC-004','ACC-005','ACC-006','ACC-007','ACC-008')
      AND NOT EXISTS (SELECT 1 FROM opportunities WHERE account_id = accounts.id)`),
    db.prepare("UPDATE accounts SET owner = 'Mai Trần Thành', updated_at = ? WHERE owner = 'Sales Fluke'").bind(now),
    db.prepare("UPDATE opportunities SET owner = 'Mai Trần Thành', updated_at = ? WHERE owner = 'Sales Fluke'").bind(now),
    db.prepare("UPDATE activities SET owner = 'Mai Trần Thành' WHERE owner = 'Sales Fluke'"),
  ]);
  return db;
}

export function ensureDatabase() {
  if (!databaseReady) {
    databaseReady = initializeDatabase().catch((error) => {
      databaseReady = null;
      throw error;
    });
  }
  return databaseReady;
}

async function initializeProductCatalog() {
  const db = await ensureDatabase();
  const row = await db.prepare("SELECT COUNT(*) AS count FROM products").first<{ count: number }>();
  if ((row?.count ?? 0) > 0) return db;

  const products = seedProducts as SeedProduct[];
  const now = new Date().toISOString();
  const columns = `(id, product_family, model_group, market_model, model, normalized_model, item_no,
    description, country_of_origin, list_price_usd, list_price_vnd, item_status, gross_weight, uom,
    warranty_text, high_touch, price_source, high_touch_source, updated_at)`;
  const chunkSize = 5;
  for (let offset = 0; offset < products.length; offset += chunkSize * 100) {
    const statements = [];
    for (let inner = offset; inner < Math.min(products.length, offset + chunkSize * 100); inner += chunkSize) {
      const chunk = products.slice(inner, inner + chunkSize);
      const placeholders = chunk.map(() => `(${Array(19).fill("?").join(",")})`).join(",");
      const values = chunk.flatMap((product) => [
        product.id, product.productFamily, product.modelGroup, product.marketModel, product.model,
        product.normalizedModel, product.itemNo, product.description, product.countryOfOrigin,
        product.listPriceUsd, product.listPriceVnd, product.itemStatus, product.grossWeight, product.uom,
        product.warrantyText, product.highTouch ? 1 : 0, product.priceSource, product.highTouchSource, now,
      ]);
      statements.push(db.prepare(`INSERT OR IGNORE INTO products ${columns} VALUES ${placeholders}`).bind(...values));
    }
    await db.batch(statements);
  }
  return db;
}

export function ensureProductCatalog() {
  if (!productCatalogReady) {
    productCatalogReady = initializeProductCatalog().catch((error) => {
      productCatalogReady = null;
      throw error;
    });
  }
  return productCatalogReady;
}
