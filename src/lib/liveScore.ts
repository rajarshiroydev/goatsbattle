export interface LiveScoreOverlay {
  homeScore: number | null;
  awayScore: number | null;
  provisional: boolean;
}

/**
 * TheStatsAPI's timeline can lead its match resource by several minutes. While
 * a match is live and the timeline has full coverage, its active goal moments
 * are the freshest score authority. Outside that gate, keep the match resource
 * unchanged.
 */
export function deriveLiveScore(options: {
  status: string;
  timelineCoverage: string | null;
  providerHomeScore: number | null;
  providerAwayScore: number | null;
  timelineHomeGoals: number | null;
  timelineAwayGoals: number | null;
}): LiveScoreOverlay {
  const {
    status,
    timelineCoverage,
    providerHomeScore,
    providerAwayScore,
    timelineHomeGoals,
    timelineAwayGoals,
  } = options;

  if (status !== 'live' || timelineCoverage !== 'full') {
    return {
      homeScore: providerHomeScore,
      awayScore: providerAwayScore,
      provisional: false,
    };
  }

  const homeScore = timelineHomeGoals ?? 0;
  const awayScore = timelineAwayGoals ?? 0;
  return {
    homeScore,
    awayScore,
    provisional: homeScore !== (providerHomeScore ?? 0)
      || awayScore !== (providerAwayScore ?? 0),
  };
}
