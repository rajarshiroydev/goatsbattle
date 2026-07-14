import type { WorldCupStage } from '../lib/worldCupProvider';

type RawStage = 'group' | 'r32' | 'r16' | 'qf' | 'sf' | 'third' | 'final';
type FixtureTuple = readonly [
  number, RawStage, string, number, string, string, string | null, string | null,
  number, number, boolean,
];

export interface WorldCupCanonicalFixture {
  matchNumber: number;
  id: string;
  providerFixtureId: string;
  stage: WorldCupStage;
  kickoff: string;
  venue: string;
  homeTeam: string;
  awayTeam: string;
  homeCode: string | null;
  awayCode: string | null;
  homeScore: number | null;
  awayScore: number | null;
  status: 'scheduled' | 'finished';
}

/**
 * Versioned launch snapshot, 2026-07-13.
 *
 * Match numbering, stage graph, dates and venues follow FIFA's published 104-
 * match schedule. Match 101 uses FIFA's current 14:00 Dallas listing. Filled
 * teams/results are a fallback snapshot
 * of worldcup26.ir and are replaced only by validated score/status enrichment.
 * No event, lineup, scorer, or GOAT-participation claims are stored here.
 */
const FIXTURES: readonly FixtureTuple[] = [
  [1,'group','06/11/2026 13:00',1,'Mexico','South Africa','MEX','RSA',2,0,true],
  [2,'group','06/11/2026 20:00',2,'South Korea','Czech Republic','KOR','CZE',2,1,true],
  [3,'group','06/12/2026 15:00',12,'Canada','Bosnia and Herzegovina','CAN','BIH',1,1,true],
  [4,'group','06/12/2026 18:00',16,'United States','Paraguay','USA','PAR',4,1,true],
  [5,'group','06/13/2026 21:00',9,'Haiti','Scotland','HAI','SCO',0,1,true],
  [6,'group','06/13/2026 21:00',13,'Australia','Turkey','AUS','TUR',2,0,true],
  [7,'group','06/13/2026 18:00',11,'Brazil','Morocco','BRA','MAR',1,1,true],
  [8,'group','06/13/2026 12:00',15,'Qatar','Switzerland','QAT','SUI',1,1,true],
  [9,'group','06/14/2026 19:00',10,'Ivory Coast','Ecuador','CIV','ECU',1,0,true],
  [10,'group','06/14/2026 12:00',5,'Germany','Curaçao','GER','CUW',7,1,true],
  [11,'group','06/14/2026 15:00',4,'Netherlands','Japan','NED','JPN',2,2,true],
  [12,'group','06/14/2026 20:00',3,'Sweden','Tunisia','SWE','TUN',5,1,true],
  [13,'group','06/15/2026 18:00',16,'Iran','New Zealand','IRN','NZL',2,2,true],
  [14,'group','06/15/2026 12:00',7,'Spain','Cape Verde','ESP','CPV',0,0,true],
  [15,'group','06/15/2026 12:00',14,'Belgium','Egypt','BEL','EGY',1,1,true],
  [16,'group','06/15/2026 18:00',8,'Saudi Arabia','Uruguay','KSA','URU',1,1,true],
  [17,'group','06/16/2026 15:00',11,'France','Senegal','FRA','SEN',3,1,true],
  [18,'group','06/16/2026 18:00',9,'Iraq','Norway','IRQ','NOR',1,4,true],
  [19,'group','06/16/2026 20:00',6,'Argentina','Algeria','ARG','ALG',3,0,true],
  [20,'group','06/16/2026 21:00',15,'Austria','Jordan','AUT','JOR',3,1,true],
  [21,'group','06/17/2026 12:00',5,'Portugal','Democratic Republic of the Congo','POR','COD',1,1,true],
  [22,'group','06/17/2026 15:00',4,'England','Croatia','ENG','CRO',4,2,true],
  [23,'group','06/17/2026 20:00',1,'Uzbekistan','Colombia','UZB','COL',1,3,true],
  [24,'group','06/17/2026 19:00',12,'Ghana','Panama','GHA','PAN',1,0,true],
  [25,'group','06/18/2026 19:00',2,'Mexico','South Korea','MEX','KOR',1,0,true],
  [26,'group','06/18/2026 12:00',16,'Switzerland','Bosnia and Herzegovina','SUI','BIH',4,1,true],
  [27,'group','06/18/2026 15:00',13,'Canada','Qatar','CAN','QAT',6,0,true],
  [28,'group','06/18/2026 12:00',7,'Czech Republic','South Africa','CZE','RSA',1,1,true],
  [29,'group','06/19/2026 21:00',10,'Brazil','Haiti','BRA','HAI',3,0,true],
  [30,'group','06/19/2026 18:00',9,'Scotland','Morocco','SCO','MAR',0,1,true],
  [31,'group','06/19/2026 12:00',14,'United States','Australia','USA','AUS',2,0,true],
  [32,'group','06/19/2026 20:00',15,'Turkey','Paraguay','TUR','PAR',0,1,true],
  [33,'group','06/20/2026 16:00',12,'Germany','Ivory Coast','GER','CIV',2,1,true],
  [34,'group','06/20/2026 19:00',6,'Ecuador','Curaçao','ECU','CUW',0,0,true],
  [35,'group','06/20/2026 12:00',5,'Netherlands','Sweden','NED','SWE',5,1,true],
  [36,'group','06/20/2026 22:00',3,'Tunisia','Japan','TUN','JPN',0,4,true],
  [37,'group','06/21/2026 12:00',16,'Belgium','Iran','BEL','IRN',0,0,true],
  [38,'group','06/21/2026 18:00',13,'New Zealand','Egypt','NZL','EGY',1,3,true],
  [39,'group','06/21/2026 12:00',7,'Spain','Saudi Arabia','ESP','KSA',4,0,true],
  [40,'group','06/21/2026 18:00',8,'Uruguay','Cape Verde','URU','CPV',2,2,true],
  [41,'group','06/22/2026 17:00',10,'France','Iraq','FRA','IRQ',3,0,true],
  [42,'group','06/22/2026 20:00',11,'Norway','Senegal','NOR','SEN',3,2,true],
  [43,'group','06/22/2026 12:00',4,'Argentina','Austria','ARG','AUT',2,0,true],
  [44,'group','06/22/2026 20:00',15,'Jordan','Algeria','JOR','ALG',1,2,true],
  [45,'group','06/23/2026 12:00',5,'Portugal','Uzbekistan','POR','UZB',5,0,true],
  [46,'group','06/23/2026 19:00',12,'Panama','Croatia','PAN','CRO',0,1,true],
  [47,'group','06/23/2026 20:00',2,'Colombia','Democratic Republic of the Congo','COL','COD',1,0,true],
  [48,'group','06/23/2026 16:00',9,'England','Ghana','ENG','GHA',0,0,true],
  [49,'group','06/24/2026 18:00',8,'Scotland','Brazil','SCO','BRA',0,3,true],
  [50,'group','06/24/2026 18:00',7,'Morocco','Haiti','MAR','HAI',4,2,true],
  [51,'group','06/24/2026 19:00',3,'South Africa','South Korea','RSA','KOR',1,0,true],
  [52,'group','06/24/2026 19:00',1,'Czech Republic','Mexico','CZE','MEX',0,3,true],
  [53,'group','06/24/2026 12:00',14,'Bosnia and Herzegovina','Qatar','BIH','QAT',3,1,true],
  [54,'group','06/24/2026 12:00',13,'Switzerland','Canada','SUI','CAN',2,1,true],
  [55,'group','06/25/2026 16:00',10,'Curaçao','Ivory Coast','CUW','CIV',0,2,true],
  [56,'group','06/25/2026 16:00',11,'Ecuador','Germany','ECU','GER',2,1,true],
  [57,'group','06/25/2026 19:00',15,'Paraguay','Australia','PAR','AUS',0,0,true],
  [58,'group','06/25/2026 19:00',16,'Turkey','United States','TUR','USA',3,2,true],
  [59,'group','06/25/2026 18:00',4,'Japan','Sweden','JPN','SWE',1,1,true],
  [60,'group','06/25/2026 18:00',6,'Tunisia','Netherlands','TUN','NED',1,3,true],
  [61,'group','06/26/2026 15:00',12,'Senegal','Iraq','SEN','IRQ',5,0,true],
  [62,'group','06/26/2026 15:00',9,'Norway','France','NOR','FRA',1,4,true],
  [63,'group','06/26/2026 20:00',14,'Egypt','Iran','EGY','IRN',1,1,true],
  [64,'group','06/26/2026 20:00',13,'New Zealand','Belgium','NZL','BEL',1,5,true],
  [65,'group','06/26/2026 19:00',5,'Cape Verde','Saudi Arabia','CPV','KSA',0,0,true],
  [66,'group','06/26/2026 18:00',2,'Uruguay','Spain','URU','ESP',0,1,true],
  [67,'group','06/27/2026 17:00',11,'Panama','England','PAN','ENG',0,2,true],
  [68,'group','06/27/2026 17:00',10,'Croatia','Ghana','CRO','GHA',2,1,true],
  [69,'group','06/27/2026 21:00',6,'Algeria','Austria','ALG','AUT',3,3,true],
  [70,'group','06/27/2026 21:00',4,'Jordan','Argentina','JOR','ARG',1,3,true],
  [71,'group','06/27/2026 19:30',8,'Colombia','Portugal','COL','POR',0,0,true],
  [72,'group','06/27/2026 19:30',7,'Democratic Republic of the Congo','Uzbekistan','COD','UZB',3,1,true],
  [73,'r32','06/28/2026 12:00',16,'South Africa','Canada','RSA','CAN',0,1,true],
  [74,'r32','06/29/2026 16:30',9,'Germany','Paraguay','GER','PAR',1,1,true],
  [75,'r32','06/29/2026 19:00',3,'Netherlands','Morocco','NED','MAR',1,1,true],
  [76,'r32','06/29/2026 12:00',5,'Brazil','Japan','BRA','JPN',2,1,true],
  [77,'r32','06/30/2026 17:00',11,'France','Sweden','FRA','SWE',3,0,true],
  [78,'r32','06/30/2026 12:00',4,'Ivory Coast','Norway','CIV','NOR',1,2,true],
  [79,'r32','06/30/2026 19:00',1,'Mexico','Ecuador','MEX','ECU',2,0,true],
  [80,'r32','07/01/2026 12:00',7,'England','Democratic Republic of the Congo','ENG','COD',2,1,true],
  [81,'r32','07/01/2026 17:00',15,'United States','Bosnia and Herzegovina','USA','BIH',2,0,true],
  [82,'r32','07/01/2026 13:00',14,'Belgium','Senegal','BEL','SEN',3,2,true],
  [83,'r32','07/02/2026 19:00',12,'Portugal','Croatia','POR','CRO',2,1,true],
  [84,'r32','07/02/2026 12:00',16,'Spain','Austria','ESP','AUT',3,0,true],
  [85,'r32','07/02/2026 20:00',13,'Switzerland','Algeria','SUI','ALG',2,0,true],
  [86,'r32','07/03/2026 18:00',8,'Argentina','Cape Verde','ARG','CPV',3,2,true],
  [87,'r32','07/03/2026 20:30',6,'Colombia','Ghana','COL','GHA',1,0,true],
  [88,'r32','07/03/2026 13:00',4,'Australia','Egypt','AUS','EGY',1,1,true],
  [89,'r16','07/04/2026 17:00',10,'Paraguay','France','PAR','FRA',0,1,true],
  [90,'r16','07/04/2026 12:00',5,'Canada','Morocco','CAN','MAR',0,3,true],
  [91,'r16','07/05/2026 16:00',11,'Brazil','Norway','BRA','NOR',1,2,true],
  [92,'r16','07/05/2026 18:00',1,'Mexico','England','MEX','ENG',2,3,true],
  [93,'r16','07/06/2026 14:00',4,'Portugal','Spain','POR','ESP',0,1,true],
  [94,'r16','07/06/2026 17:00',14,'United States','Belgium','USA','BEL',1,4,true],
  [95,'r16','07/07/2026 12:00',7,'Argentina','Egypt','ARG','EGY',3,2,true],
  [96,'r16','07/07/2026 13:00',13,'Switzerland','Colombia','SUI','COL',0,0,true],
  [97,'qf','07/09/2026 16:00',9,'France','Morocco','FRA','MAR',2,0,true],
  [98,'qf','07/10/2026 12:00',16,'Spain','Belgium','ESP','BEL',2,1,true],
  [99,'qf','07/11/2026 17:00',8,'Norway','England','NOR','ENG',1,2,true],
  [100,'qf','07/11/2026 20:00',6,'Argentina','Switzerland','ARG','SUI',3,1,true],
  [101,'sf','07/14/2026 14:00',4,'France','Spain','FRA','ESP',0,0,false],
  [102,'sf','07/15/2026 15:00',7,'England','Argentina','ENG','ARG',0,0,false],
  [103,'third','07/18/2026 17:00',8,'Loser Match 101','Loser Match 102',null,null,0,0,false],
  [104,'final','07/19/2026 15:00',11,'Winner Match 101','Winner Match 102',null,null,0,0,false],
];

