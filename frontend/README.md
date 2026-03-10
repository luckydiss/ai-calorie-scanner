# Frontend

Phase 2 frontend is bootstrapped with React + TypeScript + Vite + Tailwind.

## Run locally

```bash
npm.cmd install
npm.cmd run dev
```

Optional API host override:

```bash
set VITE_API_BASE_URL=http://localhost:8080
```

## Implemented in phase 2

- Dashboard view with calories and macro progress
- Daily Log view with meal timeline cards
- Session bootstrap via `/auth/telegram/verify`
- Data integration with `/profile`, `/dashboard`, `/meals`
- AI Scanner flow:
  - upload image via `POST /scans`
  - polling `GET /scans/{scan_id}`
  - confirm to meal via `POST /scans/{scan_id}/confirm`

## Notes

- If Telegram `initData` is not available, app uses a development fallback user payload.
- AI scanner UI and flow remain phase 3 work.
