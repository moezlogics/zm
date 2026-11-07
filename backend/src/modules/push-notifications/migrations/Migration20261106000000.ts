import { Migration } from "@medusajs/framework/mikro-orm/migrations";

/**
 * Push upgrade:
 *  - push_campaign: source / product_id / partition columns for auto pushes
 *  - push_auto_log: one row per product decided by the new-product auto push
 *  - push_delivery (campaign_id, endpoint): the shown/click callbacks look a
 *    row up by exactly this pair on every impression — without it each
 *    callback scanned the campaign's rows.
 *
 * Every statement is guarded, so re-running is a no-op.
 */
export class Migration20261106000000 extends Migration {

  override async up(): Promise<void> {
    this.addSql(`alter table if exists "push_campaign" add column if not exists "source" text null;`);
    this.addSql(`alter table if exists "push_campaign" add column if not exists "product_id" text null;`);
    this.addSql(`alter table if exists "push_campaign" add column if not exists "partition_index" integer null;`);
    this.addSql(`alter table if exists "push_campaign" add column if not exists "partitions_total" integer null;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_push_campaign_source" ON "push_campaign" ("source") WHERE deleted_at IS NULL;`);

    this.addSql(`create table if not exists "push_auto_log" ("id" text not null, "product_id" text not null, "product_title" text null, "status" text check ("status" in ('baseline', 'sent', 'skipped', 'failed')) not null default 'sent', "reason" text null, "partition_index" integer null, "partitions_total" integer null, "campaign_id" text null, "created_at" timestamptz not null default now(), "updated_at" timestamptz not null default now(), "deleted_at" timestamptz null, constraint "push_auto_log_pkey" primary key ("id"));`);
    this.addSql(`CREATE UNIQUE INDEX IF NOT EXISTS "IDX_push_auto_log_product_id_unique" ON "push_auto_log" ("product_id") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_push_auto_log_status_created" ON "push_auto_log" ("status", "created_at") WHERE deleted_at IS NULL;`);
    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_push_auto_log_deleted_at" ON "push_auto_log" ("deleted_at") WHERE deleted_at IS NULL;`);

    this.addSql(`CREATE INDEX IF NOT EXISTS "IDX_push_delivery_campaign_endpoint" ON "push_delivery" ("campaign_id", "endpoint") WHERE deleted_at IS NULL;`);
  }

  override async down(): Promise<void> {
    this.addSql(`drop table if exists "push_auto_log" cascade;`);
    this.addSql(`drop index if exists "IDX_push_delivery_campaign_endpoint";`);
    this.addSql(`drop index if exists "IDX_push_campaign_source";`);
    this.addSql(`alter table if exists "push_campaign" drop column if exists "source";`);
    this.addSql(`alter table if exists "push_campaign" drop column if exists "product_id";`);
    this.addSql(`alter table if exists "push_campaign" drop column if exists "partition_index";`);
    this.addSql(`alter table if exists "push_campaign" drop column if exists "partitions_total";`);
  }

}