const STAGES: Readonly<Record<RawStage, WorldCupStage>> = {
  group: 'group', r32: 'round-of-32', r16: 'round-of-16', qf: 'quarterfinal',
  sf: 'semifinal', third: 'third-place', final: 'final',
};

const STADIUMS: Readonly<Record<number, { venue: string; utcOffset: number }>> = {
  1: { venue: 'Mexico City Stadium', utcOffset: 6 },
  2: { venue: 'Estadio Guadalajara', utcOffset: 6 },
  3: { venue: 'Estadio Monterrey', utcOffset: 6 },
  4: { venue: 'Dallas Stadium', utcOffset: 5 },
  5: { venue: 'Houston Stadium', utcOffset: 5 },
  6: { venue: 'Kansas City Stadium', utcOffset: 5 },
  7: { venue: 'Atlanta Stadium', utcOffset: 4 },
  8: { venue: 'Miami Stadium', utcOffset: 4 },
  9: { venue: 'Boston Stadium', utcOffset: 4 },
  10: { venue: 'Philadelphia Stadium', utcOffset: 4 },
  11: { venue: 'New York/New Jersey Stadium', utcOffset: 4 },
  12: { venue: 'Toronto Stadium', utcOffset: 4 },
  13: { venue: 'BC Place Vancouver', utcOffset: 7 },
  14: { venue: 'Seattle Stadium', utcOffset: 7 },
  15: { venue: 'San Francisco Bay Area Stadium', utcOffset: 7 },
  16: { venue: 'Los Angeles Stadium', utcOffset: 7 },
};

