import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRequestedByCreatedAtIndex1789565957396 implements MigrationInterface {
  name = 'AddRequestedByCreatedAtIndex1789565957396';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_requested_by_created_at" ON "notifications" ("requested_by", "created_at")`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX "public"."idx_notifications_requested_by_created_at"`);
  }
}
