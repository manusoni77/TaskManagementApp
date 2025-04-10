import { MigrationInterface, QueryRunner } from "typeorm";

export class AddHashedRTToUser1744289269797 implements MigrationInterface {
    name = 'AddHashedRTToUser1744289269797'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" ADD "hashedRT" character varying`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.query(`ALTER TABLE "users" DROP COLUMN "hashedRT"`);
    }

}