const ALPHA2: Readonly<Record<string, string>> = {
  ALG:'DZ',ARG:'AR',AUS:'AU',AUT:'AT',BEL:'BE',BIH:'BA',BRA:'BR',CAN:'CA',
  CIV:'CI',COD:'CD',COL:'CO',CPV:'CV',CRO:'HR',CUW:'CW',CZE:'CZ',ECU:'EC',
  EGY:'EG',ENG:'GB',ESP:'ES',FRA:'FR',GER:'DE',GHA:'GH',HAI:'HT',IRN:'IR',
  IRQ:'IQ',JOR:'JO',JPN:'JP',KOR:'KR',KSA:'SA',MAR:'MA',MEX:'MX',NED:'NL',
  NOR:'NO',NZL:'NZ',PAN:'PA',PAR:'PY',POR:'PT',QAT:'QA',RSA:'ZA',SCO:'GB',
  SEN:'SN',SUI:'CH',SWE:'SE',TUN:'TN',TUR:'TR',URU:'UY',USA:'US',UZB:'UZ',
};

function kickoffUtc(localDate: string, stadiumId: number): string {
  const match = localDate.match(/^(\d{2})\/(\d{2})\/(\d{4}) (\d{2}):(\d{2})$/);
  if (!match) throw new Error(`Invalid canonical kickoff: ${localDate}.`);
  const [, month, day, year, hour, minute] = match;
  const stadium = STADIUMS[stadiumId];
  if (!stadium) throw new Error(`Unknown stadium id ${stadiumId}.`);
  return new Date(Date.UTC(
    Number(year), Number(month) - 1, Number(day),
    Number(hour) + stadium.utcOffset, Number(minute),
  )).toISOString();
}

export const worldCup2026Fixtures: readonly WorldCupCanonicalFixture[] = FIXTURES.map((fixture) => {
  const [matchNumber, rawStage, localDate, stadiumId, homeTeam, awayTeam,
    homeFifaCode, awayFifaCode, homeScore, awayScore, finished] = fixture;
  return {
    matchNumber,
    id: `world-cup-2026-match-${matchNumber}`,
    providerFixtureId: `worldcup26-community:${matchNumber}`,
    stage: STAGES[rawStage],
    kickoff: kickoffUtc(localDate, stadiumId),
    venue: STADIUMS[stadiumId].venue,
    homeTeam,
    awayTeam,
    homeCode: homeFifaCode ? ALPHA2[homeFifaCode] ?? null : null,
    awayCode: awayFifaCode ? ALPHA2[awayFifaCode] ?? null : null,
    homeScore: finished ? homeScore : null,
    awayScore: finished ? awayScore : null,
    status: finished ? 'finished' : 'scheduled',
  };
});

if (worldCup2026Fixtures.length !== 104) {
  throw new Error(`Canonical World Cup fixture count is ${worldCup2026Fixtures.length}, expected 104.`);
}
