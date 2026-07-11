import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import type { BattleResult } from "../lib/voteWire";
import type { StatSection } from "../lib/types";
import { useSession } from "../lib/useSession";
import { openAuthModal } from "../lib/authModal";
import { arenaLabel, arenaEmoji } from "../data/arenas";

/** Minimal fighter shape passed from the static /play page. */
export interface Fighter {
  id: string;
  slug: string;
  name: string;
  shortName: string;
  nationality: string;
  countryCode: string;
  position: string;
  arena: string;
  statSections: StatSection[];
}

type Mode = 'ranked' | 'friendly';

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

/** Split a full name into a leading part + surname for the two-line display. */
function splitName(name: string): { first: string; last: string } {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return { first: "", last: parts[0] };
  return { first: parts.slice(0, -1).join(" "), last: parts[parts.length - 1] };
}

/**
 * One pick in the arena (design §8 / 3g). Left is lime, right is red, always.
 * `isChampion` picks the Keep vs Crown verb + a reigning kicker, and keys off
 * the entry animation so only the incoming challenger animates in.
 */
function PickCard({
  fighter,
  tone,
  isChampion,
  onPick,
  disabled,
}: {
  fighter: Fighter;
  tone: "lime" | "red";
  isChampion: boolean;
  onPick: () => void;
  disabled: boolean;
}) {
  const color = tone === "lime" ? "var(--color-lime)" : "var(--color-red)";
  const gradient =
    tone === "lime"
      ? "linear-gradient(180deg, rgba(198,255,0,0.05), transparent)"
      : "linear-gradient(180deg, rgba(255,45,85,0.05), transparent)";
  const name = splitName(fighter.name);
  const top = fighter.statSections[0]?.stats[0];
  const meta = top ? `${fighter.position} · ${top.value}${top.unit ?? ""} ${top.label}` : `${flag(fighter.countryCode)} ${fighter.nationality} · ${fighter.position}`;
  return (
    <div
      class={`rounded-md border border-hairline p-7 md:p-[30px] text-center transition-colors ${isChampion ? "" : "anim-challenger"}`}
      style={`background-image:${gradient}; background-color: var(--color-canvas-soft)`}
    >
      <div class="font-mono text-[10px] uppercase tracking-[0.18em]" style={isChampion ? `color:${color}` : "color:var(--color-mute)"}>
        {isChampion ? "👑 Reigning" : "Challenger"}
      </div>
      {/* Reserve two lines so single- and double-line names occupy the same
          height — keeps the meta line and vote button aligned across both cards. */}
      <div class="font-headline font-black uppercase leading-[0.9] tracking-tight text-ink mt-3 min-h-[1.8em] flex flex-col justify-center" style="font-size: clamp(2.25rem, 5vw, 54px)">
        <span>{name.first && <>{name.first}<br /></>}<span style={`color:${color}`}>{name.last}</span></span>
      </div>
      <div class="font-sans text-[13px] text-mute mt-3">{meta}</div>
      <button
        type="button"
        onClick={onPick}
        disabled={disabled}
        class={`btn ${tone === "lime" ? "btn-primary" : "btn-danger"} text-[15px] px-[30px] py-3 mt-5 disabled:opacity-50`}
      >
        {isChampion ? "Keep" : "Crown"} {fighter.shortName}
      </button>
    </div>
  );
}

