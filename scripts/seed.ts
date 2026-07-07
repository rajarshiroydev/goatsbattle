/**
 * Seeds the database with the curated entities and every canonical battle
 * pairing. Idempotent: re-running upserts entities/battles without wiping vote
 * tallies.
 *
 * Run with:  npm run db:seed   (loads .env via --env-file)
 */
import { sql } from 'drizzle-orm';
import { db } from '../src/lib/db';
import { allEntities, allBattlePairs } from '../src/data';
import { getBattleId } from '../src/lib/battle';
import { entities, battles } from '../src/lib/db/schema';

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
        category: e.category,
        countryCode: e.countryCode,
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
  console.log(`  ✓ ${allEntities.length} entities`);

  console.log('→ Seeding battles…');
  const categoryBySlug = new Map(allEntities.map((e) => [e.slug, e.category]));
  await db
    .insert(battles)
    .values(
      allBattlePairs.map(([a, b]) => ({
        id: getBattleId(a, b),
        entityA: a,
        entityB: b,
        category: categoryBySlug.get(a)!,
      })),
    )
    .onConflictDoNothing({ target: battles.id });
  console.log(`  ✓ ${allBattlePairs.length} battles`);

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
