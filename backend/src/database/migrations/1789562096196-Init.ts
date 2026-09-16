import { MigrationInterface, QueryRunner } from 'typeorm';

export class Init1789562096196 implements MigrationInterface {
  name = 'Init1789562096196';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // Necessária para o uuid_generate_v4() usado como default das PKs.
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await queryRunner.query(
      `CREATE TYPE "public"."notification_channel" AS ENUM('EMAIL', 'SMS', 'PUSH')`,
    );
    await queryRunner.query(
      `CREATE TABLE "templates" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "event_type" character varying(100) NOT NULL, "channel" "public"."notification_channel" NOT NULL, "subject" character varying(255), "body" text NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_515948649ce0bbbe391de702ae5" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_templates_event_channel" ON "templates"  ("event_type", "channel") `,
    );
    // O enum notification_channel é compartilhado com a tabela templates e
    // já foi criado acima — o gerador do TypeORM o repete por entidade.
    await queryRunner.query(
      `CREATE TYPE "public"."notification_status" AS ENUM('PENDING', 'PROCESSING', 'SENT', 'FAILED')`,
    );
    await queryRunner.query(
      `CREATE TABLE "notifications" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "channel" "public"."notification_channel" NOT NULL, "event_type" character varying(100) NOT NULL, "recipient" character varying(255) NOT NULL, "payload" jsonb NOT NULL DEFAULT '{}', "status" "public"."notification_status" NOT NULL DEFAULT 'PENDING', "requested_by" character varying(100) NOT NULL, "subject" character varying(255), "body" text NOT NULL, "failure_reason" text, "sent_at" TIMESTAMP WITH TIME ZONE, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), "template_id" uuid, CONSTRAINT "PK_6a72c3c0f683f6462415e653c3a" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_created_at" ON "notifications"  ("created_at") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_recipient" ON "notifications"  ("recipient") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_channel_status" ON "notifications"  ("channel", "status") `,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_notifications_status_created_at" ON "notifications"  ("status", "created_at") `,
    );
    await queryRunner.query(
      `CREATE TYPE "public"."delivery_attempt_status" AS ENUM('SUCCESS', 'FAILURE')`,
    );
    await queryRunner.query(
      `CREATE TABLE "delivery_attempts" ("id" uuid NOT NULL DEFAULT uuid_generate_v4(), "notification_id" uuid NOT NULL, "attempt_number" integer NOT NULL, "status" "public"."delivery_attempt_status" NOT NULL, "provider_message_id" character varying(255), "error" text, "duration_ms" integer NOT NULL, "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(), CONSTRAINT "PK_41eba4eb5401d72860f7cd9a7ac" PRIMARY KEY ("id"))`,
    );
    await queryRunner.query(
      `CREATE INDEX "idx_delivery_attempts_notification" ON "delivery_attempts"  ("notification_id") `,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX "uq_delivery_attempts_notification_number" ON "delivery_attempts"  ("notification_id", "attempt_number") `,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" ADD CONSTRAINT "FK_e37d0438b1fffd0f210df30b271" FOREIGN KEY ("template_id") REFERENCES "templates"("id") ON DELETE SET NULL ON UPDATE NO ACTION`,
    );
    await queryRunner.query(
      `ALTER TABLE "delivery_attempts" ADD CONSTRAINT "FK_67dd933d9083dcebb403b8595b5" FOREIGN KEY ("notification_id") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE NO ACTION`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TABLE "delivery_attempts" DROP CONSTRAINT "FK_67dd933d9083dcebb403b8595b5"`,
    );
    await queryRunner.query(
      `ALTER TABLE "notifications" DROP CONSTRAINT "FK_e37d0438b1fffd0f210df30b271"`,
    );
    await queryRunner.query(`DROP INDEX "public"."uq_delivery_attempts_notification_number"`);
    await queryRunner.query(`DROP INDEX "public"."idx_delivery_attempts_notification"`);
    await queryRunner.query(`DROP TABLE "delivery_attempts"`);
    await queryRunner.query(`DROP TYPE "public"."delivery_attempt_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_notifications_status_created_at"`);
    await queryRunner.query(`DROP INDEX "public"."idx_notifications_channel_status"`);
    await queryRunner.query(`DROP INDEX "public"."idx_notifications_recipient"`);
    await queryRunner.query(`DROP INDEX "public"."idx_notifications_created_at"`);
    await queryRunner.query(`DROP TABLE "notifications"`);
    await queryRunner.query(`DROP TYPE "public"."notification_status"`);
    await queryRunner.query(`DROP INDEX "public"."uq_templates_event_channel"`);
    await queryRunner.query(`DROP TABLE "templates"`);
    await queryRunner.query(`DROP TYPE "public"."notification_channel"`);
  }
}