export default function ChampionMode({ roster }: Props) {
  const { user, loading: sessionLoading } = useSession();
  const presets = useMemo(() => countPresets(roster.length), [roster.length]);
  const arena = roster[0]?.arena ?? "football";
  const [mode, setMode] = useState<Mode>("ranked");
  const [phase, setPhase] = useState<Phase>("setup");
  const [count, setCount] = useState<number>(
    presets.includes(8) ? 8 : presets[presets.length - 1],
  );
  /** Result of the +5 crown award on a ranked run's finish. */
  const [crownResult, setCrownResult] = useState<{ awarded: number; total: number } | null>(null);
  const [champion, setChampion] = useState<Fighter | null>(null);
  /** Which physical side the reigning champion sits on. The winner keeps their
   *  side between bouts; only the incoming challenger takes the vacated slot. */
  const [championSide, setChampionSide] = useState<"left" | "right">("left");
  const [queue, setQueue] = useState<Fighter[]>([]);
  const [idx, setIdx] = useState(0);
  const [rounds, setRounds] = useState<Round[]>([]);
  const [current, setCurrent] = useState<Round | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showStats, setShowStats] = useState(false);
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

  async function start(n: number) {
    clearTimer();
    setError(null);

    // Ranked runs write votes, so they require login. Friendly runs are open.
    // Wait for the session to resolve before deciding, so a logged-in user
    // isn't wrongly bounced to the auth modal on a slow session lookup.
    if (mode === "ranked" && sessionLoading) return;
    if (mode === "ranked" && !user) {
      openAuthModal({ reason: "Log in for Ranked mode" });
      return;
    }

    // Ranked runs exclude GOATs this user has already crowned in the last 24h,
    // so a favourite can't be farmed. Friendly runs use everyone.
    let eligible = roster;
    if (mode === "ranked") {
      try {
        const res = await fetch(`/api/locked?arena=${encodeURIComponent(arena)}`);
        const data = await res.json();
        const locked = new Set<string>(data.locked ?? []);
        eligible = roster.filter((f) => !locked.has(f.id));
      } catch {
        /* on failure, fall back to the full roster */
      }
      if (eligible.length < 3) {
        setError("You've already crowned most GOATs today — switch to Friendly to keep playing.");
        return;
      }
    }

    const pool = shuffle(eligible).slice(0, Math.min(n, eligible.length));
    setChampion(pool[0]);
    setChampionSide("left");
    setQueue(pool.slice(1));
    setIdx(0);
    setRounds([]);
    setCurrent(null);
    setCrownResult(null);
    setPhase("arena");
  }

  /** Award the crowned champion +5 votes (ranked runs only). */
  async function awardCrown(champ: Fighter) {
    try {
      const res = await fetch("/api/rank-vote", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ goatSlug: champ.id, channel: "champion" }),
      });
      const data = await res.json();
      setCrownResult({ awarded: res.ok ? data.awarded ?? 0 : 0, total: data.total ?? 0 });
    } catch {
      setCrownResult({ awarded: 0, total: 0 });
    }
  }

  async function cast(picked: Fighter) {
    if (!champion || !opponent || pending) return;
    setError(null);
    setPending(true);
    setCurrent(null);
    setPhase("reveal"); // flip immediately so the crowd-counting state shows without lag

    try {
      // Ranked bouts record a head-to-head vote; friendly bouts just read the
      // matchup's current crowd split without writing anything.
      const bid = battleId(champion.slug, opponent.slug);
      const res =
        mode === "ranked"
          ? await fetch("/api/vote", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ battleId: bid, choice: picked.id }),
            })
          : await fetch(`/api/results?battle=${encodeURIComponent(bid)}`);
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
    // If the challenger won, they keep the side they were already on — so the
    // reigning slot flips to the challenger's side and the next contender takes
    // the vacated one. If the champion held, sides are unchanged.
    if (r.dethroned) setChampionSide((s) => (s === "left" ? "right" : "left"));
    setCurrent(null);
    setError(null);
    if (idx + 1 >= queue.length) {
      setPhase("done");
      // The last GOAT standing is crowned — a ranked run awards it +5 votes.
      if (mode === "ranked") awardCrown(r.picked);
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
    setCrownResult(null);
    setChampionSide("left");
    setError(null);
  }

  // ── SETUP ────────────────────────────────────────────
  if (phase === "setup") {
    return (
      <>
        {/* Header band — matches the shared PageHeader shape used across the site. */}
        <section class="border-b border-hairline relative overflow-hidden">
          <div
            class="absolute inset-0 pointer-events-none"
            aria-hidden="true"
            style="background: radial-gradient(ellipse 70% 60% at 50% -10%, rgba(200,255,0,0.08) 0%, transparent 60%)"
          ></div>
          <div class="relative page-container py-14 md:py-20 text-center">
            <h1
              class="font-headline font-black uppercase leading-[0.9] tracking-tight text-ink"
              style="font-size: clamp(3.5rem, 9vw, 7rem)"
            >
              Crown Your <span class="text-lime">GOAT</span>
            </h1>
            <p class="mt-6 font-sans text-body font-medium text-lg md:text-xl leading-relaxed max-w-2xl mx-auto">
              Two legends enter — you pick the greater. Your winner stays on and faces
              the next challenger. Keep voting until one is left standing. No pre-picks,
              no bias: your GOAT is whoever survives your own calls.
            </p>
          </div>
        </section>

        {/* Setup controls — centred column */}
        <div class="page-container max-w-2xl pt-8 pb-12 md:pt-10 md:pb-16 text-center">
          {/* Mode — Ranked counts toward the rankings, Friendly is just for fun. */}
          <div>
            <p class="font-mono text-sm uppercase tracking-widest text-mute mb-4">
              Mode
            </p>
            <div class="flex flex-wrap gap-3 justify-center">
              {([
                { id: "ranked", label: "Ranked", note: "Winner earns +5 votes" },
                { id: "friendly", label: "Friendly", note: "Nothing counts" },
              ] as const).map((m) => (
                <button
                  type="button"
                  onClick={() => setMode(m.id)}
                  class={`flex flex-col items-center text-center px-6 py-4 rounded-md border transition-colors ${
                    mode === m.id
                      ? "bg-lime text-canvas border-lime"
                      : "bg-canvas-soft text-ink border-hairline hover:border-hairline-strong"
                  }`}
                >
                  <span class="font-headline font-black uppercase text-xl tracking-wide leading-none">
                    {m.label}
                  </span>
                  <span
                    class={`font-mono text-[13px] uppercase tracking-widest mt-1.5 ${mode === m.id ? "text-canvas/80" : "text-mute"}`}
                  >
                    {m.note}
                  </span>
                </button>
              ))}
            </div>
            <p class="mt-4 font-sans text-base text-body max-w-md mx-auto">
              {mode === "ranked"
                ? "Crown a GOAT to give them +5 votes — you can't re-crown the same GOAT for 24h."
                : "Replay freely with any GOAT — friendly runs never touch the rankings."}
            </p>
          </div>

          <div class="mt-12">
            <p class="font-mono text-sm uppercase tracking-widest text-mute mb-4">
              How many contenders?
            </p>
            <div class="flex flex-wrap gap-3 justify-center">
              {presets.map((n) => (
                <button
                  type="button"
                  onClick={() => setCount(n)}
                  class={`font-headline font-black uppercase text-lg tracking-wide px-6 h-11 inline-flex items-center rounded-md border transition-colors ${
                    count === n
                      ? "bg-lime text-canvas border-lime"
                      : "bg-canvas-soft text-ink border-hairline hover:border-hairline-strong"
                  }`}
                >
                  {n}
                  {n === roster.length && (
                    <span
                      class={`ml-2 font-mono text-[13px] tracking-widest ${count === n ? "text-canvas/80" : "text-mute"}`}
                    >
                      ALL
                    </span>
                  )}
                </button>
              ))}
            </div>
            <p class="mt-4 font-sans text-base text-body">
              {count} legends · {count - 1} bouts
            </p>
          </div>

          <button
            type="button"
            onClick={() => start(count)}
            disabled={mode === "ranked" && sessionLoading}
            class="btn btn-primary text-lg px-12 py-4 mt-12 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mode === "ranked" && sessionLoading ? "Loading…" : "Enter the Arena →"}
          </button>
          {error && (
            <p class="mt-4 font-sans text-base text-red max-w-md mx-auto">
              {error}
            </p>
          )}
        </div>
      </>
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
      <div class="page-container max-w-3xl py-14 md:py-20 text-center anim-arena">
        <p class="font-mono text-[13px] uppercase tracking-widest text-lime mb-4">
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

        {/* Crown outcome — ranked runs award +5 votes; friendly runs count nothing. */}
        {mode === "ranked" ? (
          crownResult && crownResult.awarded > 0 ? (
            <p class="mt-4 font-headline font-black uppercase tracking-wider text-lg text-lime">
              +{crownResult.awarded} votes → {champion.shortName} now has {crownResult.total.toLocaleString()}
            </p>
          ) : crownResult ? (
            <p class="mt-4 font-mono text-[13px] uppercase tracking-widest text-mute max-w-md mx-auto">
              Already crowned {champion.shortName} in the last 24h — no extra votes this run.
            </p>
          ) : (
            <p class="mt-4 font-mono text-[13px] uppercase tracking-widest text-mute animate-pulse">
              Awarding votes…
            </p>
          )
        ) : (
          <p class="mt-4 font-mono text-[13px] uppercase tracking-widest text-mute">
            Friendly run · nothing counted toward the rankings
          </p>
        )}

        {/* One consistent report column: stats → takeaway → path → actions,
            each block separated by the same mt-12 and sharing max-w-md. */}
        <div class="max-w-md mx-auto">
          <div class="mt-12 grid grid-cols-3 gap-3">
            {[
              { n: backedGoat, l: "Times backed", c: "text-lime" },
              { n: agreed, l: "Crowd agreed", c: "text-ink" },
              { n: `${inSync}%`, l: "In sync", c: "text-ink" },
            ].map(({ n, l, c }) => (
              <div class="bg-canvas-soft border border-hairline rounded-md py-5">
                <p class={`font-headline font-black text-3xl leading-none ${c}`}>{n}</p>
                <p class="font-mono text-[10px] uppercase tracking-[0.14em] text-mute mt-2">
                  {l}
                </p>
              </div>
            ))}
          </div>

          <p class="mt-6 font-sans text-body text-sm leading-relaxed">
            {alignedLine}
          </p>

          {/* Path recap — each bout shows your pick and how the crowd landed,
              worded so the verdict is legible without a legend. */}
          <div class="mt-12 text-left">
            <div class="flex items-baseline justify-between mb-3">
              <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">Your path</p>
              <p class="font-mono text-[11px] uppercase tracking-[0.14em] text-mute">Pick · crowd</p>
            </div>
            <div class="flex flex-col gap-2">
              {rounds.map((r) => {
                const verdict =
                  r.crowd === "agree"
                    ? { label: "Crowd agreed", color: "var(--color-lime)" }
                    : r.crowd === "disagree"
                      ? { label: "Crowd differed", color: "var(--color-red)" }
                      : { label: "Too close", color: "var(--color-mute)" };
                return (
                  <div class="flex items-center gap-3 bg-canvas-soft border border-hairline rounded-md px-4 py-3">
                    <span class="font-headline font-black uppercase text-sm text-ink flex-1 min-w-0 truncate">
                      {r.champion.shortName} <span class="text-mute">vs</span> {r.challenger.shortName}
                    </span>
                    <span class="font-mono text-[11px] uppercase tracking-wider text-lime shrink-0 text-right whitespace-nowrap">
                      ▸ {r.picked.shortName}
                    </span>
                    <span
                      class="font-mono text-[10px] uppercase tracking-[0.12em] shrink-0 w-[104px] flex items-center justify-end gap-1.5 whitespace-nowrap"
                      style={`color:${verdict.color}`}
                    >
                      <span class="w-1.5 h-1.5 rounded-full inline-block shrink-0" style={`background:${verdict.color}`}></span>
                      {verdict.label}
                    </span>
                  </div>
                );
              })}
            </div>
          </div>

          <div class="mt-12 flex flex-wrap gap-3 justify-center">
            <a href={`/goats/${champion.slug}`} class="btn btn-primary text-base px-8 py-3">
              {champion.shortName}'s Profile
            </a>
            <a href={`/rankings/${arena}`} class="btn btn-secondary text-sm px-6 py-3">
              See the Rankings
            </a>
            <button
              type="button"
              onClick={reset}
              class="font-sans font-medium text-sm text-body px-6 py-3 inline-flex items-center rounded-sm hover:text-ink transition-colors"
            >
              Play again
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!champion || !opponent) return null;

  // ── ARENA / REVEAL ───────────────────────────────────
  const boutNo = idx + 1;
  const totalBouts = queue.length;
  const champPct = current ? current.championPct : 50;

  // Physical layout: the reigning champion holds `championSide`; the challenger
  // (always the new entrant) takes the other slot. Keying each panel by fighter
  // id means only the changed slot remounts — so only the incoming GOAT animates.
  const championOnLeft = championSide === "left";
  const leftFighter = championOnLeft ? champion : opponent;
  const rightFighter = championOnLeft ? opponent : champion;
  const leftPct = championOnLeft ? champPct : 100 - champPct;
  const rightPct = 100 - leftPct;
  const leftPicked = current ? current.picked.id === leftFighter.id : false;
  const rightPicked = current ? current.picked.id === rightFighter.id : false;

  return (
    <div>
      {/* Status bar */}
      <div class="border-b border-hairline">
        <div class="page-container h-[60px] flex items-center justify-between gap-4">
          <div class="flex items-center gap-4">
            <span class="font-mono text-[11px] uppercase tracking-[0.14em] text-lime whitespace-nowrap">🔥 In sync · {agreed}</span>
            <span class="font-mono text-[11px] uppercase tracking-[0.14em] text-mute whitespace-nowrap">Bout {boutNo} / {totalBouts}</span>
          </div>
          <button type="button" onClick={reset} class="chip">✕ Exit</button>
        </div>
      </div>

      {/* Progress */}
      <div class="h-1 bg-hairline">
        <div class="h-full bg-lime transition-all duration-500" style={`width:${Math.round((rounds.length / totalBouts) * 100)}%`}></div>
      </div>

      <div class="page-container max-w-3xl pt-9 pb-12">
        <div class="text-center">
          <div class="font-mono text-[11px] uppercase tracking-[0.2em] text-lime">
            Champion Mode · {arenaEmoji(arena)} {arenaLabel(arena)}
          </div>
          <h1 class="font-headline font-black uppercase text-4xl md:text-[46px] leading-[0.95] tracking-tight text-ink mt-3">
            {phase === "arena" ? "Who takes it?" : !current ? "Reading the room…" : current.dethroned ? "New champion" : "Throne held"}
          </h1>
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
              <span class="font-mono text-[13px] uppercase tracking-widest text-mute">
                Tale of the Tape
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
            <span class="font-mono text-[13px] uppercase tracking-widest text-mute">
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
                    <p class="font-mono text-[13px] uppercase tracking-wider text-mute truncate text-center mb-1">
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
        <div class="mt-7">
          {/* Left = lime, right = red; Keep the reigning GOAT or Crown the challenger. */}
          <div class="grid grid-cols-1 md:grid-cols-[1fr_90px_1fr] items-stretch gap-3 md:gap-0">
            <PickCard key={leftFighter.id} fighter={leftFighter} tone="lime" isChampion={championOnLeft} onPick={() => cast(leftFighter)} disabled={pending} />
            <div class="flex items-center justify-center py-2 md:py-0">
              <div class="w-[60px] h-[60px] rounded-full bg-canvas-deep border border-hairline-strong flex items-center justify-center">
                <span class="font-headline font-black italic text-[22px] text-ink">VS</span>
              </div>
            </div>
            <PickCard key={rightFighter.id} fighter={rightFighter} tone="red" isChampion={!championOnLeft} onPick={() => cast(rightFighter)} disabled={pending} />
          </div>
          <p class="text-center font-mono text-[11px] uppercase tracking-[0.12em] text-mute mt-4">
            {mode === "ranked"
              ? "+5 votes to your crowned GOAT · finish to crown your champion"
              : "Friendly run · nothing recorded"}
          </p>
          {error && (
            <p class="text-center font-mono text-[13px] uppercase tracking-widest text-red mt-3">
              {error}
            </p>
          )}
        </div>
      ) : !current ? (
        /* Counting state — shown instantly on click while the vote is in flight */
        <div class="mt-6">
          <div class="flex items-center justify-between font-headline font-black uppercase mb-2 opacity-40">
            <span class="text-2xl text-ink">{leftFighter.shortName}</span>
            <span class="text-2xl text-ink">{rightFighter.shortName}</span>
          </div>
          <div class="flex h-3 gap-0.5 rounded-full overflow-hidden bg-hairline">
            <div class="w-1/2 bg-hairline-strong animate-pulse"></div>
          </div>
          <p class="text-center font-mono text-[13px] uppercase tracking-widest text-mute mt-3 animate-pulse">
            Reading the room…
          </p>
        </div>
      ) : (
        <div class="mt-6 anim-verdict">
          {/* Crowd split — kept in physical left/right order; the side you backed is lime */}
          <div class="flex items-center justify-between font-headline font-black uppercase mb-2">
            <span class={`text-2xl ${leftPicked ? "text-lime" : "text-ink"}`}>
              {leftFighter.shortName} {leftPct}%
            </span>
            <span class={`text-2xl ${rightPicked ? "text-lime" : "text-ink"}`}>
              {rightPct}% {rightFighter.shortName}
            </span>
          </div>
          <div class="flex h-3 gap-0.5 rounded-full overflow-hidden">
            <div
              style={`width:${leftPct}%`}
              class={`anim-bar ${leftPicked ? "bg-lime" : "bg-hairline-strong"}`}
            ></div>
            <div
              style={`width:${rightPct}%`}
              class={`anim-bar ${rightPicked ? "bg-lime" : "bg-hairline-strong"}`}
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
          <p class="text-center font-mono text-[13px] uppercase tracking-widest mt-1">
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
              type="button"
              onClick={() => next()}
              class="btn btn-primary text-base px-10 py-3"
            >
              {boutNo >= totalBouts ? "Crown Your GOAT →" : "Next Challenger →"}
            </button>
            <span class="font-mono text-[13px] uppercase tracking-widest text-mute">
              Auto-advancing…
            </span>
          </div>
        </div>
      )}
      </div>
    </div>
  );
}
