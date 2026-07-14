/** Create exact, reviewed GOAT-to-provider player mappings from imported moments. */
import { neon } from '@neondatabase/serverless';
import { THE_STATS_API_PROVIDER } from '../src/lib/theStatsApi';
import { exitOnDatabaseError, runDatabaseOperation } from './lib/database-safety';

const reviewedPlayers = [
  { goatSlug: 'messi', providerName: 'Lionel Messi' },
  { goatSlug: 'mbappe', providerName: 'Kylian Mbappé' },
  { goatSlug: 'ronaldo', providerName: 'Cristiano Ronaldo' },
  { goatSlug: 'neymar', providerName: 'Neymar' },
] as const;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error('DATABASE_URL is not set.');
  const query = neon(connectionString);

  const mappings: Array<{
    goatSlug: string;
    providerPlayerId: string;
    providerName: string;
  }> = [];
  for (const reviewed of reviewedPlayers) {
    const rows = await query.query(
      `SELECT DISTINCT provider_player_id AS "providerPlayerId"
       FROM match_moments
       WHERE provider = $1 AND player_name = $2 AND provider_player_id IS NOT NULL`,
      [THE_STATS_API_PROVIDER, reviewed.providerName],
    ) as Array<{ providerPlayerId: string }>;
    if (rows.length !== 1) {
      throw new Error(
        `Expected exactly one reviewed provider identity for ${reviewed.providerName}; found ${rows.length}.`,
      );
    }
    mappings.push({ ...reviewed, providerPlayerId: rows[0].providerPlayerId });
  }

  await query.query(
    `WITH incoming AS (
       SELECT * FROM jsonb_to_recordset($1::jsonb) AS mapping(
         "goatSlug" text, "providerPlayerId" text, "providerName" text
       )
     )
     INSERT INTO goat_provider_players (
       goat_slug, provider, provider_player_id, verified_at
     )
     SELECT incoming."goatSlug", $2, incoming."providerPlayerId",
            now()
     FROM incoming
     JOIN entities ON entities.id = incoming."goatSlug"
     ON CONFLICT (goat_slug, provider) DO UPDATE SET
       provider_player_id = excluded.provider_player_id,
       verified_at = excluded.verified_at`,
    [JSON.stringify(mappings), THE_STATS_API_PROVIDER],
  );
  await query.query(
    `UPDATE match_moments moment SET goat_slug = mapping.goat_slug
     FROM goat_provider_players mapping
     WHERE moment.provider = mapping.provider
       AND moment.provider_player_id = mapping.provider_player_id
       AND mapping.provider = $1`,
    [THE_STATS_API_PROVIDER],
  );

  const verification = await query.query(
    `SELECT mapping.goat_slug AS "goatSlug",
            mapping.provider_player_id AS "providerPlayerId",
            count(moment.id)::int AS "taggedMoments"
     FROM goat_provider_players mapping
     LEFT JOIN match_moments moment
       ON moment.provider = mapping.provider
      AND moment.provider_player_id = mapping.provider_player_id
      AND moment.goat_slug = mapping.goat_slug
     WHERE mapping.provider = $1
     GROUP BY mapping.goat_slug, mapping.provider_player_id
     ORDER BY mapping.goat_slug`,
    [THE_STATS_API_PROVIDER],
  ) as Array<{
    goatSlug: string;
    providerPlayerId: string;
    taggedMoments: number;
  }>;
  if (verification.length !== reviewedPlayers.length) {
    throw new Error(`Expected ${reviewedPlayers.length} verified GOAT mappings; found ${verification.length}.`);
  }
  if (verification.some((row) => Number(row.taggedMoments) < 1)) {
    throw new Error(`Every reviewed GOAT mapping must tag at least one imported moment: ${JSON.stringify(verification)}.`);
  }
  console.log(JSON.stringify({ mappings: verification }, null, 2));
}

runDatabaseOperation({ operation: 'TheStatsAPI reviewed GOAT player mapping' }, main)
  .catch(exitOnDatabaseError);
