/**
 * Seeds the database with the curated entities and every canonical battle
 * pairing. Idempotent: re-running upserts entities/battles without wiping vote
 * tallies.
 *
 * Run with:  npm run db:seed   (loads .env via --env-file)
 */
import { sql } from 'drizzle-orm';
import { db } from './lib/node-db';
import { allEntities, allBattlePairs } from '../src/data';
import { getBattleId } from '../src/lib/battle';
import { entities, battles } from '../src/lib/db/schema';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

async function main() {
  console.log('→ Seeding entities…');
  // Single upsert: refresh display fields but preserve vote tallies (votes
  // default to 0 for new rows).
  await db
    .insert(entities)
    .values(
      allEntities.map((e) => ({
        id: e.slug,
        name: e.name,
        shortName: e.shortName,
        arena: e.arena,
        countryCode: e.countryCode,
      })),
    )
    .onConflictDoUpdate({
      target: entities.id,
      set: {
        name: sql`excluded.name`,
        shortName: sql`excluded.short_name`,
        arena: sql`excluded.arena`,
        countryCode: sql`excluded.country_code`,
      },
    });
  console.log(`  ✓ ${allEntities.length} entities`);

  console.log('→ Seeding battles…');
  const arenaBySlug = new Map(allEntities.map((e) => [e.slug, e.arena]));
  await db
    .insert(battles)
    .values(
      allBattlePairs.map(([a, b]) => ({
        id: getBattleId(a, b),
        entityA: a,
        entityB: b,
        arena: arenaBySlug.get(a)!,
      })),
    )
    .onConflictDoNothing({ target: battles.id });
  console.log(`  ✓ ${allBattlePairs.length} battles`);

  const [[entityRow], [battleRow]] = await Promise.all([
    db.select({
      count: sql<number>`count(*)::int`,
      fabricatedTallies: sql<number>`coalesce(sum(${entities.votes} + ${entities.votesFor} + ${entities.votesAgainst}), 0)::int`,
    }).from(entities),
    db.select({
      count: sql<number>`count(*)::int`,
      fabricatedTallies: sql<number>`coalesce(sum(${battles.votesA} + ${battles.votesB}), 0)::int`,
    }).from(battles),
  ]);
  if (entityRow.fabricatedTallies !== 0 || battleRow.fabricatedTallies !== 0) {
    throw new Error(
      `Refusing seeded state with non-zero aggregates: entities=${entityRow.fabricatedTallies}, battles=${battleRow.fabricatedTallies}.`,
    );
  }
  console.log(`\n✓ Done. ${entityRow.count} entities, ${battleRow.count} battles in DB.`);
  console.log('✓ All entity and battle vote aggregates are zero.');
}

runDatabaseOperation({ operation: 'curated goat/battle seed' }, main).catch(exitOnDatabaseError);
