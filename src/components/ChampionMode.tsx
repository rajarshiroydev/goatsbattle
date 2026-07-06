import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BattleResult } from "../lib/voteWire";
import type { StatSection } from "../lib/types";

/** Minimal fighter shape passed from the static /play page. */
export interface Fighter {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  nationality: string;
  countryCode: string;
  position: string;
  statSections: StatSection[];
}

interface Props {
  roster: Fighter[];
}

type Phase = "setup" | "arena" | "reveal" | "done";

/**
 * One completed bout in the gauntlet. The reigning `champion` faced `challenger`;
 * the player backed `picked` (which becomes the champion going forward). Crowd
 * fields are the global tally for that battle — framed against the player's own
 * pick, so the verdict is always coherent regardless of who they voted.
 */
interface Round {
  champion: Fighter;
  challenger: Fighter;
  picked: Fighter;
  /** Crowd % for the reigning champion in this bout (challenger = 100 − this). */
  championPct: number;
  totalVotes: number;
  /** Whether the crowd's leader matches the player's pick. */
  crowd: "agree" | "disagree" | "tie";
  /** Who the crowd backed, for the "disagree" message. */
  crowdLeader: Fighter | null;
  /** True when the challenger won the player's vote and took the throne. */
  dethroned: boolean;
}

/** How long the crowd verdict stays up before auto-advancing (ms). */
const REVEAL_HOLD = 2500;

/** Canonical battle id — always the two slugs sorted alphabetically. */
function battleId(a: string, b: string): string {
  return [a, b].sort().join("-vs-");
}

/** ISO alpha-2 → flag emoji. */
function flag(cc: string): string {
  const c = cc.trim().toUpperCase();
  if (!/^[A-Z]{2}$/.test(c)) return "";
  return String.fromCodePoint(
    0x1f1e6 + (c.charCodeAt(0) - 65),
    0x1f1e6 + (c.charCodeAt(1) - 65),
  );
}

