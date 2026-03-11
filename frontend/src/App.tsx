import { FormEvent, TouchEvent, useEffect, useRef, useState } from "react";
import {
  api,
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

type Tab = "dashboard" | "daily-log" | "quick-add" | "onboarding" | "add-meal";

type OnboardingForm = {
  timezone: string;
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
  if (!errorCode) return "Unknown error";
  const map: Record<string, string> = {
    provider_auth_missing: "OpenRouter API key is missing on backend",
    provider_invalid_image: "Image was rejected by model provider. Try another photo.",
    provider_auth_invalid: "OpenRouter key is invalid or expired",
    provider_quota_exceeded: "OpenRouter quota/payment issue",
    provider_forbidden: "Access to model is denied",
    provider_rate_limited: "Rate limit reached, retry in a few seconds",
    provider_internal_error: "Provider internal error, retry later",
    provider_connect_error: "Network connect error from backend to OpenRouter",
    provider_timeout: "Model timeout, retry with another image",
    provider_unknown_error: "Unknown provider error. Retry with another image."
  };
  return map[errorCode] ?? errorCode;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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

function DashboardView({ dashboard }: { dashboard: Dashboard }) {
  const kcalPercent =
    dashboard.goals.calories > 0
      ? Math.min(100, Math.round((dashboard.totals.calories / dashboard.goals.calories) * 100))
      : 0;

  return (
    <section className="space-y-4">
      <div className="rounded-3xl bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-500">Daily Summary</p>
        <h1 className="mt-2 text-3xl font-bold text-ink">{dashboard.totals.calories} kcal</h1>
        <p className="text-sm text-slate-500">Goal {dashboard.goals.calories} kcal</p>
        <div className="mt-4 h-3 rounded-full bg-slate-100">
          <div className="h-3 rounded-full bg-primary" style={{ width: `${kcalPercent}%` }} />
        </div>
      </div>
      <div className="grid grid-cols-3 gap-3">
        <MacroBar
          label="Protein"
          value={dashboard.totals.proteinG}
          goal={dashboard.goals.proteinG}
          color="bg-emerald-500"
        />
        <MacroBar
          label="Carbs"
          value={dashboard.totals.carbsG}
          goal={dashboard.goals.carbsG}
          color="bg-amber-500"
        />
        <MacroBar
          label="Fat"
          value={dashboard.totals.fatG}
          goal={dashboard.goals.fatG}
          color="bg-blue-500"
        />
      </div>
    </section>
  );
}

function SwipeMealRow(props: {
  meal: Meal;
  deleting: boolean;
  onDelete: (mealId: string) => Promise<void>;
}) {
  const swipeStartXRef = useRef<number | null>(null);
  const [dragOffsetX, setDragOffsetX] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [dragging, setDragging] = useState(false);
  const actionWidth = 96;
  const revealThreshold = 64;
  const mealCalories = props.meal.items.reduce((acc, item) => acc + item.calories, 0);

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
          {props.deleting ? "Deleting..." : "Delete"}
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
          {props.meal.mealType} - {formatTime(props.meal.eatenAt)}
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
      <h2 className="text-lg font-semibold text-ink">Daily Log</h2>
      <div className="mt-4 space-y-3">
        {draftResult && (
          <div className="rounded-xl border border-primary/30 bg-primary/5 p-3">
            <button
              className="w-full text-left"
              onClick={() => setDraftExpanded((prev) => !prev)}
              type="button"
            >
              <div className="flex items-center justify-between">
                <h3 className="font-medium text-ink">AI Draft: {draftResult.dishName}</h3>
                <span className="text-sm font-semibold text-primary">{draftResult.calories} kcal</span>
              </div>
              <p className="mt-1 text-xs text-slate-600">
                Tap to {draftExpanded ? "hide" : "edit"} and send recalculation comment
              </p>
            </button>
            {draftExpanded && (
              <form className="mt-3 space-y-3 rounded-lg border border-slate-200 bg-white p-3" onSubmit={submitPendingConfirm}>
                <div className="rounded-lg bg-slate-50 p-3 text-xs text-slate-700">
                  <p>
                    Confidence: <span className="font-semibold">{Math.round(draftResult.confidence * 100)}%</span>
                  </p>
                  {draftResult.alternatives.length > 0 && (
                    <p className="mt-1">
                      Alternatives: <span className="font-medium">{draftResult.alternatives.join(", ")}</span>
                    </p>
                  )}
                </div>
                <div className="space-y-2 rounded-lg border border-slate-200 p-3">
                  <label className="block text-xs font-semibold uppercase tracking-wide text-slate-500">
                    Comment for recalculation
                  </label>
                  <textarea
                    className="min-h-16 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm"
                    placeholder="e.g. add avocado and olive oil"
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
                    {props.recalculatingPendingScan ? "Recalculating..." : "Recalculate by comment"}
                  </button>
                </div>
                <label className="block text-sm text-slate-600">
                  Title
                  <input
                    className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                    value={props.pendingConfirmForm.title}
                    onChange={(e) => props.onPendingConfirmChange({ title: e.target.value })}
                  />
                </label>
                <div className="grid grid-cols-2 gap-3">
                  <label className="text-sm text-slate-600">
                    Meal type
                    <select
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      value={props.pendingConfirmForm.mealType}
                      onChange={(e) => props.onPendingConfirmChange({ mealType: e.target.value as MealType })}
                    >
                      <option value="breakfast">Breakfast</option>
                      <option value="lunch">Lunch</option>
                      <option value="dinner">Dinner</option>
                      <option value="snack">Snack</option>
                    </select>
                  </label>
                  <label className="text-sm text-slate-600">
                    Time
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="datetime-local"
                      value={props.pendingConfirmForm.eatenAt}
                      onChange={(e) => props.onPendingConfirmChange({ eatenAt: e.target.value })}
                    />
                  </label>
                  <label className="col-span-2 text-sm text-slate-600">
                    Item name
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      value={props.pendingConfirmForm.itemName}
                      onChange={(e) => props.onPendingConfirmChange({ itemName: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Calories
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="number"
                      value={props.pendingConfirmForm.calories}
                      onChange={(e) => props.onPendingConfirmChange({ calories: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Protein (g)
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="number"
                      step="0.1"
                      value={props.pendingConfirmForm.proteinG}
                      onChange={(e) => props.onPendingConfirmChange({ proteinG: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Carbs (g)
                    <input
                      className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
                      type="number"
                      step="0.1"
                      value={props.pendingConfirmForm.carbsG}
                      onChange={(e) => props.onPendingConfirmChange({ carbsG: e.target.value })}
                    />
                  </label>
                  <label className="text-sm text-slate-600">
                    Fat (g)
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
                  {props.confirmingPendingScan ? "Saving..." : "Confirm and add meal"}
                </button>
                <button
                  className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700 disabled:opacity-60"
                  disabled={props.confirmingPendingScan}
                  onClick={() => {
                    void props.onPendingUseAsIs();
                  }}
                  type="button"
                >
                  Use as is
                </button>
              </form>
            )}
          </div>
        )}
        {props.meals.length === 0 && <p className="text-sm text-slate-500">No meals logged today.</p>}
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    await props.onSubmit();
  }

  return (
    <form className="space-y-4 rounded-3xl bg-white p-5 shadow-sm" onSubmit={submit}>
      <h2 className="text-lg font-semibold text-ink">Onboarding</h2>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">
          Timezone
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.timezone}
            onChange={(e) => props.onChange({ timezone: e.target.value })}
          />
        </label>
        <label className="text-sm text-slate-600">
          Goal Type
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.goalType}
            onChange={(e) => props.onChange({ goalType: e.target.value as GoalType })}
          >
            <option value="lose">Lose</option>
            <option value="maintain">Maintain</option>
            <option value="gain">Gain</option>
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Height (cm)
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.heightCm}
            onChange={(e) => props.onChange({ heightCm: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          Weight (kg)
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.weightKg}
            onChange={(e) => props.onChange({ weightKg: e.target.value })}
            type="number"
            step="0.1"
          />
        </label>
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Daily goals</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">
          Calories
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.calories}
            onChange={(e) => props.onChange({ calories: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          Protein (g)
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.proteinG}
            onChange={(e) => props.onChange({ proteinG: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          Carbs (g)
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.carbsG}
            onChange={(e) => props.onChange({ carbsG: e.target.value })}
            type="number"
          />
        </label>
        <label className="text-sm text-slate-600">
          Fat (g)
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
        {props.saving ? "Saving..." : "Save onboarding"}
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
  async function submit(e: FormEvent) {
    e.preventDefault();
    await props.onSubmit();
  }

  return (
    <form className="space-y-4 rounded-3xl bg-white p-5 shadow-sm" onSubmit={submit}>
      <h2 className="text-lg font-semibold text-ink">Add Meal</h2>
      <label className="block text-sm text-slate-600">
        Meal title
        <input
          className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
          value={props.form.title}
          onChange={(e) => props.onChange({ title: e.target.value })}
          required
        />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="text-sm text-slate-600">
          Meal type
          <select
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.mealType}
            onChange={(e) => props.onChange({ mealType: e.target.value as MealType })}
          >
            <option value="breakfast">Breakfast</option>
            <option value="lunch">Lunch</option>
            <option value="dinner">Dinner</option>
            <option value="snack">Snack</option>
          </select>
        </label>
        <label className="text-sm text-slate-600">
          Time
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.eatenAt}
            onChange={(e) => props.onChange({ eatenAt: e.target.value })}
            type="datetime-local"
            required
          />
        </label>
      </div>
      <h3 className="text-sm font-semibold uppercase tracking-wide text-slate-500">Single item</h3>
      <div className="grid grid-cols-2 gap-3">
        <label className="col-span-2 text-sm text-slate-600">
          Item name
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.itemName}
            onChange={(e) => props.onChange({ itemName: e.target.value })}
            required
          />
        </label>
        <label className="text-sm text-slate-600">
          Calories
          <input
            className="mt-1 w-full rounded-xl border border-slate-200 px-3 py-2"
            value={props.form.calories}
            onChange={(e) => props.onChange({ calories: e.target.value })}
            type="number"
            required
          />
        </label>
        <label className="text-sm text-slate-600">
          Protein (g)
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
          Carbs (g)
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
          Fat (g)
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
        {props.saving ? "Saving..." : "Add meal"}
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
      setCameraError("Camera API is not available in this browser");
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
      const message = error instanceof Error ? error.message : "Failed to open camera";
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
      setCameraError("Camera is not ready yet");
      return;
    }
    setCameraBusy(true);
    try {
      canvas.width = width;
      canvas.height = height;
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Failed to read camera frame");
      context.drawImage(video, 0, 0, width, height);
      const blob = await new Promise<Blob | null>((resolve) => {
        canvas.toBlob(resolve, "image/jpeg", 0.92);
      });
      if (!blob) throw new Error("Failed to capture photo");
      const file = new File([blob], `camera-${Date.now()}.jpg`, { type: "image/jpeg" });
      props.onPickFile(file);
      closeCamera();
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to capture photo";
      setCameraError(message);
    } finally {
      setCameraBusy(false);
    }
  }

  return (
    <section className="space-y-4 rounded-3xl bg-white p-5 shadow-sm">
      <h2 className="text-lg font-semibold text-ink">Add with AI</h2>
      <label className="block text-sm text-slate-600">
        Describe food with text (optional)
        <textarea
          className="mt-1 min-h-20 w-full rounded-xl border border-slate-200 px-3 py-2"
          placeholder="E.g. Chicken salad, olive oil dressing, one slice of bread"
          value={props.description}
          onChange={(e) => props.onDescriptionChange(e.target.value)}
        />
      </label>
      <div className="space-y-2">
        <p className="text-sm text-slate-600">Food photo</p>
        {!cameraOpen && (
          <button
            className="w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700"
            onClick={() => {
              void openCamera();
            }}
            type="button"
          >
            Open camera
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
                {cameraBusy ? "Capturing..." : cameraReady ? "Take photo" : "Camera starting..."}
              </button>
              <button
                className="rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-700"
                onClick={closeCamera}
                type="button"
              >
                Close camera
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
          Choose from gallery
        </button>
        {cameraError && <p className="text-xs text-red-600">Camera error: {cameraError}</p>}
        <canvas className="hidden" ref={canvasRef} />
      </div>
      {props.fileName && <p className="text-xs text-slate-500">Selected: {props.fileName}</p>}
      {props.imagePreview && (
        <img alt="Meal preview" className="h-48 w-full rounded-xl object-cover" src={props.imagePreview} />
      )}
      <button
        className="w-full rounded-xl bg-primary px-4 py-3 text-sm font-semibold text-white disabled:opacity-60"
        disabled={props.scanning || (!props.fileName && !props.description.trim())}
        onClick={() => {
          void props.onScan();
        }}
        type="button"
      >
        {props.scanning ? "Scanning..." : "Analyze photo"}
      </button>
      {(props.scanning ||
        props.scanStatus?.status === "queued" ||
        props.scanStatus?.status === "processing") && (
        <div className="rounded-xl border border-slate-200 p-3">
          <div className="mb-2 flex items-center justify-between text-xs text-slate-600">
            <span>Progress</span>
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
            Cancel scan
          </button>
        </div>
      )}

      {props.scanStatus && (
        <div className="rounded-xl border border-slate-200 p-3">
          <p className="text-sm font-semibold text-ink">Status: {props.scanStatus.status}</p>
          {props.scanStatus.status === "queued" && (
            <p className="mt-1 text-xs text-slate-600">Image uploaded. Waiting for model queue.</p>
          )}
          {props.scanStatus.status === "processing" && (
            <p className="mt-1 text-xs text-slate-600">Analyzing image with AI model.</p>
          )}
          {props.scanStatus.status === "succeeded" && (
            <p className="mt-1 text-xs text-emerald-700">
              Scan finished. Open Daily Log to review, edit, and confirm.
            </p>
          )}
          {props.scanStatus.status === "cancelled" && (
            <p className="mt-1 text-xs text-slate-600">Scan canceled by user.</p>
          )}
          {props.scanStatus.status === "failed" && (
            <>
              <p className="mt-1 text-xs text-red-600">
                Error: {humanizeScanError(props.scanStatus.errorCode)}
              </p>
              <div className="mt-3 grid grid-cols-2 gap-2">
                <button
                  className="rounded-lg bg-slate-100 px-3 py-2 text-xs font-semibold text-slate-700"
                  onClick={() => {
                    void props.onRetry();
                  }}
                  type="button"
                >
                  Retry scan
                </button>
                <button
                  className="rounded-lg bg-amber-100 px-3 py-2 text-xs font-semibold text-amber-800"
                  onClick={props.onFallbackToManual}
                  type="button"
                >
                  Use manual form
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
  const [meals, setMeals] = useState<Meal[]>([]);
  const [onboardingForm, setOnboardingForm] = useState<OnboardingForm>({
    timezone: "UTC",
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

  useEffect(() => {
    return () => {
      if (scanPreview) URL.revokeObjectURL(scanPreview);
    };
  }, [scanPreview]);

  async function loadAll() {
    setError(null);
    const [profileData, goalsData, dashboardData, mealsData] = await Promise.all([
      api.getProfile(),
      api.getGoals(),
      api.getDashboard(selectedDate),
      api.getMeals(selectedDate)
    ]);
    setProfile(profileData);
    setDashboard(dashboardData);
    setMeals(mealsData.items);
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
        setError(e instanceof Error ? e.message : "Unknown error");
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
      setSuccess("Onboarding saved");
      setTab("dashboard");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to save onboarding");
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
      setSuccess("Meal added");
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to add meal");
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
      setSuccess("Meal deleted");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to delete meal");
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
          setSuccess("Scan canceled");
          setActiveScanId(null);
          return;
        }
        if (Date.now() - startedAt > maxDurationMs) {
          setError("Scan timeout. Try again or use manual form.");
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
        setSuccess("AI draft is ready. Review it in Daily Log.");
        setTab("daily-log");
      }
      if (status.status === "failed") {
        setScanProgress(100);
        setError(`Scan failed: ${status.errorCode ?? "unknown_error"}`);
        setTab("daily-log");
      }
      if (status.status === "cancelled") {
        setScanProgress(100);
        setSuccess("Scan canceled");
        setTab("daily-log");
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Scan failed");
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
      setSuccess("Scanned meal added");
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm scan");
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
      setSuccess("Scanned meal added");
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to confirm scan");
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
      setSuccess("Scan recalculated");
      setTab("daily-log");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to recalculate scan");
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
      <header className="mb-4">
        <p className="text-xs uppercase tracking-wide text-slate-500">Telegram Mini App</p>
        <h1 className="text-2xl font-bold text-ink">Calorie Food</h1>
        <p className="text-sm text-slate-500">
          {selectedDate} {profile ? `- ${profile.timezone}` : ""}
        </p>
      </header>

      {loading && <p className="rounded-xl bg-white p-4 text-slate-600 shadow-sm">Loading...</p>}
      {error && (
        <p className="mb-4 rounded-xl bg-red-50 p-4 text-sm text-red-700 shadow-sm">
          Failed: {error}
        </p>
      )}
      {success && (
        <p className="mb-4 rounded-xl bg-emerald-50 p-4 text-sm text-emerald-700 shadow-sm">{success}</p>
      )}

      {!loading && dashboard && (
        <>
          {tab === "dashboard" && <DashboardView dashboard={dashboard} />}
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
              onChange={(patch) => setOnboardingForm((prev) => ({ ...prev, ...patch }))}
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

      <nav className="fixed bottom-0 left-1/2 grid w-full max-w-md -translate-x-1/2 grid-cols-5 gap-2 border-t border-slate-200 bg-white p-3">
        <button
          className={`rounded-xl px-2 py-2 text-xs font-medium ${
            tab === "dashboard" ? "bg-primary text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => setTab("dashboard")}
          type="button"
        >
          Dashboard
        </button>
        <button
          className={`rounded-xl px-2 py-2 text-xs font-medium ${
            tab === "daily-log" ? "bg-primary text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => setTab("daily-log")}
          type="button"
        >
          Daily Log
        </button>
        <button
          aria-label="Quick add"
          className={`quick-add-cta -mt-7 flex h-16 flex-col items-center justify-center rounded-full px-0 py-0 text-xs font-bold ${
            tab === "quick-add"
              ? "quick-add-cta-active text-white"
              : "bg-gradient-to-br from-amber-300 via-orange-300 to-rose-300 text-ink"
          }`}
          onClick={() => setTab("quick-add")}
          type="button"
        >
          <span className="text-2xl leading-none">+</span>
          <span className="text-[10px] uppercase tracking-wide">Add</span>
        </button>
        <button
          className={`rounded-xl px-2 py-2 text-xs font-medium ${
            tab === "add-meal" ? "bg-primary text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => setTab("add-meal")}
          type="button"
        >
          Add Meal
        </button>
        <button
          className={`rounded-xl px-2 py-2 text-xs font-medium ${
            tab === "onboarding" ? "bg-primary text-white" : "bg-slate-100 text-slate-700"
          }`}
          onClick={() => setTab("onboarding")}
          type="button"
        >
          Profile
        </button>
      </nav>
    </div>
  );
}
