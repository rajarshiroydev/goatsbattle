/**
 * Seeds the database with the curated football entities and every canonical
 * battle pairing. Idempotent: re-running upserts entities/battles without
 * wiping vote counts or Elo.
 *
 * Run with:  npm run db:seed   (loads .env via --env-file)
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { footballEntities, footballBattlePairs } from '../src/data/football';
import { getBattleId } from '../src/lib/battle';
import { entities, battles } from '../src/lib/db/schema';

async function main() {
  console.log('→ Seeding entities…');
  // Single upsert: refresh display fields but preserve elo / vote tallies.
  await db
    .insert(entities)
    .values(
      footballEntities.map((e) => ({
        id: e.slug,
        name: e.name,
        shortName: e.shortName,
        category: e.category,
        countryCode: e.countryCode,
        elo: e.initialElo,
      })),
    )
    .onConflictDoUpdate({
      target: entities.id,
      set: {
        name: sql`excluded.name`,
        shortName: sql`excluded.short_name`,
        category: sql`excluded.category`,
        countryCode: sql`excluded.country_code`,
      },
    });
  console.log(`  ✓ ${footballEntities.length} entities`);

  console.log('→ Seeding battles…');
  await db
    .insert(battles)
    .values(
      footballBattlePairs.map(([a, b]) => ({
        id: getBattleId(a, b),
        entityA: a,
        entityB: b,
        category: 'football',
      })),
    )
    .onConflictDoNothing({ target: battles.id });
  console.log(`  ✓ ${footballBattlePairs.length} battles`);

  const [[entityRow], [battleRow]] = await Promise.all([
    db.select({ count: sql<number>`count(*)::int` }).from(entities),
    db.select({ count: sql<number>`count(*)::int` }).from(battles),
  ]);
  console.log(`\n✓ Done. ${entityRow.count} entities, ${battleRow.count} battles in DB.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
