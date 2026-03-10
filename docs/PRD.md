# PRD Lite: AI Calorie Tracker for Telegram Mini App

## 1. Product goal

Help users log meals fast and track calories/macros daily with AI-assisted photo recognition in Telegram.

## 2. MVP boundaries

Included:

- `Dashboard`
- `AI Scanner`
- `Daily Log`
- `Trophy Room` (lightweight gamification)
- Telegram login via Mini App
- Manual meal entry fallback

Excluded from MVP:

- Multi-dish segmentation in one photo
- Premium subscriptions and payments
- Social features
- Deep micronutrient analytics

## 3. User segments

- People tracking weight or body composition
- Users who prefer fast meal logging (photo first)
- Telegram-native users who avoid installing separate apps

## 4. Core user flows

1. Open app from Telegram bot.
2. Complete onboarding and set calorie/macronutrient goals.
3. Log meal by photo (AI) or manual entry.
4. Confirm or correct AI result.
5. View day totals and recent logs.
6. Build streak and unlock badges.

## 5. Functional requirements

### 5.1 Auth and profile

- Verify Telegram `initData` on backend.
- Create or update user profile.
- Store timezone and daily goals.

### 5.2 Meals and tracking

- Create, edit, delete meal logs.
- Support meal type (`breakfast`, `lunch`, `dinner`, `snack`).
- Aggregate calories and macros per day.

### 5.3 AI scanner

- Upload image.
- Process asynchronously with scan job status.
- Return best guess with confidence.
- Require user confirmation before final save.
- Provide manual correction path.

### 5.4 Trophy room

- Show streak days and badge progress.
- Unlock simple achievements on deterministic rules.

## 6. Non-functional requirements

- API p95 under 400ms for non-AI endpoints.
- AI scan response target under 8s for median image.
- Crash-free frontend sessions above 99%.
- Secure request validation and rate limiting.

## 7. UX states (must exist)

- Empty day state
- Loading state
- Network error state
- AI failure state with manual fallback
- No camera permission state

## 8. Analytics events

- `app_opened`
- `onboarding_completed`
- `meal_added_manual`
- `scan_started`
- `scan_uploaded`
- `scan_completed`
- `scan_failed`
- `scan_confirmed`
- `scan_corrected`
- `streak_updated`

## 9. Success metrics for MVP

- Meal logging completion under 30s for AI flow (median).
- D1 retention >= 30%.
- D7 retention >= 12%.
- Share of AI logs with manual correction under 40% after tuning.

## 10. Risks and mitigations

- AI accuracy variance by food/country:
  Mitigation: always require confirmation and edit before save.
- Telegram WebView constraints:
  Mitigation: optimize payloads and keep UI lightweight.
- Slow inference:
  Mitigation: async queue and status polling.
