import { FormEvent, TouchEvent, useEffect, useRef, useState, type CSSProperties, type ReactNode } from "react";
import {
  api,
  type Achievement,
  type AchievementsResponse,
  bootstrapSession,
  todayIso,
  type Dashboard,
  type GoalType,
  type Goals,
  type Meal,
  type MealType,
  type Profile,
  type ScanStatus
} from "./api";
import { SUPPORTED_LOCALES, useI18n, type SupportedLocale } from "./i18n";

type Tab = "dashboard" | "daily-log" | "quick-add" | "onboarding" | "add-meal";

type OnboardingForm = {
  timezone: string;
  language: SupportedLocale;
  heightCm: string;
  weightKg: string;
  goalType: GoalType;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
};

type MealForm = {
  title: string;
  mealType: MealType;
  eatenAt: string;
  itemName: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
};

type ScanConfirmForm = {
  title: string;
  mealType: MealType;
  eatenAt: string;
  itemName: string;
  calories: string;
  proteinG: string;
  carbsG: string;
  fatG: string;
};

type AchievementTrack = {
  id: string;
  title: string;
  description: string;
  hidden: boolean;
  totalLevels: number;
  unlockedLevels: number;
  currentLevel: Achievement | null;
  nextLevel: Achievement | null;
  levels: Achievement[];
  progress: number;
  target: number;
  isCompleted: boolean;
  isSecret: boolean;
  latestUnlockedAt: string | null;
};

type CelebrationParticle = {
  id: number;
  color: string;
  size: number;
  x: number;
  peakY: number;
  endY: number;
  rotation: number;
  delay: number;
  duration: number;
  rounded: boolean;
};

type UnlockCelebration = {
  achievement: Achievement;
  particles: CelebrationParticle[];
};

type LevelUpCelebration = {
  level: number;
  particles: CelebrationParticle[];
};

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function currentDatetimeLocal(): string {
  const now = new Date();
  now.setMinutes(now.getMinutes() - now.getTimezoneOffset());
  return now.toISOString().slice(0, 16);
}

function detectMealTypeFromLocalDatetime(localDatetime: string): MealType {
  const hour = Number(localDatetime.slice(11, 13));
  if (hour >= 5 && hour < 11) return "breakfast";
  if (hour >= 11 && hour < 16) return "lunch";
  if (hour >= 16 && hour < 22) return "dinner";
  return "snack";
}

