import {
  assertDatabaseTarget,
  getRequestedTarget,
  printVerifiedDatabaseState,
  exitOnDatabaseError,
} from './lib/database-safety';

async function main() {
  const target = getRequestedTarget();
  await assertDatabaseTarget(target, 'verify database state');
  await printVerifiedDatabaseState('Verified database state:');
}

main().catch(exitOnDatabaseError);
