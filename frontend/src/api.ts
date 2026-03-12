export type Profile = {
  timezone: string;
  heightCm: number | null;
  weightKg: number | null;
  goalType: "lose" | "maintain" | "gain" | null;
};

export type Goals = {
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
};

export type MealItem = {
  name: string;
  grams?: number | null;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence?: number | null;
};

export type Meal = {
  id: string;
  title: string;
  mealType: "breakfast" | "lunch" | "dinner" | "snack";
  eatenAt: string;
  source: "manual" | "ai";
  items: MealItem[];
};

export type GoalType = "lose" | "maintain" | "gain";
export type MealType = "breakfast" | "lunch" | "dinner" | "snack";

export type Dashboard = {
  date: string;
  totals: Goals;
  goals: Goals;
  recentMeals: Meal[];
};

export type Streak = {
  currentDays: number;
  longestDays: number;
  lastLoggedDay: string | null;
};

export type Achievement = {
  key: string;
  title: string;
  description: string;
  progress: number;
  target: number;
  unlocked: boolean;
  unlockedAt: string | null;
};

export type AchievementsResponse = {
  streak: Streak;
  items: Achievement[];
};

export type ScanJob = {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  createdAt: string;
};

export type ScanResult = {
  dishName: string;
  calories: number;
  proteinG: number;
  carbsG: number;
  fatG: number;
  confidence: number;
  alternatives: string[];
};

export type ScanStatus = {
  id: string;
  status: "queued" | "processing" | "succeeded" | "failed" | "cancelled";
  errorCode: string | null;
  result: ScanResult | null;
};

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? "http://localhost:8080";

let accessToken = "";

async function request<T>(path: string, options: RequestInit = {}): Promise<T> {
  const isFormData = options.body instanceof FormData;
  const baseHeaders: Record<string, string> = accessToken ? { Authorization: `Bearer ${accessToken}` } : {};
  const res = await fetch(`${API_BASE}${path}`, {
    ...options,
    headers: {
      ...(!isFormData ? { "Content-Type": "application/json" } : {}),
      ...baseHeaders,
      ...(options.headers ?? {})
    }
  });
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`${res.status} ${text}`);
  }
  if (res.status === 204) {
    return undefined as T;
  }
  return (await res.json()) as T;
}

function getTelegramInitData(): string {
  type TgWindow = Window & {
    Telegram?: { WebApp?: { initData?: string; initDataUnsafe?: { user?: unknown } } };
  };
  const tg = (window as TgWindow).Telegram?.WebApp;
  const direct = tg?.initData?.trim();
  if (direct) return direct;

  const fromHash = new URLSearchParams(window.location.hash.replace(/^#/, "")).get("tgWebAppData")?.trim();
  if (fromHash) return decodeURIComponent(fromHash);

  const fromQuery = new URLSearchParams(window.location.search).get("tgWebAppData")?.trim();
  if (fromQuery) return decodeURIComponent(fromQuery);

  return "";
}

export async function bootstrapSession(): Promise<void> {
  const initData = getTelegramInitData();
  if (!initData) {
    throw new Error("Telegram init data is missing. Open this app from Telegram bot button.");
  }
  const auth = await request<{ accessToken: string }>("/auth/telegram/verify", {
    method: "POST",
    body: JSON.stringify({ initData })
  });
  accessToken = auth.accessToken;
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

export const api = {
  getProfile: () => request<Profile>("/profile"),
  putProfile: (payload: Partial<Profile>) =>
    request<Profile>("/profile", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getGoals: () => request<Goals>("/goals"),
  putGoals: (payload: Goals) =>
    request<Goals>("/goals", {
      method: "PUT",
      body: JSON.stringify(payload)
    }),
  getDashboard: (date: string) => request<Dashboard>(`/dashboard?date=${date}`),
  getAchievements: () => request<AchievementsResponse>("/achievements"),
  getMeals: (date: string) => request<{ items: Meal[] }>(`/meals?date=${date}`),
  createMeal: (payload: {
    title: string;
    mealType: MealType;
    eatenAt: string;
    items: MealItem[];
  }) =>
    request<Meal>("/meals", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  deleteMeal: (mealId: string) =>
    request<void>(`/meals/${mealId}`, {
      method: "DELETE"
    }),
  createScan: (image: File | null, description: string) => {
    const form = new FormData();
    if (image) form.append("image", image);
    if (description.trim()) form.append("description", description.trim());
    return request<ScanJob>("/scans", { method: "POST", body: form });
  },
  getScanStatus: (scanId: string) => request<ScanStatus>(`/scans/${scanId}`),
  cancelScan: (scanId: string) =>
    request<ScanStatus>(`/scans/${scanId}/cancel`, {
      method: "POST",
      body: JSON.stringify({})
    }),
  recalculateScan: (scanId: string, comment: string) =>
    request<ScanStatus>(`/scans/${scanId}/recalculate`, {
      method: "POST",
      body: JSON.stringify({ comment })
    }),
  confirmScan: (
    scanId: string,
    payload: {
      title: string;
      mealType: MealType;
      eatenAt: string;
      items: MealItem[];
    }
  ) =>
    request<Meal>(`/scans/${scanId}/confirm`, {
      method: "POST",
      body: JSON.stringify(payload)
    })
};