function humanizeScanError(errorCode: string | null): string {
  return errorCode ?? "provider_unknown_error";
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tierLabel(tier: Achievement["tier"]): string {
  if (tier === "bronze") return "Bronze";
  if (tier === "silver") return "Silver";
  if (tier === "gold") return "Gold";
  return "";
}

function translateAchievementField(
  achievement: Achievement,
  field: "title" | "description",
  t: (key: string, params?: Record<string, string | number>) => string,
  hasTranslation: (key: string) => boolean
): string {
  const key = `achievements.${achievement.key}.${field}`;
  return hasTranslation(key) ? t(key) : achievement[field];
}

function buildAchievementTracks(items: Achievement[]): AchievementTrack[] {
  const groups = new Map<string, Achievement[]>();
  for (const item of items) {
    const groupKey = item.group ?? item.key;
    const current = groups.get(groupKey) ?? [];
    current.push(item);
    groups.set(groupKey, current);
  }
  const tierOrder: Record<string, number> = { bronze: 1, silver: 2, gold: 3 };
  return Array.from(groups.entries()).map(([groupKey, groupItems]) => {
    const levels = [...groupItems].sort((a, b) => (tierOrder[a.tier ?? ""] ?? 0) - (tierOrder[b.tier ?? ""] ?? 0));
    const unlockedLevels = levels.filter((item) => item.unlocked).length;
    const currentLevel = [...levels].reverse().find((item) => item.unlocked) ?? null;
    const nextLevel = levels.find((item) => !item.unlocked) ?? null;
    const representative = currentLevel ?? levels[0];
    const latestUnlockedAt =
      [...levels]
        .filter((item) => item.unlockedAt)
        .sort((a, b) => new Date(b.unlockedAt ?? 0).getTime() - new Date(a.unlockedAt ?? 0).getTime())[0]
        ?.unlockedAt ?? null;
    const progress = nextLevel ? nextLevel.progress : currentLevel?.target ?? representative.target;
    const target = nextLevel?.target ?? currentLevel?.target ?? representative.target;
    return {
      id: groupKey,
      title: representative.title,
      description: representative.description,
      hidden: representative.hidden && !currentLevel,
      totalLevels: levels.length,
      unlockedLevels,
      currentLevel,
      nextLevel,
      levels,
      progress,
      target,
      isCompleted: nextLevel === null,
      isSecret: representative.hidden && !currentLevel,
      latestUnlockedAt,
    };
  });
}

function achievementProgressPercent(track: AchievementTrack): number {
  if (track.target <= 0) return 0;
  return Math.min(100, Math.round((track.progress / track.target) * 100));
}

function createCelebrationParticles(): CelebrationParticle[] {
  const colors = ["#2563eb", "#38bdf8", "#10b981", "#f59e0b", "#fb7185", "#8b5cf6"];
  const count = 32;
  return Array.from({ length: count }, (_, index) => {
    const spread = (Math.random() - 0.5) * 260;
    const peakY = -260 - Math.random() * 140;
    const endY = peakY + 110 + Math.random() * 80;
    return {
      id: index,
      color: colors[index % colors.length],
      size: 6 + Math.round(Math.random() * 6),
      x: spread,
      peakY,
      endY,
      rotation: -160 + Math.random() * 320,
      delay: Math.round(Math.random() * 90),
      duration: 1500 + Math.round(Math.random() * 320),
      rounded: Math.random() > 0.45
    };
  });
}

function AchievementUnlockCelebration(props: { celebration: UnlockCelebration | null }) {
  const { t, hasTranslation } = useI18n();
  if (!props.celebration) return null;
  return (
    <div className="achievement-unlock-overlay">
      <div className="achievement-unlock-particles" aria-hidden="true">
        {props.celebration.particles.map((particle) => (
          <span
            className={`achievement-particle ${particle.rounded ? "achievement-particle-round" : ""}`}
            key={particle.id}
            style={
              {
                "--particle-color": particle.color,
                "--particle-size": `${particle.size}px`,
                "--particle-x": `${particle.x}px`,
                "--particle-peak-y": `${particle.peakY}px`,
                "--particle-end-y": `${particle.endY}px`,
                "--particle-rotation": `${particle.rotation}deg`,
                "--particle-delay": `${particle.delay}ms`,
                "--particle-duration": `${particle.duration}ms`
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="achievement-unlock-toast">
        <div className="achievement-unlock-icon" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M12 2.75a.75.75 0 0 1 .69.45l2.04 4.78 5.17.42a.75.75 0 0 1 .43 1.31l-3.93 3.38 1.18 5.02a.75.75 0 0 1-1.12.8L12 16.53l-4.46 2.63a.75.75 0 0 1-1.12-.8l1.18-5.02-3.93-3.38a.75.75 0 0 1 .43-1.31l5.17-.42 2.04-4.78a.75.75 0 0 1 .69-.45Z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-ink">{t("celebration.unlocked")}</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">
          {translateAchievementField(props.celebration.achievement, "title", t, hasTranslation)}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {translateAchievementField(props.celebration.achievement, "description", t, hasTranslation)}
        </p>
      </div>
    </div>
  );
}

function LevelUpOverlay(props: { celebration: LevelUpCelebration | null }) {
  const { t } = useI18n();
  if (!props.celebration) return null;
  return (
    <div className="achievement-unlock-overlay">
      <div className="achievement-unlock-particles" aria-hidden="true">
        {props.celebration.particles.map((particle) => (
          <span
            className={`achievement-particle ${particle.rounded ? "achievement-particle-round" : ""}`}
            key={particle.id}
            style={
              {
                "--particle-color": particle.color,
                "--particle-size": `${particle.size}px`,
                "--particle-x": `${particle.x}px`,
                "--particle-peak-y": `${particle.peakY}px`,
                "--particle-end-y": `${particle.endY}px`,
                "--particle-rotation": `${particle.rotation}deg`,
                "--particle-delay": `${particle.delay}ms`,
                "--particle-duration": `${particle.duration}ms`
              } as CSSProperties
            }
          />
        ))}
      </div>
      <div className="achievement-unlock-toast achievement-unlock-toast-level">
        <div className="achievement-unlock-icon achievement-unlock-icon-level" aria-hidden="true">
          <svg viewBox="0 0 24 24" className="h-5 w-5 fill-current">
            <path d="M12 3.25 14.4 8l5.24.76-3.82 3.72.9 5.25L12 15.33 7.28 18l.9-5.25L4.36 8.76 9.6 8 12 3.25Zm0 14.08 1.9 1.08.98-5.72 4.16-4.06-5.75-.84L12 2.62 9.71 7.8l-5.75.84 4.16 4.06-.98 5.72L12 17.33Z" />
          </svg>
        </div>
        <p className="text-sm font-semibold text-ink">{t("celebration.level_up")}</p>
        <p className="mt-1 text-sm font-semibold text-slate-800">{t("progression.level_label", { level: props.celebration.level })}</p>
        <p className="mt-1 text-xs text-slate-600">{t("progression.level_up_description")}</p>
      </div>
    </div>
  );
}

function renderSectionToggle(props: {
  title: string;
  count: number;
  expanded: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <div className="achievement-section">
      <button
        type="button"
        className="achievement-section-toggle"
        aria-expanded={props.expanded}
        onClick={props.onClick}
      >
        <span className="text-sm font-semibold text-ink">
          {props.title} ({props.count})
        </span>
        <span className={`achievement-section-arrow ${props.expanded ? "achievement-section-arrow-open" : ""}`}>
          <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
            <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.18l3.71-3.95a.75.75 0 1 1 1.1 1.02l-4.25 4.53a.75.75 0 0 1-1.1 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" />
          </svg>
        </span>
      </button>
      <div className={`achievement-section-panel ${props.expanded ? "achievement-section-panel-open" : ""}`}>
        <div className="pt-3">{props.children}</div>
      </div>
    </div>
  );
}

function MacroBar(props: { label: string; value: number; goal: number; color: string }) {
  const percent = props.goal > 0 ? Math.min(100, Math.round((props.value / props.goal) * 100)) : 0;
  return (
    <div className="rounded-2xl bg-white p-4 shadow-sm">
      <p className="text-xs uppercase tracking-wide text-slate-500">{props.label}</p>
      <div className="mt-1 flex items-baseline justify-between">
        <p className="text-lg font-semibold text-ink">{props.value}g</p>
        <p className="text-sm font-medium text-slate-400">{props.goal}g</p>
      </div>
      <div className="mt-2 h-2 rounded bg-slate-100">
        <div className={`h-2 rounded ${props.color}`} style={{ width: `${percent}%` }} />
      </div>
    </div>
  );
}

function DashboardView(props: { dashboard: Dashboard; achievements: AchievementsResponse | null; profile: Profile }) {
  const { t, hasTranslation } = useI18n();
  const { dashboard, achievements, profile } = props;
  const [boardExpanded, setBoardExpanded] = useState(false);
  const [showAllInProgress, setShowAllInProgress] = useState(false);
  const [completedExpanded, setCompletedExpanded] = useState(false);
  const [secretExpanded, setSecretExpanded] = useState(false);
  const [levelSheetOpen, setLevelSheetOpen] = useState(false);
  const [levelSheetOffsetY, setLevelSheetOffsetY] = useState(0);
  const levelSheetTouchStartYRef = useRef<number | null>(null);
  const kcalPercent =
    dashboard.goals.calories > 0
      ? Math.min(100, Math.round((dashboard.totals.calories / dashboard.goals.calories) * 100))
      : 0;
  const unlockedCount = achievements ? achievements.items.filter((item) => item.unlocked).length : 0;
  const tracks = achievements ? buildAchievementTracks(achievements.items) : [];
  const latestUnlocked =
    achievements?.items
      .filter((item) => item.unlocked && item.unlockedAt)
      .sort((a, b) => new Date(b.unlockedAt ?? 0).getTime() - new Date(a.unlockedAt ?? 0).getTime())[0] ?? null;
  const inProgressTracks = [...tracks]
    .filter((track) => !track.isSecret && !track.isCompleted)
    .sort((a, b) => {
      const startedDiff = Number(b.progress > 0) - Number(a.progress > 0);
      if (startedDiff !== 0) return startedDiff;
      const ratioDiff = achievementProgressPercent(b) - achievementProgressPercent(a);
      if (ratioDiff !== 0) return ratioDiff;
      return b.unlockedLevels - a.unlockedLevels;
    });
  const completedTracks = [...tracks]
    .filter((track) => track.isCompleted && !track.isSecret)
    .sort((a, b) => new Date(b.latestUnlockedAt ?? 0).getTime() - new Date(a.latestUnlockedAt ?? 0).getTime());
  const secretTracks = [...tracks].filter((track) => track.isSecret);
  const visibleInProgressTracks = showAllInProgress ? inProgressTracks : inProgressTracks.slice(0, 3);
  const summaryPercent = achievements ? Math.round((unlockedCount / Math.max(achievements.items.length, 1)) * 100) : 0;
  const levelProgressPercent = Math.min(100, Math.round((profile.currentXp / Math.max(profile.xpRequired, 1)) * 100));
  const nextLevel = profile.level + 1;

  useEffect(() => {
    if (!levelSheetOpen) return;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [levelSheetOpen]);

  function closeLevelSheet() {
    setLevelSheetOffsetY(0);
    setLevelSheetOpen(false);
  }

  function onLevelSheetTouchStart(e: TouchEvent<HTMLDivElement>) {
    levelSheetTouchStartYRef.current = e.touches[0]?.clientY ?? null;
  }

  function onLevelSheetTouchMove(e: TouchEvent<HTMLDivElement>) {
    if (levelSheetTouchStartYRef.current === null) return;
    const currentY = e.touches[0]?.clientY ?? levelSheetTouchStartYRef.current;
    const deltaY = currentY - levelSheetTouchStartYRef.current;
    setLevelSheetOffsetY(deltaY > 0 ? deltaY : 0);
  }

  function onLevelSheetTouchEnd() {
    if (levelSheetOffsetY > 90) {
      closeLevelSheet();
      return;
    }
    setLevelSheetOffsetY(0);
    levelSheetTouchStartYRef.current = null;
  }

  return (
    <section className="space-y-4">
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">{t("summary.title")}</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">{dashboard.totals.calories} kcal</h1>
        <p className="text-sm text-slate-500">{t("summary.goal", { calories: dashboard.goals.calories })}</p>
        <div className="mt-4 h-3 rounded-full bg-slate-100">
          <div className="h-3 rounded-full bg-primary" style={{ width: `${kcalPercent}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MacroBar
          label={t("macros.protein")}
          value={dashboard.totals.proteinG}
          goal={dashboard.goals.proteinG}
          color="bg-emerald-500"
        />
        <MacroBar
          label={t("macros.carbs")}
          value={dashboard.totals.carbsG}
          goal={dashboard.goals.carbsG}
          color="bg-amber-500"
        />
        <MacroBar
          label={t("macros.fat")}
          value={dashboard.totals.fatG}
          goal={dashboard.goals.fatG}
          color="bg-blue-500"
        />
      </div>
      <button
        type="button"
        className="level-card w-full rounded-3xl bg-white p-5 text-left shadow-sm"
        onClick={() => setLevelSheetOpen(true)}
      >
        <div className="flex items-center justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-ink">{t("progression.level_label", { level: profile.level })}</p>
            <p className="mt-1 text-xs text-slate-500">
              {t("progression.xp_progress", { current: profile.currentXp, required: profile.xpRequired })}
            </p>
          </div>
          <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-semibold text-amber-700">
            {t("progression.xp_short", { current: profile.currentXp, required: profile.xpRequired })}
          </span>
        </div>
        <div className="mt-4 h-3 rounded-full bg-slate-100">
          <div
            className="h-3 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-500"
            style={{ width: `${levelProgressPercent}%` }}
          />
        </div>
      </button>
      {achievements && (
        <div className="achievement-board rounded-3xl p-5 shadow-sm">
          <button
            type="button"
            className="achievement-board-toggle w-full text-left"
            aria-expanded={boardExpanded}
            onClick={() => setBoardExpanded((current) => !current)}
          >
            <div className="achievement-board-preview min-h-[132px]">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold text-ink">{t("achievement_board.title")}</h2>
                  <p className="mt-1 text-sm text-slate-600">
                    {t("achievement_board.streak", {
                      current: achievements.streak.currentDays,
                      best: achievements.streak.longestDays
                    })}
                  </p>
                </div>
                <span
                  className={`achievement-board-arrow flex h-9 w-9 items-center justify-center rounded-full bg-white/80 text-slate-600 ${
                    boardExpanded ? "achievement-board-arrow-open" : ""
                  }`}
                >
                  <svg aria-hidden="true" viewBox="0 0 20 20" className="h-4 w-4 fill-current">
                    <path d="M5.23 7.21a.75.75 0 0 1 1.06.02L10 11.18l3.71-3.95a.75.75 0 1 1 1.1 1.02l-4.25 4.53a.75.75 0 0 1-1.1 0L5.21 8.27a.75.75 0 0 1 .02-1.06Z" />
                  </svg>
                </span>
              </div>
              <div className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-3">
                <p className="text-xs font-semibold uppercase tracking-wide text-emerald-700">
                  {t("achievement_board.latest_unlock")}
                </p>
                {latestUnlocked ? (
                  <>
                    <p className="mt-1 text-sm font-semibold text-ink">
                      {translateAchievementField(latestUnlocked, "title", t, hasTranslation)}
                    </p>
                    <p className="text-xs text-slate-600">
                      {translateAchievementField(latestUnlocked, "description", t, hasTranslation)}
                    </p>
                  </>
                ) : (
                  <>
                    <p className="mt-1 text-sm font-semibold text-ink">{t("achievement_board.latest_unlock_empty_title")}</p>
                    <p className="text-xs text-slate-600">{t("achievement_board.latest_unlock_empty_description")}</p>
                  </>
                )}
              </div>
            </div>
          </button>
          <div className={`achievement-board-details ${boardExpanded ? "achievement-board-details-open" : ""}`}>
            <div className="achievement-board-body pt-4">
              <div className="achievement-board-header">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <p className="mt-1 text-sm font-medium text-slate-700">
                      {t("achievement_board.progress", {
                        count: unlockedCount,
                        total: achievements.items.length
                      })}
                    </p>
                  </div>
                  <span className="rounded-full bg-white/85 px-3 py-1 text-xs font-semibold text-slate-700 shadow-sm">
                    {summaryPercent}%
                  </span>
                </div>
                <div className="mt-3 h-2.5 rounded-full bg-white/75">
                  <div className="h-2.5 rounded-full bg-primary" style={{ width: `${summaryPercent}%` }} />
                </div>
              </div>
              <div className="mt-5">
                <div className="achievement-section">
                  <div className="mb-3 flex items-center justify-between gap-3">
                    <div>
                      <p className="text-sm font-semibold text-ink">{t("achievement_board.in_progress")}</p>
                      <p className="text-xs text-slate-500">{t("achievement_board.in_progress_hint")}</p>
                    </div>
                    <span className="rounded-full bg-sky-100 px-3 py-1 text-xs font-semibold text-sky-700">
                      {inProgressTracks.length}
                    </span>
                  </div>
                  {visibleInProgressTracks.length > 0 ? (
                    <div className="space-y-3">
                      {visibleInProgressTracks.map((track, index) => (
                        <div
                          className={`achievement-card achievement-card-progress ${index === 0 ? "achievement-card-progress-featured" : ""}`}
                          key={track.id}
                        >
                          <div className="flex items-start justify-between gap-3">
                            <div>
                              <p className="text-sm font-semibold text-ink">
                                {translateAchievementField(track.nextLevel ?? track.currentLevel ?? track.levels[0], "title", t, hasTranslation)}
                              </p>
                              <p className="mt-1 text-xs text-slate-600">
                                {translateAchievementField(
                                  track.nextLevel ?? track.currentLevel ?? track.levels[0],
                                  "description",
                                  t,
                                  hasTranslation
                                )}
                              </p>
                            </div>
                            {track.totalLevels > 1 && (
                              <span className="rounded-full bg-white/80 px-2.5 py-1 text-[10px] font-semibold text-slate-600">
                                {track.currentLevel?.tier ? tierLabel(track.currentLevel.tier) : t("achievement_board.track")}
                              </span>
                            )}
                          </div>
                          <div className="mt-4 h-2.5 rounded-full bg-white/80">
                            <div
                              className="h-2.5 rounded-full bg-primary"
                              style={{ width: `${achievementProgressPercent(track)}%` }}
                            />
                          </div>
                          <div className="mt-3 flex items-center justify-between text-[11px] text-slate-600">
                            <span>
                              {track.progress}/{track.target}
                            </span>
                            <span>
                              {track.totalLevels > 1
                                ? t("achievement_board.tiers", { count: track.unlockedLevels, total: track.totalLevels })
                                : t("achievement_board.active")}
                            </span>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="achievement-card achievement-card-empty">
                      <p className="text-sm font-semibold text-ink">{t("achievement_board.no_active_title")}</p>
                      <p className="mt-1 text-xs text-slate-600">{t("achievement_board.no_active_description")}</p>
                    </div>
                  )}
                  {inProgressTracks.length > 3 && (
                    <button
                      type="button"
                      className="achievement-show-more mt-3"
                      onClick={() => setShowAllInProgress((current) => !current)}
                    >
                      {showAllInProgress
                        ? t("common.show_less")
                        : t("common.show_more", { count: inProgressTracks.length - 3 })}
                    </button>
                  )}
                </div>
                {completedTracks.length > 0 &&
                  renderSectionToggle({
                    title: t("achievement_board.completed"),
                    count: completedTracks.length,
                    expanded: completedExpanded,
                    onClick: () => setCompletedExpanded((current) => !current),
                    children: (
                      <div className="space-y-3">
                        {completedTracks.map((track) => (
                          <div className="achievement-card achievement-card-completed" key={track.id}>
                            <div className="flex items-start justify-between gap-3">
                            <div>
                                <p className="text-sm font-semibold text-slate-700">
                                  {translateAchievementField(track.currentLevel ?? track.levels[0], "title", t, hasTranslation)}
                                </p>
                                <p className="mt-1 text-xs text-slate-500">
                                  {translateAchievementField(track.currentLevel ?? track.levels[0], "description", t, hasTranslation)}
                                </p>
                              </div>
                              {track.totalLevels > 1 && (
                                <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-semibold text-slate-500">
                                  {track.currentLevel?.tier ? tierLabel(track.currentLevel.tier) : t("achievement_board.done")}
                                </span>
                              )}
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
                {secretTracks.length > 0 &&
                  renderSectionToggle({
                    title: t("achievement_board.secret"),
                    count: secretTracks.length,
                    expanded: secretExpanded,
                    onClick: () => setSecretExpanded((current) => !current),
                    children: (
                      <div className="space-y-3">
                        {secretTracks.map((track) => (
                          <div className="achievement-card achievement-card-secret" key={track.id}>
                            <div className="achievement-secret-icon">?</div>
                            <div>
                              <p className="text-sm font-semibold text-slate-700">
                                {t("achievement_board.secret_placeholder_title")}
                              </p>
                              <p className="mt-1 text-xs text-slate-500">
                                {t("achievement_board.secret_placeholder_description")}
                              </p>
                            </div>
                          </div>
                        ))}
                      </div>
                    )
                  })}
              </div>
            </div>
          </div>
        </div>
      )}
      {levelSheetOpen && (
        <div
          className="xp-sheet-backdrop xp-sheet-backdrop-open"
          onClick={closeLevelSheet}
          role="presentation"
        >
          <div
            aria-modal="true"
            className="xp-sheet xp-sheet-open"
            onClick={(e) => e.stopPropagation()}
            onTouchEnd={onLevelSheetTouchEnd}
            onTouchMove={onLevelSheetTouchMove}
            onTouchStart={onLevelSheetTouchStart}
            role="dialog"
            style={{ transform: `translateY(${levelSheetOffsetY}px)` }}
          >
            <div className="xp-sheet-handle" />
            <div className="xp-sheet-content">
              <h3 className="text-lg font-semibold text-ink">{t("progression.modal_title")}</h3>

              <div className="xp-sheet-section">
                <p className="xp-sheet-section-title">{t("progression.current_progress")}</p>
                <p className="mt-2 text-base font-semibold text-ink">{t("progression.level_label", { level: profile.level })}</p>
                <p className="mt-1 text-sm text-slate-600">
                  {t("progression.xp_progress", { current: profile.currentXp, required: profile.xpRequired })}
                </p>
                <div className="mt-3 h-3 rounded-full bg-slate-100">
                  <div
                    className="h-3 rounded-full bg-gradient-to-r from-amber-400 via-orange-400 to-rose-500"
                    style={{ width: `${levelProgressPercent}%` }}
                  />
                </div>
              </div>

              <div className="xp-sheet-section">
                <p className="xp-sheet-section-title">{t("progression.how_to_earn")}</p>
                <div className="mt-3 space-y-3">
                  <div className="xp-sheet-row"><span className="xp-sheet-xp">+5 XP</span><span className="xp-sheet-copy">{t("progression.earn_meal")}</span></div>
                  <div className="xp-sheet-row"><span className="xp-sheet-xp">+10 XP</span><span className="xp-sheet-copy">{t("progression.earn_day")}</span></div>
                  <div className="xp-sheet-row"><span className="xp-sheet-xp">+10 XP</span><span className="xp-sheet-copy">{t("progression.earn_streak")}</span></div>
                  <div className="xp-sheet-row"><span className="xp-sheet-xp">+20 XP</span><span className="xp-sheet-copy">{t("progression.earn_goal")}</span></div>
                </div>
              </div>

              <div className="xp-sheet-section">
                <p className="xp-sheet-section-title">{t("progression.next_level")}</p>
                <p className="mt-2 text-base font-semibold text-ink">{t("progression.level_label", { level: nextLevel })}</p>
                <p className="mt-1 text-sm text-slate-600">{t("progression.xp_required_label", { required: 100 + nextLevel * 50 })}</p>
              </div>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

function SwipeMealRow(props: {
  meal: Meal;
  deleting: boolean;
  onDelete: (mealId: string) => Promise<void>;
}) {
  const { t, hasTranslation } = useI18n();
  const swipeStartXRef = useRef<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const actionWidth = 96;
  const revealThreshold = 64;
  const mealCalories = props.meal.items.reduce((acc, item) => acc + item.calories, 0);
  const mealProtein = props.meal.items.reduce((acc, item) => acc + item.proteinG, 0);
  const mealFat = props.meal.items.reduce((acc, item) => acc + item.fatG, 0);
  const mealCarbs = props.meal.items.reduce((acc, item) => acc + item.carbsG, 0);

  function onTouchStart(e: TouchEvent<HTMLElement>) {
    swipeStartXRef.current = e.touches[0]?.clientX ?? null;
    setDragging(true);
  }

  function onTouchMove(e: TouchEvent<HTMLElement>) {
    if (swipeStartXRef.current === null) return;
    const currentX = e.touches[0]?.clientX ?? swipeStartXRef.current;
    const deltaX = currentX - swipeStartXRef.current;
    let nextOffset = deltaX;
    if (revealed) nextOffset -= actionWidth;
    if (nextOffset > 0) nextOffset = 0;
    if (nextOffset < -actionWidth) nextOffset = -actionWidth;
    setDragOffsetX(nextOffset);
  }

  function onTouchEnd() {
    const shouldReveal = dragOffsetX <= -revealThreshold;
    setRevealed(shouldReveal);
    setDragOffsetX(shouldReveal ? -actionWidth : 0);
    swipeStartXRef.current = null;
    setDragging(false);
  }

  const translateX = dragging ? dragOffsetX : revealed ? -actionWidth : 0;

  return (
    <div className="relative overflow-hidden rounded-xl">
      <div className="absolute inset-y-0 right-0 flex w-24 items-stretch justify-end">
        <button
          className="h-full w-24 bg-red-500 px-3 text-xs font-semibold text-white disabled:opacity-60"
          disabled={props.deleting}
          onClick={() => {
            void props.onDelete(props.meal.id);
          }}
          type="button"
        >
          {props.deleting ? t("common.deleting") : t("common.delete")}
        </button>
      </div>
      <article
        className="rounded-xl border border-slate-100 bg-white p-3 select-none touch-pan-y"
        onTouchEnd={onTouchEnd}
        onTouchMove={onTouchMove}
        onTouchStart={onTouchStart}
        style={{
          transform: `translateX(${translateX}px)`,
          transition: dragging ? "none" : "transform 0.2s ease-out"
        }}
      >
        <div className="flex items-center justify-between">
          <h3 className="font-medium text-ink">{props.meal.title}</h3>
          <span className="text-sm font-semibold text-primary">{mealCalories} kcal</span>
        </div>
        <p className="mt-1 text-xs uppercase tracking-wide text-slate-500">
          {t(`meal_type.${props.meal.mealType}`)} - {formatTime(props.meal.eatenAt)}
        </p>
        <p className="mt-1 text-xs text-slate-600">
          {t("macros.bju", { protein: mealProtein.toFixed(1), fat: mealFat.toFixed(1), carbs: mealCarbs.toFixed(1) })}
        </p>
      </article>
    </div>
  );
}

function DailyLogView(props: {
  meals: Meal[];
  deletingMealId: string | null;
  onDeleteMeal: (mealId: string) => Promise<void>;
  pendingScan: ScanStatus | null;
  pendingConfirmForm: ScanConfirmForm;
  confirmingPendingScan: boolean;
  recalculatingPendingScan: boolean;
  onPendingConfirmChange: (patch: Partial<ScanConfirmForm>) => void;
  onPendingConfirm: () => Promise<void>;
  onPendingUseAsIs: () => Promise<void>;
  onPendingRecalculate: (comment: string) => Promise<void>;
}) {
  const { t, hasTranslation } = useI18n();
  const [draftExpanded, setDraftExpanded] = useState(false);
  const [recalculateComment, setRecalculateComment] = useState("");
  const draftResult =
    props.pendingScan?.status === "succeeded" && props.pendingScan.result ? props.pendingScan.result : null;

  async function submitPendingConfirm(e: FormEvent) {
    e.preventDefault();
    await props.onPendingConfirm();
  }

  return (
    <section className="rounded-3xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">{t("daily_log.title")}</h2>
      <div className="mt-4 space-y-3">
        {draftResult && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <button
              className="w-full text-left"
              onClick={() => setDraftExpanded((prev) => !prev)}
              type="button"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-ink">{t("daily_log.ai_draft", { name: draftResult.dishName })}</h3>
                <span className="text-sm font-semibold text-primary">{draftResult.calories} kcal</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                {t("daily_log.tap_to_toggle", { action: draftExpanded ? t("common.hide") : t("common.edit") })}
              </p>
            </button>
            {draftExpanded && (
              <form className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3" onSubmit={submitPendingConfirm}>
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  <p>
                    {t("daily_log.confidence")} <span className="font-semibold">{Math.round(draftResult.confidence * 100)}%</span>
                  </p>
                  {draftResult.alternatives.length > 0 && (
                    <p className="mt-1">
                      {t("daily_log.alternatives")} <span className="font-medium">{draftResult.alternatives.join(", ")}</span>
                    </p>
                  )}
                </div>
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    {t("daily_log.recalculate_label")}
                  </label>
                  <textarea
                    className="min-h-16 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder={t("daily_log.recalculate_placeholder")}
                    value={recalculateComment}
                    onChange={(e) => setRecalculateComment(e.target.value)}
                  />
                  <button
                    className="w-full rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700 disabled:opacity-60"
                    disabled={props.recalculatingPendingScan || !recalculateComment.trim()}
                    onClick={() => {
                      void props.onPendingRecalculate(recalculateComment.trim());
                      setRecalculateComment("");
                    }}
                    type="button"
                  >
                    {props.recalculatingPendingScan ? t("daily_log.recalculating") : t("daily_log.recalculate_button")}
                  </button>
                </div>
                <label className="block text-sm text-slate-600">
                  {t("common.title")}
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                    value={props.pendingConfirmForm.title}
                    onChange={(e) => props.onPendingConfirmChange({ title: e.target.value })}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-600">
                    {t("daily_log.meal_type")}
                    <select
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      value={props.pendingConfirmForm.mealType}
                      onChange={(e) => props.onPendingConfirmChange({ mealType: e.target.value as MealType })}
                    >
                      <option value="breakfast">{t("meal_type.breakfast")}</option>
                      <option value="lunch">{t("meal_type.lunch")}</option>
                      <option value="dinner">{t("meal_type.dinner")}</option>
                      <option value="snack">{t("meal_type.snack")}</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-600">
                    {t("common.time")}
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="datetime-local"
                      value={props.pendingConfirmForm.eatenAt}
                      onChange={(e) => props.onPendingConfirmChange({ eatenAt: e.target.value })}
                    />
                  </label>
                  <label className="col-span-2 text-sm text-slate-600">
                    {t("daily_log.item_name")}
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      value={props.pendingConfirmForm.itemName}
                      onChange={(e) => props.onPendingConfirmChange({ itemName: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    {t("daily_log.calories")}
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="number"
                      value={props.pendingConfirmForm.calories}
                      onChange={(e) => props.onPendingConfirmChange({ calories: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    {t("daily_log.protein")}
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="number"
                      step="0.1"
                      value={props.pendingConfirmForm.proteinG}
                      onChange={(e) => props.onPendingConfirmChange({ proteinG: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    {t("daily_log.carbs")}
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="number"
                      step="0.1"
                      value={props.pendingConfirmForm.carbsG}
                      onChange={(e) => props.onPendingConfirmChange({ carbsG: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    {t("daily_log.fat")}
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="number"
                      step="0.1"
                      value={props.pendingConfirmForm.fatG}
                      onChange={(e) => props.onPendingConfirmChange({ fatG: e.target.value })}
                    />
                  </label>
                </div>
                <button
                  className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                  disabled={props.confirmingPendingScan}
                  type="submit"
                >
                  {props.confirmingPendingScan ? t("common.saving") : t("daily_log.confirm_add")}
                </button>
                <button
                  className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  disabled={props.confirmingPendingScan}
                  onClick={() => {
                    void props.onPendingUseAsIs();
                  }}
                  type="button"
                >
                  {t("daily_log.use_as_is")}
                </button>
              </form>
            )}
          </div>
        )}
        {props.meals.length === 0 && <p className="text-sm text-slate-500">{t("daily_log.empty")}</p>}
        {props.meals.map((meal) => (
          <SwipeMealRow
            key={meal.id}
            deleting={props.deletingMealId === meal.id}
            meal={meal}
            onDelete={props.onDeleteMeal}
          />
        ))}
      </div>
    </section>
  );
}

function OnboardingView(props: {
  form: OnboardingForm;
  saving: boolean;
  onChange: (patch: Partial<OnboardingForm>) => void;
  onSubmit: () => Promise<void>;
}) {
  const { t, hasTranslation } = useI18n();
  async function submit(e: FormEvent) {
    e.preventDefault();
    await props.onSubmit();
  }

  return (
    <form className="space-y-4 rounded-3xl bg-white p-5 shadow-sm" onSubmit={submit}>
      <h2 className="text-lg font-semibold text-ink">{t("onboarding.title")}</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">
          {t("onboarding.timezone")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.timezone}
            onChange={(e) => props.onChange({ timezone: e.target.value })}
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("onboarding.language")}
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.language}
            onChange={(e) => props.onChange({ language: e.target.value })}
          >
            <option value="">{t("language.system")}</option>
            {SUPPORTED_LOCALES.map((supportedLocale) => (
              <option key={supportedLocale} value={supportedLocale}>
                {hasTranslation(`language.${supportedLocale}`) ? t(`language.${supportedLocale}`) : supportedLocale.toUpperCase()}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm text-slate-600">
          {t("onboarding.goal_type")}
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.goalType}
            onChange={(e) => props.onChange({ goalType: e.target.value as GoalType })}
          >
            <option value="lose">{t("goal_type.lose")}</option>
            <option value="maintain">{t("goal_type.maintain")}</option>
            <option value="gain">{t("goal_type.gain")}</option>
          </select>
        </label>
        <label className="text-sm text-slate-600">
          {t("onboarding.height")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.heightCm}
            onChange={(e) => props.onChange({ heightCm: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("onboarding.weight")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.weightKg}
            onChange={(e) => props.onChange({ weightKg: e.target.value })}
            type="number"
            step="0.1"
          />
        </label>
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t("onboarding.daily_goals")}</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">
          {t("onboarding.calories")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.calories}
            onChange={(e) => props.onChange({ calories: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("onboarding.protein")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.proteinG}
            onChange={(e) => props.onChange({ proteinG: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("onboarding.carbs")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.carbsG}
            onChange={(e) => props.onChange({ carbsG: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("onboarding.fat")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.fatG}
            onChange={(e) => props.onChange({ fatG: e.target.value })}
            type="number"
          />
        </label>
      </div>
      <button
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        disabled={props.saving}
        type="submit"
      >
        {props.saving ? t("common.saving") : t("onboarding.save")}
      </button>
    </form>
  );
}

function AddMealView(props: {
  form: MealForm;
  saving: boolean;
  onChange: (patch: Partial<MealForm>) => void;
  onSubmit: () => Promise<void>;
}) {
  const { t } = useI18n();
  async function submit(e: FormEvent) {
    e.preventDefault();
    await props.onSubmit();
  }

  return (
    <form className="space-y-4 rounded-3xl bg-white p-5 shadow-sm" onSubmit={submit}>
      <h2 className="text-lg font-semibold text-ink">{t("add_meal.title")}</h2>
      <label className="block text-sm text-slate-600">
        {t("add_meal.meal_title")}
        <input
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
          value={props.form.title}
          onChange={(e) => props.onChange({ title: e.target.value })}
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">
          {t("add_meal.meal_type")}
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.mealType}
            onChange={(e) => props.onChange({ mealType: e.target.value as MealType })}
          >
            <option value="breakfast">{t("meal_type.breakfast")}</option>
            <option value="lunch">{t("meal_type.lunch")}</option>
            <option value="dinner">{t("meal_type.dinner")}</option>
            <option value="snack">{t("meal_type.snack")}</option>
          </select>
        </label>
        <label className="text-sm text-slate-600">
          {t("common.time")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.eatenAt}
            onChange={(e) => props.onChange({ eatenAt: e.target.value })}
            type="datetime-local"
            required
          />
        </label>
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">{t("add_meal.single_item")}</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-sm text-slate-600">
          {t("add_meal.item_name")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.itemName}
            onChange={(e) => props.onChange({ itemName: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("add_meal.calories")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.calories}
            onChange={(e) => props.onChange({ calories: e.target.value })}
            type="number"
            required
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("add_meal.protein")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.proteinG}
            onChange={(e) => props.onChange({ proteinG: e.target.value })}
            type="number"
            step="0.1"
            required
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("add_meal.carbs")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.carbsG}
            onChange={(e) => props.onChange({ carbsG: e.target.value })}
            type="number"
            step="0.1"
            required
          />
        </label>
        <label className="text-sm text-slate-600">
          {t("add_meal.fat")}
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.fatG}
            onChange={(e) => props.onChange({ fatG: e.target.value })}
            type="number"
            step="0.1"
            required
          />
        </label>
      </div>
      <button
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        disabled={props.saving}
        type="submit"
      >
        {props.saving ? t("common.saving") : t("add_meal.submit")}
      </button>
    </form>
  );
}

function ScannerView(props: {
  imagePreview: string | null;
  fileName: string | null;
  description: string;
  scanStatus: ScanStatus | null;
  scanning: boolean;
  scanProgress: number;
  elapsedSeconds: number;
  onPickFile: (file: File | null) => void;
  onDescriptionChange: (value: string) => void;
  onScan: () => Promise<void>;
  onRetry: () => Promise<void>;
  onCancel: () => void | Promise<void>;
  onFallbackToManual: () => void;
}) {
  const { t } = useI18n();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const galleryInputRef = useRef<HTMLInputElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [cameraOpen, setCameraOpen] = useState(false);
  const [cameraBusy, setCameraBusy] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [cameraError, setCameraError] = useState<string | null>(null);

  useEffect(() => {
    return () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
        streamRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    async function attachStream() {
      if (!cameraOpen || !videoRef.current || !streamRef.current) return;
      videoRef.current.srcObject = streamRef.current;
      try {
        await videoRef.current.play();
      } catch {
        // Mobile browsers may require user gesture; camera button click already provides it.
      }
    }
    void attachStream();
  }, [cameraOpen]);

  async function openCamera() {
    setCameraError(null);
    setCameraReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setCameraError(t("scanner.camera_unavailable"));
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" } },
        audio: false
      });
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((track) => track.stop());
      }
      streamRef.current = stream;
      setCameraOpen(true);
    } catch (error) {
      const message = error instanceof Error ? error.message : t("scanner.open_camera_failed");
      setCameraError(message);
      setCameraOpen(false);
    }
  }

  function closeCamera() {
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
    setCameraReady(false);
    setCameraOpen(false);
  }

  async function captureFromCamera() {
    if (!videoRef.current || !canvasRef.current || !cameraOpen) return;
    const video = videoRef.current;
    const canvas = canvasRef.current;
    const width = video.videoWidth;
    const height = video.videoHeight;
    if (!cameraReady || !width || !height) {
      setCameraError(t("scanner.camera_not_ready"));
      return;
    }
    setCameraBusy(true);
    try {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error(t("scanner.camera_frame_failed"));
      context.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.92);
      });
      if (!blob) throw new Error(t("scanner.capture_failed"));
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      props.onPickFile(file);
      closeCamera();
    } catch (error) {
      const message = error instanceof Error ? error.message : t("scanner.capture_failed");
      setCameraError(message);
    } finally {
      setCameraBusy(false);
    }
  }

  return (
    <section className="quick-add-sheet space-y-4 rounded-[28px] bg-white p-5 shadow-sm">
      <h2 className="text-xl font-semibold text-ink">{t("scanner.title")}</h2>
      <label className="block text-sm text-slate-600">
        {t("scanner.description_label")}
        <textarea
          className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2"
          placeholder={t("scanner.description_placeholder")}
          value={props.description}
          onChange={(e) => props.onDescriptionChange(e.target.value)}
        />
      </label>
      <div className="space-y-2">
        <p className="text-sm text-slate-600">{t("scanner.food_photo")}</p>
        {!cameraOpen && (
          <button
            className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700"
            onClick={() => {
              void openCamera();
            }}
            type="button"
          >
            {t("scanner.open_camera")}
          </button>
        )}
        {cameraOpen && (
          <div className="space-y-2">
            <video
              autoPlay
              className="h-56 w-full rounded-xl bg-slate-900 object-cover"
              muted
              onLoadedMetadata={() => setCameraReady(true)}
              onPlaying={() => setCameraReady(true)}
              playsInline
              ref={videoRef}
            />
            <div className="grid grid-cols-2 gap-2">
              <button
                className="rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
                disabled={cameraBusy || !cameraReady}
                onClick={() => {
                  void captureFromCamera();
                }}
                type="button"
              >
                {cameraBusy ? t("scanner.capturing") : cameraReady ? t("scanner.take_photo") : t("scanner.camera_starting")}
              </button>
              <button
                className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700"
                onClick={closeCamera}
                type="button"
              >
                {t("scanner.close_camera")}
              </button>
            </div>
          </div>
        )}
        <input
          accept="image/*"
          className="hidden"
          onChange={(e) => props.onPickFile(e.target.files?.[0] ?? null)}
          ref={galleryInputRef}
          type="file"
        />
        <button
          className="w-full rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700"
          onClick={() => galleryInputRef.current?.click()}
          type="button"
        >
          {t("scanner.choose_gallery")}
        </button>
        {cameraError && <p className="text-xs text-red-600">{t("common.camera_error", { message: cameraError })}</p>}
        <canvas className="hidden" ref={canvasRef} />
      </div>
      {props.fileName && <p className="text-xs text-slate-500">{t("common.selected", { name: props.fileName })}</p>}
      {props.imagePreview && (
        <img alt="Meal preview" className="h-48 w-full rounded-xl object-cover" src={props.imagePreview} />
      )}
      <button
        className="w-full rounded-2xl bg-gradient-to-r from-blue-600 to-blue-500 px-4 py-3 text-sm font-semibold text-white shadow-[0_10px_24px_rgba(37,99,235,0.32)] disabled:opacity-60"
        disabled={props.scanning || (!props.fileName && !props.description.trim())}
        onClick={() => {
          void props.onScan();
        }}
        type="button"
      >
        {props.scanning ? t("scanner.scanning") : t("scanner.analyze_photo")}
      </button>
      {(props.scanning ||
        props.scanStatus?.status === "queued" ||
        props.scanStatus?.status === "processing") && (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
            <span>{t("common.progress")}</span>
            <span>{props.elapsedSeconds}s</span>
          </div>
          <div className="h-2 w-full rounded bg-slate-100">
            <div
              className="h-2 rounded bg-primary transition-all"
              style={{ width: `${Math.max(5, Math.min(100, props.scanProgress))}%` }}
            />
          </div>
          <button
            className="mt-3 w-full rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
            onClick={props.onCancel}
            type="button"
          >
            {t("scanner.cancel_scan")}
          </button>
        </div>
      )}

      {props.scanStatus && (
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-ink">
            {t("common.status")}: {props.scanStatus.status}
          </p>
          {props.scanStatus.status === "queued" && (
            <p className="mt-1 text-xs text-slate-600">{t("scanner.uploaded_waiting")}</p>
          )}
          {props.scanStatus.status === "processing" && (
            <p className="mt-1 text-xs text-slate-600">{t("scanner.processing")}</p>
          )}
          {props.scanStatus.status === "succeeded" && (
            <p className="mt-1 text-xs text-emerald-700">{t("scanner.succeeded")}</p>
          )}
          {props.scanStatus.status === "cancelled" && (
            <p className="mt-1 text-xs text-slate-600">{t("scanner.cancelled")}</p>
          )}
          {props.scanStatus.status === "failed" && (
            <>
              <p className="mt-1 text-xs text-red-600">
                {t(`errors.${humanizeScanError(props.scanStatus.errorCode)}`)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
                  onClick={() => {
                    void props.onRetry();
                  }}
                  type="button"
                >
                  {t("scanner.retry_scan")}
                </button>
                <button
                  className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800"
                  onClick={props.onFallbackToManual}
                  type="button"
                >
                  {t("scanner.manual_fallback")}
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </section>
  );
}

function toOnboardingForm(profile: Profile, goals: Goals): OnboardingForm {
  return {
    timezone: profile.timezone || "UTC",
    language: profile.language || "",
    heightCm: profile.heightCm?.toString() ?? "",
    weightKg: profile.weightKg?.toString() ?? "",
    goalType: profile.goalType ?? "maintain",
    calories: goals.calories.toString(),
    proteinG: goals.proteinG.toString(),
    carbsG: goals.carbsG.toString(),
    fatG: goals.fatG.toString()
  };
}

export function App() {
  const { t, setPreferredLocale } = useI18n();
  const initialDateTime = currentDatetimeLocal();
  const initialMealType = detectMealTypeFromLocalDatetime(initialDateTime);
  const [tab, setTab] = useState<Tab>("dashboard");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [savingOnboarding, setSavingOnboarding] = useState(false);
  const [savingMeal, setSavingMeal] = useState(false);
  const [deletingMealId, setDeletingMealId] = useState<string | null>(null);
  const [scanning, setScanning] = useState(false);
  const [confirmingScan, setConfirmingScan] = useState(false);
  const [scanProgress, setScanProgress] = useState(0);
  const [scanElapsedSeconds, setScanElapsedSeconds] = useState(0);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [achievements, setAchievements] = useState<AchievementsResponse | null>(null);
  const [celebrationQueue, setCelebrationQueue] = useState<Achievement[]>([]);
  const [activeCelebration, setActiveCelebration] = useState<UnlockCelebration | null>(null);
  const [levelUpQueue, setLevelUpQueue] = useState<number[]>([]);
  const [activeLevelUp, setActiveLevelUp] = useState<LevelUpCelebration | null>(null);
  const [meals, setMeals] = useState<Meal[]>([]);
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm>({
    timezone: "UTC",
    language: "",
    heightCm: "",
    weightKg: "",
    goalType: "maintain",
    calories: "2000",
    proteinG: "120",
    carbsG: "200",
    fatG: "70"
  });
  const [mealForm, setMealForm] = useState<MealForm>({
    title: "",
    mealType: initialMealType,
    eatenAt: initialDateTime,
    itemName: "",
    calories: "",
    proteinG: "",
    carbsG: "",
    fatG: ""
  });
  const [scanFile, setScanFile] = useState<File | null>(null);
  const [scanDescription, setScanDescription] = useState("");
  const [scanPreview, setScanPreview] = useState<string | null>(null);
  const [scanStatus, setScanStatus] = useState<ScanStatus | null>(null);
  const [activeScanId, setActiveScanId] = useState<string | null>(null);
  const [recalculatingScan, setRecalculatingScan] = useState(false);
  const [scanConfirmForm, setScanConfirmForm] = useState<ScanConfirmForm>({
    title: "",
    mealType: initialMealType,
    eatenAt: initialDateTime,
    itemName: "",
    calories: "",
    proteinG: "",
    carbsG: "",
    fatG: ""
  });
  const selectedDate = todayIso();
  const scanCancelledRef = useRef(false);
  const unlockedAchievementKeysRef = useRef<Set<string> | null>(null);
  const previousLevelRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (scanPreview) URL.revokeObjectURL(scanPreview);
    };
  }, [scanPreview]);

  useEffect(() => {
    if (activeCelebration || celebrationQueue.length === 0) return;
    const [nextAchievement, ...restQueue] = celebrationQueue;
    setCelebrationQueue(restQueue);
    setActiveCelebration({
      achievement: nextAchievement,
      particles: createCelebrationParticles()
    });
  }, [activeCelebration, celebrationQueue]);

  useEffect(() => {
    if (!activeCelebration) return;
    const timeoutId = window.setTimeout(() => {
      setActiveCelebration(null);
    }, 2400);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeCelebration]);

  useEffect(() => {
    if (activeLevelUp || levelUpQueue.length === 0) return;
    const [nextLevel, ...restQueue] = levelUpQueue;
    setLevelUpQueue(restQueue);
    setActiveLevelUp({ level: nextLevel, particles: createCelebrationParticles() });
  }, [activeLevelUp, levelUpQueue]);

  useEffect(() => {
    if (!activeLevelUp) return;
    const timeoutId = window.setTimeout(() => {
      setActiveLevelUp(null);
    }, 2400);
    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [activeLevelUp]);

  async function loadAll() {
    setError(null);
    const [profileData, goalsData, dashboardData, mealsData, achievementsData] = await Promise.all([
      api.getProfile(),
      api.getGoals(),
      api.getDashboard(selectedDate),
      api.getMeals(selectedDate),
      api.getAchievements()
    ]);
    const unlockedKeys = new Set(achievementsData.items.filter((item) => item.unlocked).map((item) => item.key));
    const previousUnlockedKeys = unlockedAchievementKeysRef.current;
    if (previousUnlockedKeys) {
      const newlyUnlocked = achievementsData.items.filter((item) => item.unlocked && !previousUnlockedKeys.has(item.key));
      if (newlyUnlocked.length > 0) {
        setCelebrationQueue((current) => [...current, ...newlyUnlocked]);
      }
    }
    unlockedAchievementKeysRef.current = unlockedKeys;
    const previousLevel = previousLevelRef.current;
    if (previousLevel !== null && profileData.level > previousLevel) {
      const nextLevels = Array.from({ length: profileData.level - previousLevel }, (_, index) => previousLevel + index + 1);
      setLevelUpQueue((current) => [...current, ...nextLevels]);
    }
    previousLevelRef.current = profileData.level;
    setPreferredLocale(profileData.language);
    setProfile(profileData);
    setDashboard(dashboardData);
    setMeals(mealsData.items);
    setAchievements(achievementsData);
    setOnboardingForm(toOnboardingForm(profileData, goalsData));
  }

  useEffect(() => {
    let mounted = true;
    async function bootstrap() {
      setLoading(true);
      setError(null);
      try {
        await bootstrapSession();
        if (!mounted) return;
        await loadAll();
      } catch (e) {
        if (!mounted) return;
        setError(e instanceof Error ? e.message : t("errors.scan_missing_init"));
      } finally {
        if (mounted) setLoading(false);
      }
    }
    void bootstrap();
    return () => {
      mounted = false;
    };
  }, [selectedDate]);

  async function submitOnboarding() {
    setError(null);
    setSuccess(null);
    setSavingOnboarding(true);
    try {
      await api.putProfile({
        timezone: onboardingForm.timezone.trim() || "UTC",
        language: onboardingForm.language.trim() || null,
        heightCm: onboardingForm.heightCm ? Number(onboardingForm.heightCm) : null,
        weightKg: onboardingForm.weightKg ? Number(onboardingForm.weightKg) : null,
        goalType: onboardingForm.goalType
      });
      await api.putGoals({
        calories: Number(onboardingForm.calories),
        proteinG: Number(onboardingForm.proteinG),
        carbsG: Number(onboardingForm.carbsG),
        fatG: Number(onboardingForm.fatG)
      });
      await loadAll();
      setSuccess(t("messages.onboarding_saved"));
      setTab("dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save_onboarding"));
    } finally {
      setSavingOnboarding(false);
    }
  }

  async function submitMeal() {
    setError(null);
    setSuccess(null);
    setSavingMeal(true);
    try {
      await api.createMeal({
        title: mealForm.title.trim(),
        mealType: mealForm.mealType,
        eatenAt: new Date(mealForm.eatenAt).toISOString(),
        items: [
          {
            name: mealForm.itemName.trim(),
            calories: Number(mealForm.calories),
            proteinG: Number(mealForm.proteinG),
            carbsG: Number(mealForm.carbsG),
            fatG: Number(mealForm.fatG)
          }
        ]
      });
      await loadAll();
      const nextDateTime = currentDatetimeLocal();
      setMealForm({
        title: "",
        mealType: detectMealTypeFromLocalDatetime(nextDateTime),
        eatenAt: nextDateTime,
        itemName: "",
        calories: "",
        proteinG: "",
        carbsG: "",
        fatG: ""
      });
      setSuccess(t("messages.meal_added"));
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.save_meal"));
      setTab("daily-log");
    } finally {
      setSavingMeal(false);
    }
  }

  async function deleteMeal(mealId: string) {
    setError(null);
    setSuccess(null);
    setDeletingMealId(mealId);
    try {
      await api.deleteMeal(mealId);
      await loadAll();
      setSuccess(t("messages.meal_deleted"));
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.delete_meal"));
    } finally {
      setDeletingMealId(null);
    }
  }

  function onPickScanFile(file: File | null) {
    const nextDateTime = currentDatetimeLocal();
    const nextMealType = detectMealTypeFromLocalDatetime(nextDateTime);
    if (scanPreview) URL.revokeObjectURL(scanPreview);
    setScanFile(file);
    setScanStatus(null);
    setScanProgress(0);
    setScanElapsedSeconds(0);
    setScanConfirmForm({
      title: "",
      mealType: nextMealType,
      eatenAt: nextDateTime,
      itemName: "",
      calories: "",
      proteinG: "",
      carbsG: "",
      fatG: ""
    });
    setScanPreview(file ? URL.createObjectURL(file) : null);
  }

  function resetScanComposer() {
    const nextDateTime = currentDatetimeLocal();
    const nextMealType = detectMealTypeFromLocalDatetime(nextDateTime);
    if (scanPreview) URL.revokeObjectURL(scanPreview);
    setScanFile(null);
    setScanDescription("");
    setScanPreview(null);
    setScanProgress(0);
    setScanElapsedSeconds(0);
    setScanStatus(null);
    setScanConfirmForm({
      title: "",
      mealType: nextMealType,
      eatenAt: nextDateTime,
      itemName: "",
      calories: "",
      proteinG: "",
      carbsG: "",
      fatG: ""
    });
  }

  async function startScan() {
    if (!scanFile && !scanDescription.trim()) return;
    scanCancelledRef.current = false;
    setError(null);
    setSuccess(null);
    setScanning(true);
    setScanProgress(5);
    setScanElapsedSeconds(0);
    try {
      const startedAt = Date.now();
      const maxDurationMs = 60_000;
      const job = await api.createScan(scanFile, scanDescription);
      setActiveScanId(job.id);
      let status = await api.getScanStatus(job.id);
      setScanStatus(status);
      setScanElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
      setScanProgress(status.status === "succeeded" ? 100 : 20);

      let attempts = 0;
      while ((status.status === "queued" || status.status === "processing") && attempts < 30) {
        if (scanCancelledRef.current) {
          setSuccess(t("messages.scan_canceled"));
          setActiveScanId(null);
          return;
        }
        if (Date.now() - startedAt > maxDurationMs) {
          setError(t("errors.provider_timeout"));
          return;
        }
        await sleep(1200);
        status = await api.getScanStatus(job.id);
        setScanStatus(status);
        const elapsed = Math.floor((Date.now() - startedAt) / 1000);
        setScanElapsedSeconds(elapsed);
        setScanProgress(Math.min(95, 20 + attempts * 3));
        attempts += 1;
      }

      if (status.status === "succeeded" && status.result) {
        setScanProgress(100);
        const nextDateTime = currentDatetimeLocal();
        setScanConfirmForm({
          title: status.result.dishName,
          mealType: detectMealTypeFromLocalDatetime(nextDateTime),
          eatenAt: nextDateTime,
          itemName: status.result.dishName,
          calories: String(status.result.calories),
          proteinG: String(status.result.proteinG),
          carbsG: String(status.result.carbsG),
          fatG: String(status.result.fatG)
        });
        setSuccess(t("messages.scan_draft_ready"));
        setTab("daily-log");
      }
      if (status.status === "failed") {
        setScanProgress(100);
        setError(t(`errors.${humanizeScanError(status.errorCode)}`));
        setTab("daily-log");
      }
      if (status.status === "cancelled") {
        setScanProgress(100);
        setSuccess(t("messages.scan_canceled"));
        setTab("daily-log");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.provider_unknown_error"));
      setTab("daily-log");
    } finally {
      setScanning(false);
      setActiveScanId(null);
    }
  }

  async function cancelScan() {
    scanCancelledRef.current = true;
    if (activeScanId) {
      try {
        const cancelled = await api.cancelScan(activeScanId);
        setScanStatus(cancelled);
      } catch {
        // Best effort: backend may already finish before cancellation.
      }
    }
    setScanning(false);
    setScanProgress(0);
    setActiveScanId(null);
  }

  async function confirmScan() {
    if (!scanStatus || scanStatus.status !== "succeeded") return;
    setError(null);
    setSuccess(null);
    setConfirmingScan(true);
    try {
      await api.confirmScan(scanStatus.id, {
        title: scanConfirmForm.title.trim(),
        mealType: scanConfirmForm.mealType,
        eatenAt: new Date(scanConfirmForm.eatenAt).toISOString(),
        items: [
          {
            name: scanConfirmForm.itemName.trim(),
            calories: Number(scanConfirmForm.calories),
            proteinG: Number(scanConfirmForm.proteinG),
            carbsG: Number(scanConfirmForm.carbsG),
            fatG: Number(scanConfirmForm.fatG),
            confidence: scanStatus.result?.confidence ?? null
          }
        ]
      });
      await loadAll();
      resetScanComposer();
      setSuccess(t("messages.scan_meal_added"));
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.confirm_scan"));
      setTab("daily-log");
    } finally {
      setConfirmingScan(false);
    }
  }

  async function useScanAsIs() {
    if (!scanStatus || scanStatus.status !== "succeeded" || !scanStatus.result) return;
    setError(null);
    setSuccess(null);
    setConfirmingScan(true);
    try {
      const nextDateTime = currentDatetimeLocal();
      const mealType = detectMealTypeFromLocalDatetime(nextDateTime);
      setScanConfirmForm({
        title: scanStatus.result.dishName,
        mealType,
        eatenAt: nextDateTime,
        itemName: scanStatus.result.dishName,
        calories: String(scanStatus.result.calories),
        proteinG: String(scanStatus.result.proteinG),
        carbsG: String(scanStatus.result.carbsG),
        fatG: String(scanStatus.result.fatG)
      });
      await api.confirmScan(scanStatus.id, {
        title: scanStatus.result.dishName,
        mealType,
        eatenAt: new Date(nextDateTime).toISOString(),
        items: [
          {
            name: scanStatus.result.dishName,
            calories: scanStatus.result.calories,
            proteinG: scanStatus.result.proteinG,
            carbsG: scanStatus.result.carbsG,
            fatG: scanStatus.result.fatG,
            confidence: scanStatus.result.confidence
          }
        ]
      });
      await loadAll();
      resetScanComposer();
      setSuccess(t("messages.scan_meal_added"));
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.confirm_scan"));
      setTab("daily-log");
    } finally {
      setConfirmingScan(false);
    }
  }

  async function recalculateScan(comment: string) {
    if (!scanStatus || scanStatus.status !== "succeeded") return;
    setError(null);
    setRecalculatingScan(true);
    try {
      const updated = await api.recalculateScan(scanStatus.id, comment);
      setScanStatus(updated);
      if (updated.status === "succeeded" && updated.result) {
        setScanConfirmForm((prev) => ({
          ...prev,
          title: updated.result?.dishName ?? prev.title,
          itemName: updated.result?.dishName ?? prev.itemName,
          calories: String(updated.result?.calories ?? prev.calories),
          proteinG: String(updated.result?.proteinG ?? prev.proteinG),
          carbsG: String(updated.result?.carbsG ?? prev.carbsG),
          fatG: String(updated.result?.fatG ?? prev.fatG)
        }));
      }
      await loadAll();
      setSuccess(t("messages.scan_recalculated"));
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : t("errors.recalculate_scan"));
      setTab("daily-log");
    } finally {
      setRecalculatingScan(false);
    }
  }

  function fallbackToManualMeal() {
    setMealForm({
      title: scanConfirmForm.title || scanConfirmForm.itemName,
      mealType: scanConfirmForm.mealType,
      eatenAt: scanConfirmForm.eatenAt,
      itemName: scanConfirmForm.itemName || scanConfirmForm.title,
      calories: scanConfirmForm.calories,
      proteinG: scanConfirmForm.proteinG,
      carbsG: scanConfirmForm.carbsG,
      fatG: scanConfirmForm.fatG
    });
    setTab("add-meal");
  }

  return (
    <div className="mx-auto min-h-screen max-w-md bg-surface px-4 pb-28 pt-6">
      <AchievementUnlockCelebration celebration={activeCelebration} />
      <LevelUpOverlay celebration={activeLevelUp} />
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">{t("app.subtitle")}</p>
        <h1 className="text-2xl font-bold text-ink">{t("app.title")}</h1>
        <p className="text-sm text-slate-500">
          {t("app.selected_date", { date: selectedDate, timezone: profile?.timezone ?? "UTC" })}
        </p>
      </header>

      {loading && <p className="rounded-xl bg-white p-4 text-slate-600 shadow-sm">{t("app.loading")}</p>}
      {error && (
        <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 shadow-sm">
          {t("app.failed_prefix")} {error}
        </p>
      )}
      {success && (
        <p className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 shadow-sm">{success}</p>
      )}

      {!loading && dashboard && (
        <>
          {tab === "dashboard" && profile && <DashboardView achievements={achievements} dashboard={dashboard} profile={profile} />}
          {tab === "daily-log" && (
            <DailyLogView
              deletingMealId={deletingMealId}
              meals={meals}
              onDeleteMeal={deleteMeal}
              pendingScan={scanStatus}
              pendingConfirmForm={scanConfirmForm}
              confirmingPendingScan={confirmingScan}
              recalculatingPendingScan={recalculatingScan}
              onPendingConfirmChange={(patch) => setScanConfirmForm((prev) => ({ ...prev, ...patch }))}
              onPendingConfirm={confirmScan}
              onPendingUseAsIs={useScanAsIs}
              onPendingRecalculate={recalculateScan}
            />
          )}
          {tab === "onboarding" && (
            <OnboardingView
              form={onboardingForm}
              saving={savingOnboarding}
              onChange={(patch) => {
                if ("language" in patch) {
                  setPreferredLocale(patch.language || null);
                }
                setOnboardingForm((prev) => ({ ...prev, ...patch }));
              }}
              onSubmit={submitOnboarding}
            />
          )}
          {tab === "add-meal" && (
            <AddMealView
              form={mealForm}
              saving={savingMeal}
              onChange={(patch) => setMealForm((prev) => ({ ...prev, ...patch }))}
              onSubmit={submitMeal}
            />
          )}
          {tab === "quick-add" && (
            <ScannerView
              imagePreview={scanPreview}
              fileName={scanFile?.name ?? null}
              description={scanDescription}
              scanStatus={scanStatus}
              scanning={scanning}
              scanProgress={scanProgress}
              elapsedSeconds={scanElapsedSeconds}
              onPickFile={onPickScanFile}
              onDescriptionChange={setScanDescription}
              onScan={startScan}
              onRetry={startScan}
              onCancel={cancelScan}
              onFallbackToManual={fallbackToManualMeal}
            />
          )}
        </>
      )}

      <nav className="bottom-nav fixed bottom-0 left-1/2 grid w-full max-w-md -translate-x-1/2 grid-cols-5 gap-2 border-t border-slate-200 bg-white p-3">
        <button
          className={`nav-chip px-2 py-2 text-xs font-medium ${
            tab === "dashboard" ? "nav-chip-active text-white" : "text-slate-700"
          }`}
          onClick={() => setTab("dashboard")}
          type="button"
        >
          {t("tabs.dashboard")}
        </button>
        <button
          className={`nav-chip px-2 py-2 text-xs font-medium ${
            tab === "daily-log" ? "nav-chip-active text-white" : "text-slate-700"
          }`}
          onClick={() => setTab("daily-log")}
          type="button"
        >
          {t("tabs.daily_log")}
        </button>
        <button
          aria-label={t("tabs.quick_add")}
          className={`quick-add-cta quick-add-cta-ring -mt-7 flex h-16 flex-col items-center justify-center rounded-full px-0 py-0 text-xs font-bold ${
            tab === "quick-add"
              ? "quick-add-cta-active text-white"
              : "bg-gradient-to-br from-amber-300 via-orange-300 to-rose-300 text-ink"
          }`}
          onClick={() => setTab("quick-add")}
          type="button"
        >
          <span className="text-2xl leading-none">+</span>
          <span className="text-[10px] uppercase tracking-wide">{t("tabs.quick_add")}</span>
        </button>
        <button
          className={`nav-chip px-2 py-2 text-xs font-medium ${
            tab === "add-meal" ? "nav-chip-active text-white" : "text-slate-700"
          }`}
          onClick={() => setTab("add-meal")}
          type="button"
        >
          {t("tabs.add_meal")}
        </button>
        <button
          className={`nav-chip px-2 py-2 text-xs font-medium ${
            tab === "onboarding" ? "nav-chip-active text-white" : "text-slate-700"
          }`}
          onClick={() => setTab("onboarding")}
          type="button"
        >
          {t("tabs.settings")}
        </button>
      </nav>
    </div>
  );
}