function shuffle<T>(arr: T[]): T[] {
  const a = [...arr];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

/** Contender-count presets, always capped at (and including) the full roster. */
function countPresets(max: number): number[] {
  return Array.from(new Set([4, 6, 8, max]))
    .filter((n) => n >= 3 && n <= max)
    .sort((a, b) => a - b);
}

/** Parse a stat value ("0.79", 794, "130+") down to a comparable number. */
function toNum(v: string | number): number | null {
  const n = parseFloat(String(v).replace(/[^0-9.\-]/g, ""));
  return Number.isNaN(n) ? null : n;
}

interface StatRow {
  label: string;
  champ: string | number;
  opp: string | number;
  leader: "champ" | "opp" | "tie";
  champPct: number;
}
interface StatCompare {
  winsChamp: number;
  winsOpp: number;
  rows: StatRow[];
}

/** Champion-vs-challenger comparison across the stat sections they share. */
function compareStats(champ: Fighter, opp: Fighter): StatCompare {
  let winsChamp = 0;
  let winsOpp = 0;
  const rows: StatRow[] = [];
  for (const secC of champ.statSections) {
    const secO = opp.statSections.find((s) => s.heading === secC.heading);
    if (!secO) continue;
    for (const sc of secC.stats) {
      const so = secO.stats.find((s) => s.label === sc.label);
      if (!so) continue;
      const a = toNum(sc.value);
      const b = toNum(so.value);
      let leader: StatRow["leader"] = "tie";
      let champPct = 50;
      if (a !== null && b !== null && a + b > 0) {
        champPct = Math.round((a / (a + b)) * 100);
        if (a > b) {
          leader = "champ";
          winsChamp++;
        } else if (b > a) {
          leader = "opp";
          winsOpp++;
        }
      }
      rows.push({
        label: sc.label,
        champ: sc.value,
        opp: so.value,
        leader,
        champPct,
      });
    }
  }
  return { winsChamp, winsOpp, rows };
}

export default function ChampionMode({ roster }: Props) {
  const presets = useMemo(() => countPresets(roster.length), [roster.length]);
  const [phase, setPhase] = useState<Phase>("setup");
  const [count, setCount] = useState<number>(
    presets.includes(8) ? 8 : presets[presets.length - 1],
  );
  const [champion, setChampion] = useState<Fighter | null>(null);
  const [queue, setQueue] = useState<Fighter[]>([]);
  const [idx, setIdx] = useState(0);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [current, setCurrent] = useState<Round | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(true);
  const advanceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const opponent = queue[idx] ?? null;
  const agreed = useMemo(
    () => rounds.filter((r) => r.crowd === "agree").length,
    [rounds],
  );
  const cmp = useMemo(
    () => (champion && opponent ? compareStats(champion, opponent) : null),
    [champion, opponent],
  );

  function clearTimer() {
    if (advanceTimer.current) {
      clearTimeout(advanceTimer.current);
      advanceTimer.current = null;
    }
  }

  // Cancel any pending auto-advance if the island unmounts mid-reveal, so the
  // timeout never fires next()/setState on a torn-down component.
  useEffect(() => clearTimer, []);

  function start(n: number) {
    clearTimer();
    const pool = shuffle(roster).slice(0, n);
    setChampion(pool[0]);
    setQueue(pool.slice(1));
    setIdx(0);
    setRounds([]);
    setCurrent(null);
    setError(null);
    setPhase("arena");
  }

  async function cast(picked: Fighter) {
    if (!champion || !opponent || pending) return;
    setError(null);
    setPending(true);
    setCurrent(null);
    setPhase("reveal"); // flip immediately so the crowd-counting state shows without lag

    try {
      const res = await fetch("/api/vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          battleId: battleId(champion.slug, opponent.slug),
          choice: picked.id,
        }),
      });
      const data: BattleResult = await res.json();
      if (!res.ok) throw new Error((data as any)?.error ?? "Vote failed");

      const champVotes = champion.id === data.entityA ? data.votesA : data.votesB;
      const challVotes = champion.id === data.entityA ? data.votesB : data.votesA;
      const championPct = champion.id === data.entityA ? data.pctA : data.pctB;

      const crowdLeader =
        champVotes > challVotes
          ? champion
          : challVotes > champVotes
            ? opponent
            : null;
      const crowd: Round["crowd"] = !crowdLeader
        ? "tie"
        : crowdLeader.id === picked.id
          ? "agree"
          : "disagree";

      const round: Round = {
        champion,
        challenger: opponent,
        picked,
        championPct,
        totalVotes: champVotes + challVotes,
        crowd,
        crowdLeader,
        dethroned: picked.id === opponent.id,
      };
      setCurrent(round);
      clearTimer();
      advanceTimer.current = setTimeout(() => next(round), REVEAL_HOLD); // auto-advance
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
      setPhase("arena"); // let them retry the vote
    } finally {
      setPending(false);
    }
  }

  function next(round?: Round) {
    clearTimer();
    const r = round ?? current;
    if (!r) return;
    setRounds((prev) => [...prev, r]);
    setChampion(r.picked); // the winner of the bout carries on / holds the throne
    setCurrent(null);
    setError(null);
    if (idx + 1 >= queue.length) {
      setPhase("done");
    } else {
      setIdx((i) => i + 1);
      setPhase("arena");
    }
  }

  function reset() {
    clearTimer();
    setPhase("setup");
    setChampion(null);
    setQueue([]);
    setIdx(0);
    setRounds([]);
    setCurrent(null);
    setError(null);
  }

  // ── SETUP ────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <div class="max-w-2xl mx-auto px-5 py-12 md:py-20 text-center">
        <p class="font-mono text-[11px] uppercase tracking-widest text-lime mb-4">
          Champion Mode
        </p>
        <h1
          class="font-headline font-black uppercase leading-[0.9] tracking-tight text-ink"
          style="font-size: clamp(2.5rem, 8vw, 5.5rem)"
        >
          Crown Your <span class="text-lime">GOAT</span>
        </h1>
        <p class="mt-5 font-sans text-body text-base leading-relaxed max-w-md mx-auto">
          Two legends enter — you pick the greater. Your winner stays on and faces
          the next challenger. Keep voting until one is left standing. No pre-picks,
          no bias: your GOAT is whoever survives your own calls.
        </p>

        <div class="mt-10">
          <p class="font-mono text-[11px] uppercase tracking-widest text-mute mb-4">
            How many contenders?
          </p>
          <div class="flex flex-wrap gap-2 justify-center">
            {presets.map((n) => (
              <button
                onClick={() => setCount(n)}
                class={`font-headline font-black uppercase text-lg tracking-wide px-6 h-12 flex items-center rounded-sm border transition-all ${
                  count === n
                    ? "bg-lime text-canvas border-lime"
                    : "bg-canvas-soft text-ink border-hairline hover:border-hairline-strong"
                }`}
              >
                {n}
                {n === roster.length && (
                  <span
                    class={`ml-2 font-mono text-[11px] tracking-widest ${count === n ? "text-canvas/70" : "text-mute"}`}
                  >
                    ALL
                  </span>
                )}
              </button>
            ))}
          </div>
          <p class="mt-3 font-mono text-[11px] uppercase tracking-widest text-mute">
            {count} legends · {count - 1} bouts
          </p>
        </div>

        <button
          onClick={() => start(count)}
          class="mt-10 font-headline font-black uppercase tracking-wider text-base bg-lime text-canvas px-10 h-12 inline-flex items-center rounded-sm hover:bg-lime-dark transition-colors"
        >
          Enter the Arena →
        </button>
      </div>
    );
  }

  // ── DONE ─────────────────────────────────────────────
  if (phase === "done" && champion) {
    const total = rounds.length;
    const backedGoat = rounds.filter((r) => r.picked.id === champion.id).length;
    const inSync = total > 0 ? Math.round((agreed / total) * 100) : 0;
    const alignedLine =
      inSync >= 67
        ? `The world is on your wavelength — it agreed with ${inSync}% of your calls.`
        : inSync >= 34
          ? `You and the crowd part ways often — only ${inSync}% agreement.`
          : `You're a contrarian: the crowd disagreed with most of your calls (${inSync}% aligned).`;

    return (
      <div class="max-w-3xl mx-auto px-5 py-14 md:py-20 text-center anim-arena">
        <p class="font-mono text-[11px] uppercase tracking-widest text-lime mb-4">
          Your GOAT
        </p>
        <h1
          class="font-headline font-black uppercase leading-[0.9] tracking-tight text-ink"
          style="font-size: clamp(3rem, 11vw, 7rem)"
        >
          {champion.shortName}
        </h1>
        <p class="mt-3 font-sans text-body text-base">
          {flag(champion.countryCode)} {champion.name} · left standing after {total}{" "}
          {total === 1 ? "bout" : "bouts"}
        </p>

        <div class="mt-10 grid grid-cols-3 gap-3 max-w-sm mx-auto">
          {[
            { n: backedGoat, l: "Times backed", c: "text-lime" },
            { n: agreed, l: "Crowd agreed", c: "text-ink" },
            { n: `${inSync}%`, l: "In sync", c: "text-ink" },
          ].map(({ n, l, c }) => (
            <div class="bg-canvas-soft border border-hairline rounded-md py-4">
              <p class={`font-headline font-black text-3xl leading-none ${c}`}>{n}</p>
              <p class="font-mono text-[11px] uppercase tracking-widest text-mute mt-1.5">
                {l}
              </p>
            </div>
          ))}
        </div>

        <p class="mt-6 font-sans text-body text-sm leading-relaxed max-w-md mx-auto">
          {alignedLine}
        </p>

        {/* Path recap */}
        <div class="mt-10 text-left max-w-md mx-auto">
          <p class="font-mono text-[11px] uppercase tracking-widest text-mute mb-3">
            Your path
          </p>
          <div class="space-y-1.5">
            {rounds.map((r) => (
              <div class="flex items-center gap-3 bg-canvas-soft border border-hairline rounded-sm px-4 py-2.5">
                <span class="font-headline font-black uppercase text-sm text-ink flex-1 truncate">
                  {r.champion.shortName} <span class="text-mute">vs</span>{" "}
                  {r.challenger.shortName}
                </span>
                <span class="font-mono text-[11px] uppercase tracking-wider text-lime">
                  ▸ {r.picked.shortName}
                </span>
                <span
                  class="text-xs"
                  title={
                    r.crowd === "agree"
                      ? "Crowd agreed"
                      : r.crowd === "disagree"
                        ? "Crowd disagreed"
                        : "Split"
                  }
                >
                  {r.crowd === "agree" ? "🟢" : r.crowd === "disagree" ? "🔴" : "⚪"}
                </span>
              </div>
            ))}
          </div>
        </div>

        <div class="mt-10 flex flex-wrap gap-3 justify-center">
          <a
            href={`/goats/${champion.slug}`}
            class="font-headline font-black uppercase tracking-wider text-base bg-lime text-canvas px-8 h-12 flex items-center rounded-sm hover:bg-lime-dark transition-colors"
          >
            {champion.shortName}'s Profile
          </a>
          <a
            href="/rankings/football"
            class="font-sans font-medium text-sm text-ink border border-hairline-strong px-6 h-12 flex items-center rounded-sm hover:border-lime hover:text-lime transition-colors"
          >
            See the Rankings
          </a>
          <button
            onClick={reset}
            class="font-sans font-medium text-sm text-body px-6 h-12 flex items-center rounded-sm hover:text-ink transition-colors"
          >
            Play again
          </button>
        </div>
      </div>
    );
  }

  if (!champion || !opponent) return null;

  // ── ARENA / REVEAL ───────────────────────────────────
  const boutNo = idx + 1;
  const totalBouts = queue.length;
  const champPct = current ? current.championPct : 50;
  const pickedIsChamp = current ? current.picked.id === champion.id : false;

  return (
    <div class="max-w-4xl mx-auto px-5 py-8 md:py-10">
      {/* Status bar */}
      <div class="flex items-center justify-between mb-6">
        <div class="flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-mute">
          <span class="text-lime">👑 {champion.shortName}</span>
          <span>· Bout {boutNo} / {totalBouts}</span>
        </div>
        <div class="font-mono text-[11px] uppercase tracking-widest text-mute">
          In sync <span class="text-lime">{agreed}</span>
        </div>
      </div>

      {/* Progress dots */}
      <div class="flex gap-1.5 mb-8">
        {queue.map((_, i) => {
          const r = rounds[i];
          const cls = r
            ? r.crowd === "agree"
              ? "bg-lime"
              : r.crowd === "disagree"
                ? "bg-red"
                : "bg-body"
            : i === idx
              ? "bg-ink"
              : "bg-hairline";
          return <span class={`h-1 flex-1 rounded-full ${cls} transition-colors`}></span>;
        })}
      </div>

      {/* Matchup card — re-keyed per bout so it animates in each round */}
      <div
        key={`${champion.id}-${opponent.id}`}
        class="anim-arena relative flex items-stretch min-h-[200px] md:min-h-[240px] bg-canvas-soft border border-hairline rounded-md overflow-hidden"
      >
        {/* Reigning champion */}
        <div class="anim-champion flex-1 flex flex-col justify-between px-6 py-7 md:px-9">
          <div>
            <p class="font-mono text-[11px] uppercase tracking-widest text-lime mb-2">
              👑 Reigning
            </p>
            <h2
              class="font-headline font-black uppercase leading-none tracking-tight text-ink"
              style="font-size: clamp(2rem, 6vw, 4rem)"
            >
              {champion.shortName}
            </h2>
          </div>
          <span class="font-sans text-sm text-body">
            {flag(champion.countryCode)} {champion.nationality}
          </span>
        </div>

        <div class="absolute inset-y-0 left-1/2 -translate-x-1/2 flex items-center justify-center pointer-events-none z-10">
          <span
            class="anim-slash font-headline font-black text-[7rem] md:text-[10rem] leading-none text-lime select-none"
            style="text-shadow: 0 0 50px rgba(200,255,0,0.3)"
          >
            /
          </span>
        </div>

        {/* Challenger */}
        <div class="anim-challenger flex-1 flex flex-col justify-between px-6 py-7 md:px-9 items-end text-right">
          <div>
            <p class="font-mono text-[11px] uppercase tracking-widest text-body mb-2">
              Challenger
            </p>
            <h2
              class="font-headline font-black uppercase leading-none tracking-tight text-ink"
              style="font-size: clamp(2rem, 6vw, 4rem)"
            >
              {opponent.shortName}
            </h2>
          </div>
          <span class="font-sans text-sm text-body">
            {opponent.nationality} {flag(opponent.countryCode)}
          </span>
        </div>
      </div>

      {/* Stat comparison — the decision aid */}
      {cmp && (
        <div
          key={`stats-${champion.id}-${opponent.id}`}
          class="anim-arena mt-4 bg-canvas-soft border border-hairline rounded-md"
        >
          <button
            onClick={() => setShowStats((s) => !s)}
            class="w-full flex items-center justify-between px-5 py-3 text-left"
          >
            <div class="flex items-center gap-3">
              <span class="font-mono text-[11px] uppercase tracking-widest text-mute">
                Stat Scoreline
              </span>
              <span class="font-headline font-black uppercase text-sm">
                <span class={cmp.winsChamp >= cmp.winsOpp ? "text-lime" : "text-ink"}>
                  {champion.shortName} {cmp.winsChamp}
                </span>
                <span class="text-mute mx-1.5">–</span>
                <span class={cmp.winsOpp > cmp.winsChamp ? "text-lime" : "text-ink"}>
                  {cmp.winsOpp} {opponent.shortName}
                </span>
              </span>
            </div>
            <span class="font-mono text-[11px] uppercase tracking-widest text-mute">
              {showStats ? "Hide ▴" : `${cmp.rows.length} stats ▾`}
            </span>
          </button>

          {showStats && (
            <div class="px-5 pb-4 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5 border-t border-hairline pt-4">
              {cmp.rows.map((row) => (
                <div class="flex items-center gap-3">
                  <span
                    class={`font-headline font-black text-base leading-none w-14 text-right ${row.leader === "champ" ? "text-lime" : "text-ink"}`}
                  >
                    {row.champ}
                  </span>
                  <div class="flex-1 min-w-0">
                    <p class="font-mono text-[11px] uppercase tracking-wider text-mute truncate text-center mb-1">
                      {row.label}
                    </p>
                    <div class="flex h-1 gap-0.5 rounded-full overflow-hidden">
                      <div
                        style={`width:${row.champPct}%`}
                        class={row.leader === "champ" ? "bg-lime" : "bg-hairline-strong"}
                      ></div>
                      <div
                        style={`width:${100 - row.champPct}%`}
                        class={row.leader === "opp" ? "bg-lime" : "bg-hairline-strong"}
                      ></div>
                    </div>
                  </div>
                  <span
                    class={`font-headline font-black text-base leading-none w-14 ${row.leader === "opp" ? "text-lime" : "text-ink"}`}
                  >
                    {row.opp}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Action / reveal */}
      {phase === "arena" ? (
        <div class="mt-6">
          <div class="flex flex-col sm:flex-row items-center gap-3 justify-center">
            <button
              onClick={() => cast(champion)}
              disabled={pending}
              class="font-headline font-black uppercase tracking-wider text-base bg-canvas-soft-2 text-ink border border-hairline-strong px-8 h-12 flex items-center rounded-sm hover:border-lime hover:text-lime transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              Keep {champion.shortName}
            </button>
            <span class="font-mono text-[11px] uppercase tracking-widest text-mute">vs</span>
            <button
              onClick={() => cast(opponent)}
              disabled={pending}
              class="font-headline font-black uppercase tracking-wider text-base bg-canvas-soft-2 text-ink border border-hairline-strong px-8 h-12 flex items-center rounded-sm hover:border-lime hover:text-lime transition-colors disabled:opacity-50 whitespace-nowrap"
            >
              Crown {opponent.shortName}
            </button>
          </div>
          <p class="text-center font-mono text-[11px] uppercase tracking-widest text-mute mt-3">
            Pick the greater · your vote moves the global rankings
          </p>
          {error && (
            <p class="text-center font-mono text-[11px] uppercase tracking-widest text-red mt-3">
              {error}
            </p>
          )}
        </div>
      ) : !current ? (
        /* Counting state — shown instantly on click while the vote is in flight */
        <div class="mt-6">
          <div class="flex items-center justify-between font-headline font-black uppercase mb-2 opacity-40">
            <span class="text-2xl text-ink">{champion.shortName}</span>
            <span class="text-2xl text-ink">{opponent.shortName}</span>
          </div>
          <div class="flex h-3 gap-0.5 rounded-full overflow-hidden bg-hairline">
            <div class="w-1/2 bg-hairline-strong animate-pulse"></div>
          </div>
          <p class="text-center font-mono text-[11px] uppercase tracking-widest text-mute mt-3 animate-pulse">
            Reading the room…
          </p>
        </div>
      ) : (
        <div class="mt-6 anim-verdict">
          {/* Crowd split — champion left, challenger right; the side you backed is lime */}
          <div class="flex items-center justify-between font-headline font-black uppercase mb-2">
            <span class={`text-2xl ${pickedIsChamp ? "text-lime" : "text-ink"}`}>
              {champion.shortName} {champPct}%
            </span>
            <span class={`text-2xl ${!pickedIsChamp ? "text-lime" : "text-ink"}`}>
              {100 - champPct}% {opponent.shortName}
            </span>
          </div>
          <div class="flex h-3 gap-0.5 rounded-full overflow-hidden">
            <div
              style={`width:${champPct}%`}
              class={`anim-bar ${pickedIsChamp ? "bg-lime" : "bg-hairline-strong"}`}
            ></div>
            <div
              style={`width:${100 - champPct}%`}
              class={`anim-bar ${!pickedIsChamp ? "bg-lime" : "bg-hairline-strong"}`}
            ></div>
          </div>

          {/* Throne outcome */}
          <p class="text-center font-headline font-black uppercase tracking-wide text-lg mt-5">
            {current.dethroned ? (
              <span class="text-lime">👑 {current.picked.shortName} takes the throne</span>
            ) : (
              <span class="text-ink">🛡 {current.picked.shortName} holds the throne</span>
            )}
          </p>
          {/* Crowd agreement */}
          <p class="text-center font-mono text-[11px] uppercase tracking-widest mt-1">
            {current.crowd === "agree" && (
              <span class="text-lime">The world's with you</span>
            )}
            {current.crowd === "disagree" && (
              <span class="text-red">
                The world disagrees — backs {current.crowdLeader?.shortName}
              </span>
            )}
            {current.crowd === "tie" && <span class="text-body">Too close to call</span>}
            <span class="text-mute"> · {current.totalVotes.toLocaleString()} votes</span>
          </p>

          <div class="mt-6 flex flex-col items-center gap-2">
            <button
              onClick={() => next()}
              class="font-headline font-black uppercase tracking-wider text-base bg-lime text-canvas px-10 h-12 flex items-center rounded-sm hover:bg-lime-dark transition-colors"
            >
              {boutNo >= totalBouts ? "Crown Your GOAT →" : "Next Challenger →"}
            </button>
            <span class="font-mono text-[11px] uppercase tracking-widest text-mute">
              Auto-advancing…
            </span>
          </div>
        </div>
      )}
    </div>
  );
}
