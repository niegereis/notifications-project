import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddWebhookAndDeliveryCycle1789570000000 implements MigrationInterface {
  name = 'AddWebhookAndDeliveryCycle1789570000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "callback_url" character varying(2048)`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD "delivery_cycle" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_attempts" ADD "cycle" integer NOT NULL DEFAULT 0`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_delivery_attempts_notification_number"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_delivery_attempts_notification_cycle_number" ON "delivery_attempts" ("notification_id", "cycle", "attempt_number")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."uq_delivery_attempts_notification_cycle_number"`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_delivery_attempts_notification_number" ON "delivery_attempts" ("notification_id", "attempt_number")`,
    );
    await queryRunner.query(`ALTER TABLE "delivery_attempts" DROP COLUMN "cycle"`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "delivery_cycle"`);
    await queryRunner.query(`ALTER TABLE "notifications" DROP COLUMN "callback_url"`);
  }
}
